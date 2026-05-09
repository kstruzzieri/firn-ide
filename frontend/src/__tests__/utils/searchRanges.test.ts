import {
  byteColumnToCharColumn,
  byteOffsetToCharIndex,
  splitLineByByteRanges,
} from '../../utils/searchRanges';

describe('byteOffsetToCharIndex', () => {
  it('keeps ASCII byte offsets aligned with string indexes', () => {
    expect(byteOffsetToCharIndex('abcdef', 0)).toBe(0);
    expect(byteOffsetToCharIndex('abcdef', 3)).toBe(3);
    expect(byteOffsetToCharIndex('abcdef', 6)).toBe(6);
  });

  it('clamps offsets past the end of text to text.length', () => {
    expect(byteOffsetToCharIndex('abcdef', 99)).toBe(6);
    expect(byteOffsetToCharIndex('', 0)).toBe(0);
    expect(byteOffsetToCharIndex('', 99)).toBe(0);
  });

  it('treats negative offsets as 0', () => {
    expect(byteOffsetToCharIndex('abcdef', -1)).toBe(0);
    expect(byteOffsetToCharIndex('abcdef', -100)).toBe(0);
  });

  it('rounds non-integer byte offsets toward zero', () => {
    expect(byteOffsetToCharIndex('abcdef', 2.9)).toBe(2);
    expect(byteOffsetToCharIndex('abcdef', 0.4)).toBe(0);
  });

  it('handles 2-byte UTF-8 (Latin-1 supplement)', () => {
    // 'é' = U+00E9 = 0xC3 0xA9 (2 UTF-8 bytes)
    const text = 'café';
    expect(byteOffsetToCharIndex(text, 0)).toBe(0);
    expect(byteOffsetToCharIndex(text, 3)).toBe(3); // start of 'é'
    expect(byteOffsetToCharIndex(text, 5)).toBe(4); // end of 'é'
  });

  it('handles 3-byte UTF-8 (CJK)', () => {
    // '日' = U+65E5 = 0xE6 0x97 0xA5 (3 UTF-8 bytes)
    const text = 'a日b';
    expect(byteOffsetToCharIndex(text, 0)).toBe(0);
    expect(byteOffsetToCharIndex(text, 1)).toBe(1); // start of '日'
    expect(byteOffsetToCharIndex(text, 4)).toBe(2); // end of '日'
    expect(byteOffsetToCharIndex(text, 5)).toBe(3); // end of 'b'
  });

  it('handles 4-byte UTF-8 emoji as a UTF-16 surrogate pair', () => {
    // '😀' = U+1F600 = 0xF0 0x9F 0x98 0x80 (4 UTF-8 bytes), 2 UTF-16 code units
    const text = 'a😀z';
    expect(byteOffsetToCharIndex(text, 0)).toBe(0);
    expect(byteOffsetToCharIndex(text, 1)).toBe(1); // start of emoji
    expect(byteOffsetToCharIndex(text, 5)).toBe(3); // end of emoji
    expect(byteOffsetToCharIndex(text, 6)).toBe(4); // end of 'z'
  });

  it('never lands inside a UTF-16 surrogate pair when given a mid-emoji byte offset', () => {
    const text = 'a😀z';
    // Bytes 2, 3, 4 are inside the 4-byte emoji. The function should return
    // either before the emoji (1) or after it (3), never the high-surrogate
    // index (would be 2 — the low surrogate).
    for (const byte of [2, 3, 4]) {
      const idx = byteOffsetToCharIndex(text, byte);
      expect(idx === 1 || idx === 3).toBe(true);
    }
  });

  it('handles combining marks as separate codepoints', () => {
    // 'é' decomposed: 'e' + U+0301 = 1 + 2 UTF-8 bytes = 3 bytes total
    const text = 'éz';
    expect(byteOffsetToCharIndex(text, 0)).toBe(0);
    expect(byteOffsetToCharIndex(text, 1)).toBe(1); // start of combining mark
    expect(byteOffsetToCharIndex(text, 3)).toBe(2); // end of combining mark
    expect(byteOffsetToCharIndex(text, 4)).toBe(3); // end of 'z'
  });

  it('handles ZWJ emoji sequences', () => {
    // 👨‍👩‍👧 = man + ZWJ + woman + ZWJ + girl
    // U+1F468 (4B) + U+200D (3B) + U+1F469 (4B) + U+200D (3B) + U+1F467 (4B) = 18 bytes
    // UTF-16 code units: 2 + 1 + 2 + 1 + 2 = 8
    const text = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(byteOffsetToCharIndex(text, 0)).toBe(0);
    expect(byteOffsetToCharIndex(text, 18)).toBe(8); // end of full sequence
    expect(byteOffsetToCharIndex(text, 4)).toBe(2); // after first man
    expect(byteOffsetToCharIndex(text, 7)).toBe(3); // after first ZWJ
  });
});

describe('byteColumnToCharColumn', () => {
  it('converts 1-based ripgrep byte columns to 1-based editor columns', () => {
    // 'aé😀z': bytes [a=1][é=1-2][😀=3-6][z=7] (1-based)
    // chars (UTF-16): [a][é][😀hi][😀lo][z] → 1-based 1,2,3,5
    expect(byteColumnToCharColumn('aé😀z', 1)).toBe(1); // 'a'
    expect(byteColumnToCharColumn('aé😀z', 2)).toBe(2); // 'é'
    expect(byteColumnToCharColumn('aé😀z', 4)).toBe(3); // start of '😀'
    expect(byteColumnToCharColumn('aé😀z', 8)).toBe(5); // 'z'
  });

  it('clamps byte columns past line end to one past last char', () => {
    expect(byteColumnToCharColumn('abc', 99)).toBe(4);
  });

  it('treats column 0 or negative as column 1', () => {
    expect(byteColumnToCharColumn('abc', 0)).toBe(1);
    expect(byteColumnToCharColumn('abc', -5)).toBe(1);
  });
});

describe('splitLineByByteRanges', () => {
  it('returns the whole text as a non-match segment when ranges is empty', () => {
    expect(splitLineByByteRanges('alpha beta', [])).toEqual([
      { text: 'alpha beta', isMatch: false },
    ]);
  });

  it('splits a single ASCII range', () => {
    expect(splitLineByByteRanges('alpha beta gamma', [{ start: 6, end: 10 }])).toEqual([
      { text: 'alpha ', isMatch: false },
      { text: 'beta', isMatch: true },
      { text: ' gamma', isMatch: false },
    ]);
  });

  it('emits no leading non-match segment when range starts at byte 0', () => {
    expect(splitLineByByteRanges('alpha beta', [{ start: 0, end: 5 }])).toEqual([
      { text: 'alpha', isMatch: true },
      { text: ' beta', isMatch: false },
    ]);
  });

  it('emits no trailing non-match segment when range ends at text byte length', () => {
    expect(splitLineByByteRanges('alpha beta', [{ start: 6, end: 10 }])).toEqual([
      { text: 'alpha ', isMatch: false },
      { text: 'beta', isMatch: true },
    ]);
  });

  it('emits a single match segment when a range covers the entire text', () => {
    expect(splitLineByByteRanges('alpha', [{ start: 0, end: 5 }])).toEqual([
      { text: 'alpha', isMatch: true },
    ]);
  });

  it('emits multiple match segments separated by gaps', () => {
    expect(
      splitLineByByteRanges('alpha beta gamma', [
        { start: 0, end: 5 },
        { start: 11, end: 16 },
      ])
    ).toEqual([
      { text: 'alpha', isMatch: true },
      { text: ' beta ', isMatch: false },
      { text: 'gamma', isMatch: true },
    ]);
  });

  it('joins adjacent match segments with no gap between them', () => {
    expect(
      splitLineByByteRanges('alphabeta', [
        { start: 0, end: 5 },
        { start: 5, end: 9 },
      ])
    ).toEqual([
      { text: 'alpha', isMatch: true },
      { text: 'beta', isMatch: true },
    ]);
  });

  it('sorts unsorted input ranges by start ascending', () => {
    expect(
      splitLineByByteRanges('alpha beta gamma', [
        { start: 11, end: 16 },
        { start: 0, end: 5 },
      ])
    ).toEqual([
      { text: 'alpha', isMatch: true },
      { text: ' beta ', isMatch: false },
      { text: 'gamma', isMatch: true },
    ]);
  });

  it('merges overlapping ranges into a single highlight', () => {
    // Ranges [0..5) and [3..8) overlap at bytes 3-4. Merging produces a
    // single [0..8) highlight rather than two adjacent segments with a
    // surprising boundary inside the overlap region.
    expect(
      splitLineByByteRanges('alphabetagamma', [
        { start: 0, end: 5 },
        { start: 3, end: 8 },
      ])
    ).toEqual([
      { text: 'alphabet', isMatch: true },
      { text: 'agamma', isMatch: false },
    ]);
  });

  it('keeps touching ranges as separate highlights so adjacent matches stay countable', () => {
    expect(
      splitLineByByteRanges('alphabetagamma', [
        { start: 0, end: 5 },
        { start: 5, end: 8 },
      ])
    ).toEqual([
      { text: 'alpha', isMatch: true },
      { text: 'bet', isMatch: true },
      { text: 'agamma', isMatch: false },
    ]);
  });

  it('splits ranges that include multibyte characters', () => {
    expect(splitLineByByteRanges('café 😀', [{ start: 3, end: 10 }])).toEqual([
      { text: 'caf', isMatch: false },
      { text: 'é 😀', isMatch: true },
    ]);
  });

  it('returns the whole text as non-match when ranges have zero width', () => {
    expect(splitLineByByteRanges('alpha', [{ start: 2, end: 2 }])).toEqual([
      { text: 'alpha', isMatch: false },
    ]);
  });

  it('handles empty text', () => {
    expect(splitLineByByteRanges('', [])).toEqual([{ text: '', isMatch: false }]);
    expect(splitLineByByteRanges('', [{ start: 0, end: 5 }])).toEqual([
      { text: '', isMatch: false },
    ]);
  });
});

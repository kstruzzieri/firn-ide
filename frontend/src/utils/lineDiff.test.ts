import {
  diffLines,
  gitLineMarkers,
  inlineWordDiff,
  revertHunkChange,
  type GitLineMarker,
} from './lineDiff';

const markers = (a: string, b: string): GitLineMarker[] => gitLineMarkers(a, b);

describe('diffLines / markersFromHunks', () => {
  it('returns no markers for identical content', () => {
    expect(markers('a\nb\nc\n', 'a\nb\nc\n')).toEqual([]);
  });

  it('marks an inserted line as added', () => {
    expect(markers('a\nc\n', 'a\nb\nc\n')).toEqual([{ line: 2, type: 'added' }]);
  });

  it('marks a changed line as modified', () => {
    expect(markers('a\nb\nc\n', 'a\nX\nc\n')).toEqual([{ line: 2, type: 'modified' }]);
  });

  it('marks a removal as deleted on the following line', () => {
    expect(markers('a\nb\nc\n', 'a\nc\n')).toEqual([{ line: 2, type: 'deleted' }]);
  });

  it('handles multiple separate hunks', () => {
    const got = markers('a\nb\nc\nd\ne\n', 'a\nX\nc\nd\nY\ne\n');
    expect(got).toEqual([
      { line: 2, type: 'modified' },
      { line: 5, type: 'added' },
    ]);
  });

  it('treats an empty baseline as all lines added (untracked file)', () => {
    expect(markers('', 'a\nb\n')).toEqual([
      { line: 1, type: 'added' },
      { line: 2, type: 'added' },
    ]);
  });

  it('marks trailing additions', () => {
    expect(markers('a\n', 'a\nb\n')).toEqual([{ line: 2, type: 'added' }]);
  });

  it('a deletion at the end anchors to the last line', () => {
    expect(markers('a\nb\n', 'a\n')).toEqual([{ line: 1, type: 'deleted' }]);
  });
});

describe('revertHunkChange', () => {
  const applyChange = (text: string, c: { from: number; to: number; insert: string }): string =>
    text.slice(0, c.from) + c.insert + text.slice(c.to);

  // Reverting one hunk restores exactly that hunk's baseline text.
  const revertOne = (baseline: string, current: string): string => {
    const hunks = diffLines(baseline, current);
    expect(hunks).toHaveLength(1);
    return applyChange(current, revertHunkChange(current, baseline, hunks[0]));
  };

  it('reverts a modified line', () => {
    expect(revertOne('a\nb\nc\n', 'a\nX\nc\n')).toBe('a\nb\nc\n');
  });

  it('reverts an inserted line (drops it)', () => {
    expect(revertOne('a\nc\n', 'a\nb\nc\n')).toBe('a\nc\n');
  });

  it('reverts a deleted line (restores it)', () => {
    expect(revertOne('a\nb\nc\n', 'a\nc\n')).toBe('a\nb\nc\n');
  });

  it('reverts a trailing insertion at EOF', () => {
    expect(revertOne('a\n', 'a\nb\n')).toBe('a\n');
  });

  it('reverts a deletion at EOF', () => {
    expect(revertOne('a\nb\n', 'a\n')).toBe('a\nb\n');
  });

  it('reverts an insertion at the first line', () => {
    expect(revertOne('b\nc\n', 'a\nb\nc\n')).toBe('b\nc\n');
  });

  // The core invariant: reverting every hunk (right-to-left, so earlier
  // offsets stay valid) reconstructs the baseline exactly.
  it('reverting all hunks reproduces the baseline', () => {
    const baseline = 'one\ntwo\nthree\nfour\nfive\n';
    const current = 'one\nTWO\nthree\ninserted\nfive\nsix\n';
    const hunks = diffLines(baseline, current);
    let text = current;
    for (let i = hunks.length - 1; i >= 0; i--) {
      text = applyChange(text, revertHunkChange(text, baseline, hunks[i]));
    }
    expect(text).toBe(baseline);
  });
});

describe('inlineWordDiff', () => {
  const ofType = (segs: ReturnType<typeof inlineWordDiff>, type: 'same' | 'del' | 'ins'): string =>
    segs
      .filter((s) => s.type === type)
      .map((s) => s.text)
      .join('');

  // The load-bearing invariant: non-ins segments rebuild the old text, non-del
  // segments rebuild the new text. If this holds the render can never lie.
  const expectRoundTrip = (oldText: string, newText: string): void => {
    const segs = inlineWordDiff(oldText, newText);
    const oldRebuilt = segs
      .filter((s) => s.type !== 'ins')
      .map((s) => s.text)
      .join('');
    const newRebuilt = segs
      .filter((s) => s.type !== 'del')
      .map((s) => s.text)
      .join('');
    expect(oldRebuilt).toBe(oldText);
    expect(newRebuilt).toBe(newText);
  };

  it('emits a single same-segment for identical text', () => {
    expect(inlineWordDiff('abc', 'abc')).toEqual([{ text: 'abc', type: 'same' }]);
  });

  it('shows pure insertions as ins segments (the asdf/fgh/ghgg case)', () => {
    const oldText = '// context is available.';
    const newText = '// context is asdf fgh available. ghgg';
    const segs = inlineWordDiff(oldText, newText);
    expect(ofType(segs, 'del')).toBe('');
    expect(ofType(segs, 'ins')).toContain('asdf');
    expect(ofType(segs, 'ins')).toContain('ghgg');
    expectRoundTrip(oldText, newText);
  });

  it('shows a replaced word as del followed by ins', () => {
    const segs = inlineWordDiff('DebounceMs = 100', 'DebounceMs = 250');
    expect(segs).toContainEqual({ text: '100', type: 'del' });
    expect(segs).toContainEqual({ text: '250', type: 'ins' });
    expectRoundTrip('DebounceMs = 100', 'DebounceMs = 250');
  });

  it('handles a pure deletion (working tree emptied the hunk)', () => {
    expect(inlineWordDiff('gone', '')).toEqual([{ text: 'gone', type: 'del' }]);
  });

  it('handles a pure addition (no baseline)', () => {
    expect(inlineWordDiff('', 'added line')).toEqual([{ text: 'added line', type: 'ins' }]);
  });

  it('round-trips a multi-edit line', () => {
    expectRoundTrip('the quick brown fox', 'the slow brown cat');
  });
});

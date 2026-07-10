import {
  diffLines,
  gitLineMarkers,
  inlineWordDiff,
  revertHunkChange,
  revertLineChange,
  stripCommonIndent,
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

  it('refines a similar word replacement down to characters (the *App -> *A case)', () => {
    // Removing "pp {" from "*App {" must show as a char-level deletion after
    // the kept "*A", not as del "*App {" + ins "*A".
    const oldText = 'func NewApp() *App {';
    const newText = 'func NewApp() *A';
    const segs = inlineWordDiff(oldText, newText);

    expect(ofType(segs, 'del')).toBe('pp {');
    expect(ofType(segs, 'ins')).toBe('');
    expectRoundTrip(oldText, newText);
  });

  it('keeps a dissimilar word replacement whole (no char confetti)', () => {
    const segs = inlineWordDiff('the quick fox', 'the slow fox');

    expect(segs).toContainEqual({ text: 'quick', type: 'del' });
    expect(segs).toContainEqual({ text: 'slow', type: 'ins' });
    expectRoundTrip('the quick fox', 'the slow fox');
  });

  it('keeps a trailing-space edit on its own line (newline never joins a whitespace run)', () => {
    // A single space added at each line end must diff as two tiny ins
    // segments, not as del/ins of "\n\t" runs spanning the line break —
    // that rendered as bogus red/green blocks in the peek popup.
    const oldText = '\tctx        context.Context\n\tconfigPath string';
    const newText = '\tctx        context.Context \n\tconfigPath string ';
    const segs = inlineWordDiff(oldText, newText);

    expect(ofType(segs, 'del')).toBe('');
    expect(ofType(segs, 'ins')).toBe('  ');
    expectRoundTrip(oldText, newText);
  });
});

describe('revertLineChange', () => {
  // Baseline lines 2-3 modified: hunk fromA=1 toA=3, fromB=1 toB=3.
  const baseline = 'a\nb\nc\nd';
  const current = 'a\nB\nC\nd';
  const hunk = { fromA: 1, toA: 3, fromB: 1, toB: 3 };

  it('reverts only the clicked line inside a multi-line hunk', () => {
    // Line 2 ("B") reverts to "b"; line 3 ("C") stays.
    expect(revertLineChange(current, baseline, hunk, 2)).toEqual({
      from: 2,
      to: 3,
      insert: 'b',
    });
    expect(revertLineChange(current, baseline, hunk, 3)).toEqual({
      from: 4,
      to: 5,
      insert: 'c',
    });
  });

  it('deletes an added line that has no baseline counterpart', () => {
    // Baseline lost nothing; current inserted "x" as line 2.
    const insHunk = { fromA: 1, toA: 1, fromB: 1, toB: 2 };
    expect(revertLineChange('a\nx\nb', 'a\nb', insHunk, 2)).toEqual({
      from: 2,
      to: 4,
      insert: '',
    });
  });

  it('returns null for a line outside the hunk or a pure deletion', () => {
    expect(revertLineChange(current, baseline, hunk, 1)).toBeNull();
    expect(
      revertLineChange('a\nd', 'a\nb\nc\nd', { fromA: 1, toA: 3, fromB: 1, toB: 1 }, 2)
    ).toBeNull();
  });
});

describe('stripCommonIndent', () => {
  it('removes the shared leading indent from both sides', () => {
    const res = stripCommonIndent('\t\tfoo()\n\t\tbar()', '\t\tfoo()\n\t\t\tbaz()');
    expect(res.oldText).toBe('foo()\nbar()');
    expect(res.newText).toBe('foo()\n\tbaz()');
  });

  it('leaves unindented text untouched', () => {
    const res = stripCommonIndent('a\nb', 'a\nc');
    expect(res.oldText).toBe('a\nb');
    expect(res.newText).toBe('a\nc');
  });

  it('ignores empty lines when finding the common indent', () => {
    const res = stripCommonIndent('  a\n\n  b', '  a\n\n  c');
    expect(res.oldText).toBe('a\n\nb');
    expect(res.newText).toBe('a\n\nc');
  });

  it('handles an empty side (pure addition or deletion hunks)', () => {
    const res = stripCommonIndent('', '    added');
    expect(res.oldText).toBe('');
    expect(res.newText).toBe('added');
  });
});

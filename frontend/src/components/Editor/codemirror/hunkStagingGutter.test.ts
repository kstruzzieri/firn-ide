// @codemirror/* ships untransformed ESM jest cannot parse; the module only
// needs `gutter`/`GutterMarker` to exist at import time here (the marker
// callback is driven by a live view, never in these unit tests). The store is
// mocked so the click→applyHunk wiring is asserted directly.
const gutterMock = jest.fn((_config?: unknown) => ({}));
const mockEmptyRangeSet = {};
jest.mock('@codemirror/view', () => ({
  gutter: (config: unknown) => gutterMock(config),
  GutterMarker: class {
    range(from: number) {
      return { from, marker: this };
    }
  },
  EditorView: {},
}));
const rangeSetOf = jest.fn((ranges: unknown[], _sort: boolean) => ({ __ranges: ranges }));
jest.mock('@codemirror/state', () => ({
  RangeSet: { empty: mockEmptyRangeSet, of: (r: unknown[], sort: boolean) => rangeSetOf(r, sort) },
}));

const applyHunk = jest.fn();
jest.mock('../../../stores/gitStore', () => ({
  useGitStore: { getState: () => ({ applyHunk }) },
}));

import {
  hunkStagingAction,
  createHunkButton,
  hunkStagingGutter,
  visibleHunks,
} from './hunkStagingGutter';

const hunk = { patch: 'THE PATCH', newStart: 4, newLines: 2 };

beforeEach(() => jest.clearAllMocks());

describe('hunkStagingAction', () => {
  it('an unstaged diff stages its hunks', () => {
    expect(hunkStagingAction('unstaged')).toEqual({ reverse: false, label: 'Stage hunk' });
  });

  it('a staged diff unstages its hunks', () => {
    expect(hunkStagingAction('staged')).toEqual({ reverse: true, label: 'Unstage hunk' });
  });
});

describe('createHunkButton', () => {
  it('clicking a button in an unstaged diff stages that hunk (reverse=false)', () => {
    const btn = createHunkButton(hunk, 'unstaged');
    expect(btn.title).toBe('Stage hunk');

    btn.click();

    expect(applyHunk).toHaveBeenCalledWith('THE PATCH', false);
  });

  it('clicking a button in a staged diff unstages that hunk (reverse=true)', () => {
    const btn = createHunkButton(hunk, 'staged');
    expect(btn.title).toBe('Unstage hunk');

    btn.click();

    expect(applyHunk).toHaveBeenCalledWith('THE PATCH', true);
  });
});

// Clean snapshot: two hunks, at lines 4-5 and at line 8.
const clean = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9';
const hunk1 = { patch: 'P1', newStart: 4, newLines: 2 };
const hunk2 = { patch: 'P2', newStart: 8, newLines: 1 };

describe('visibleHunks', () => {
  it('keeps every hunk at its own line when the pane matches the snapshot', () => {
    expect(visibleHunks([hunk1, hunk2], clean, clean)).toEqual([
      { hunk: hunk1, line: 4 },
      { hunk: hunk2, line: 8 },
    ]);
  });

  it('keeps untouched hunks when an edit lands elsewhere', () => {
    const edited = clean.replace('l9', 'l9 changed');

    expect(visibleHunks([hunk1, hunk2], clean, edited)).toEqual([
      { hunk: hunk1, line: 4 },
      { hunk: hunk2, line: 8 },
    ]);
  });

  it('shifts hunk anchors past lines inserted above them', () => {
    const edited = `new1\nnew2\n${clean}`;

    expect(visibleHunks([hunk1, hunk2], clean, edited)).toEqual([
      { hunk: hunk1, line: 6 },
      { hunk: hunk2, line: 10 },
    ]);
  });

  it('drops only the hunk an edit touches (its patch is stale)', () => {
    const edited = clean.replace('l4', 'l4 changed');

    expect(visibleHunks([hunk1, hunk2], clean, edited)).toEqual([{ hunk: hunk2, line: 8 }]);
  });

  it('a reverted hunk disappears while the rest stay stageable, shifted', () => {
    // Revert removes hunk1's two lines (its content went back to the index),
    // so hunk2 sits two lines higher on screen.
    const edited = 'l1\nl2\nl3\nl6\nl7\nl8\nl9';

    expect(visibleHunks([hunk1, hunk2], clean, edited)).toEqual([{ hunk: hunk2, line: 6 }]);
  });
});

describe('hunkStagingGutter', () => {
  const markersFor = (docText: string, cleanContent?: string) => {
    hunkStagingGutter([hunk1, hunk2], 'unstaged', cleanContent);
    const config = gutterMock.mock.calls[0]?.[0] as {
      markers: (view: unknown) => unknown;
    };
    const lines = docText.split('\n');
    return config.markers({
      state: {
        doc: {
          toString: () => docText,
          lines: lines.length,
          line: (n: number) => ({ from: n * 100 }),
        },
      },
    });
  };

  it('keeps buttons for untouched hunks while the pane has unsaved edits', () => {
    const markers = markersFor(clean.replace('l4', 'l4 changed'), clean) as {
      __ranges: unknown[];
    };

    // hunk1 was edited (stale patch, hidden); hunk2 survives at line 8.
    expect(markers.__ranges).toEqual([expect.objectContaining({ from: 800 })]);
  });

  it('returns the empty set when edits touch every hunk', () => {
    const markers = markersFor('completely different', clean);

    expect(markers).toBe(mockEmptyRangeSet);
  });
});

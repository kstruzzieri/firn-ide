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

// The control acts on mousedown, not click: in the editable pane a gutter
// mousedown moves the cursor, whose active-line change re-renders the gutter
// and can replace the button between mousedown and mouseup — the click event
// then never fires on it.
const press = (btn: HTMLButtonElement) =>
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

describe('createHunkButton', () => {
  it('pressing a button in an unstaged diff stages that hunk (reverse=false)', () => {
    const btn = createHunkButton(hunk, 'unstaged');
    expect(btn.title).toBe('Stage hunk');

    press(btn);

    expect(applyHunk).toHaveBeenCalledWith('THE PATCH', false);
  });

  it('pressing a button in a staged diff unstages that hunk (reverse=true)', () => {
    const btn = createHunkButton(hunk, 'staged');
    expect(btn.title).toBe('Unstage hunk');

    press(btn);

    expect(applyHunk).toHaveBeenCalledWith('THE PATCH', true);
  });
});

// Clean snapshot: two hunks, at lines 4-5 and at line 8.
const clean = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9';
const hunk1 = { patch: 'P1', newStart: 4, newLines: 2 };
const hunk2 = { patch: 'P2', newStart: 8, newLines: 1 };

describe('visibleHunks', () => {
  it('keeps every hunk live at its own line when the pane matches the snapshot', () => {
    expect(visibleHunks([hunk1, hunk2], clean, clean)).toEqual([
      { hunk: hunk1, line: 4, stale: false },
      { hunk: hunk2, line: 8, stale: false },
    ]);
  });

  it('keeps hunks live when an edit lands elsewhere', () => {
    const edited = clean.replace('l9', 'l9 changed');

    expect(visibleHunks([hunk1, hunk2], clean, edited)).toEqual([
      { hunk: hunk1, line: 4, stale: false },
      { hunk: hunk2, line: 8, stale: false },
    ]);
  });

  it('shifts hunk anchors past lines inserted above them', () => {
    const edited = `new1\nnew2\n${clean}`;

    expect(visibleHunks([hunk1, hunk2], clean, edited)).toEqual([
      { hunk: hunk1, line: 6, stale: false },
      { hunk: hunk2, line: 10, stale: false },
    ]);
  });

  it('marks only the touched hunk stale, without dropping it', () => {
    // The button must not vanish mid-edit — it dims until the save/refresh
    // delivers a fresh patch.
    const edited = clean.replace('l4', 'l4 changed');

    expect(visibleHunks([hunk1, hunk2], clean, edited)).toEqual([
      { hunk: hunk1, line: 4, stale: true },
      { hunk: hunk2, line: 8, stale: false },
    ]);
  });

  it('a reverted hunk goes stale in place while the rest stay live, shifted', () => {
    // Revert removed hunk1's two lines (content went back to the index); its
    // control dims until the refresh drops the hunk, and hunk2 sits two lines
    // higher, still stageable.
    const edited = 'l1\nl2\nl3\nl6\nl7\nl8\nl9';

    expect(visibleHunks([hunk1, hunk2], clean, edited)).toEqual([
      { hunk: hunk1, line: 4, stale: true },
      { hunk: hunk2, line: 6, stale: false },
    ]);
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

  it('keeps every button while the pane has unsaved edits, dimming the touched one', () => {
    const markers = markersFor(clean.replace('l4', 'l4 changed'), clean) as {
      __ranges: unknown[];
    };

    // Both buttons stay: hunk1's is stale (disabled), hunk2's is live.
    expect(markers.__ranges).toEqual([
      expect.objectContaining({ from: 400 }),
      expect.objectContaining({ from: 800 }),
    ]);
  });

  it('returns the empty set when the mapped anchors fall outside the document', () => {
    const markers = markersFor('completely different', clean);

    expect(markers).toBe(mockEmptyRangeSet);
  });

  it('anchors a whole-file deletion at line one instead of dropping the button', () => {
    // Deleting every line leaves the new side empty: git reports new-start 0
    // (no context line exists to shift past), and a bare >= 1 filter would
    // drop the only control that can stage the deletion.
    gutterMock.mockClear();
    hunkStagingGutter([{ patch: 'P', newStart: 0, newLines: 0 }], 'unstaged', '');
    const config = gutterMock.mock.calls[0]?.[0] as { markers: (view: unknown) => unknown };
    const markers = config.markers({
      state: { doc: { toString: () => '', lines: 1, line: (n: number) => ({ from: n * 100 }) } },
    }) as { __ranges: unknown[] };

    expect(markers.__ranges).toEqual([expect.objectContaining({ from: 100 })]);
  });
});

describe('createHunkButton — stale state', () => {
  it('renders a stale control disabled so a mid-save press cannot stage outdated content', () => {
    const btn = createHunkButton(hunk, 'unstaged', true);

    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Saving edit…');

    press(btn);

    expect(applyHunk).not.toHaveBeenCalled();
  });

  it('a live control stays enabled with the staging action', () => {
    const btn = createHunkButton(hunk, 'unstaged', false);

    expect(btn.disabled).toBe(false);

    press(btn);

    expect(applyHunk).toHaveBeenCalledWith('THE PATCH', false);
  });
});

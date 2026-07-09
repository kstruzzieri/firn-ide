// @codemirror/* ships untransformed ESM jest cannot parse; the module only
// needs `gutter`/`GutterMarker` to exist at import time here (the marker
// callback is driven by a live view, never in these unit tests). The store is
// mocked so the click→applyHunk wiring is asserted directly.
const gutterMock = jest.fn((_config?: unknown) => ({}));
const mockEmptyRangeSet = {};
jest.mock('@codemirror/view', () => ({
  gutter: (config: unknown) => gutterMock(config),
  GutterMarker: class {},
  EditorView: {},
}));
jest.mock('@codemirror/state', () => ({ RangeSet: { empty: mockEmptyRangeSet, of: jest.fn() } }));

const applyHunk = jest.fn();
jest.mock('../../../stores/gitStore', () => ({
  useGitStore: { getState: () => ({ applyHunk }) },
}));

import { hunkStagingAction, createHunkButton, hunkStagingGutter } from './hunkStagingGutter';

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

describe('hunkStagingGutter', () => {
  it('hides stale patch controls as soon as the editable document changes', () => {
    hunkStagingGutter([hunk], 'unstaged', 'clean content');

    const config = gutterMock.mock.calls[0]?.[0] as {
      markers: (view: unknown) => unknown;
    };
    const markers = config.markers({
      state: { doc: { toString: () => 'edited content' } },
    });

    expect(markers).toBe(mockEmptyRangeSet);
  });
});

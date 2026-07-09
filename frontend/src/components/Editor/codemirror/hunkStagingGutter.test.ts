// @codemirror/* ships untransformed ESM jest cannot parse; the module only
// needs `gutter`/`GutterMarker` to exist at import time here (the marker
// callback is driven by a live view, never in these unit tests). The store is
// mocked so the click→applyHunk wiring is asserted directly.
jest.mock('@codemirror/view', () => ({
  gutter: jest.fn(() => ({})),
  GutterMarker: class {},
  EditorView: {},
}));
jest.mock('@codemirror/state', () => ({ RangeSet: { of: jest.fn() } }));

const applyHunk = jest.fn();
jest.mock('../../../stores/gitStore', () => ({
  useGitStore: { getState: () => ({ applyHunk }) },
}));

import { hunkStagingAction, createHunkButton } from './hunkStagingGutter';

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

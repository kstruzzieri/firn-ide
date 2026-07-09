// @codemirror/* ships untransformed ESM that jest does not transpile (the
// same reason CodeMirrorEditor has no direct render test). Mock the merge
// module and verify the component's construction/teardown contract instead.
const destroyMock = jest.fn();
const fakeSideB = { state: {}, focus: jest.fn(), requestMeasure: jest.fn() };
const mergeViewMock = jest.fn().mockImplementation(() => ({
  destroy: destroyMock,
  a: { state: {}, requestMeasure: jest.fn() },
  b: fakeSideB,
}));
const goToNextChunkMock = jest.fn((_arg?: unknown) => true);
const goToPreviousChunkMock = jest.fn((_arg?: unknown) => true);
const getChunksMock = jest.fn((_arg?: unknown) => ({ chunks: [{}, {}], side: null }));

jest.mock('@codemirror/merge', () => ({
  MergeView: mergeViewMock,
  goToNextChunk: (arg: unknown) => goToNextChunkMock(arg),
  goToPreviousChunk: (arg: unknown) => goToPreviousChunkMock(arg),
  getChunks: (arg: unknown) => getChunksMock(arg),
}));
const gutterMock = jest.fn((_config?: unknown) => ({ __gutter: true }));
// Distinct tokens so a pane's extension array reveals its wiring: read-only
// panes carry EDITABLE_FALSE + READONLY, the editable working-tree pane carries
// EDIT_LISTENER instead.
jest.mock('@codemirror/view', () => ({
  EditorView: {
    editable: { of: jest.fn(() => 'EDITABLE_FALSE') },
    updateListener: { of: jest.fn(() => 'EDIT_LISTENER') },
    lineWrapping: {},
  },
  lineNumbers: jest.fn(),
  keymap: { of: jest.fn() },
  gutter: (config: unknown) => gutterMock(config),
  GutterMarker: class {},
}));
jest.mock('@codemirror/state', () => ({
  EditorState: { readOnly: { of: jest.fn(() => 'READONLY') } },
  RangeSet: { of: jest.fn() },
}));
jest.mock('../../../components/Editor/codemirror', () => ({
  buildTheme: jest.fn(() => []),
  getLanguageExtension: jest.fn(() => null),
}));
const mockEnsureOpen = jest.fn();
jest.mock('../../../utils/editorNavigation', () => ({
  ensureEditorFileOpen: (...args: unknown[]) => mockEnsureOpen(...args),
}));
// gitStore (imported for its store) transitively loads the ESM wailsjs App
// bindings; mock them so the module graph stays jest-parseable.
jest.mock('../../../../wailsjs/go/main/App', () => ({
  GitStatus: jest.fn(),
  GitStage: jest.fn(),
  GitUnstage: jest.fn(),
  GitCommit: jest.fn(),
  GitPull: jest.fn(),
  GitPush: jest.fn(),
  GitBranches: jest.fn(),
  GitCheckout: jest.fn(),
  GitCommitMessageAvailable: jest.fn(),
  GitGenerateCommitMessage: jest.fn(),
  GitFileAtRev: jest.fn(),
  GitFileHunks: jest.fn(),
  GitApplyHunk: jest.fn(),
  ReadFile: jest.fn(),
  WriteFile: jest.fn(),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { GitDiffView } from '../../../components/Editor/GitDiffView';
import { useGitStore, type DiffSession } from '../../../stores/gitStore';

const base: DiffSession = {
  path: 'src/a.ts',
  absPath: '/repo/src/a.ts',
  context: 'unstaged',
  left: { label: 'Index', content: 'const a = 1;\n' },
  right: { label: 'Working Tree', content: 'const a = 2;\n' },
  binary: false,
  truncated: false,
  hunks: [],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GitDiffView', () => {
  it('mounts a merge view with both revision docs and labels', () => {
    render(<GitDiffView session={base} />);

    expect(screen.getByText('Index')).toBeInTheDocument();
    expect(screen.getByText('Working Tree')).toBeInTheDocument();
    expect(mergeViewMock).toHaveBeenCalledTimes(1);
    const config = mergeViewMock.mock.calls[0][0];
    expect(config.a.doc).toBe('const a = 1;\n');
    expect(config.b.doc).toBe('const a = 2;\n');
    expect(config.parent).toBe(screen.getByTestId('merge-host'));
  });

  it('opens the working-tree file and yields the diff via Open File', () => {
    useGitStore.setState({ diffFocused: true });
    render(<GitDiffView session={base} />);

    fireEvent.click(screen.getByRole('button', { name: /open file/i }));

    expect(mockEnsureOpen).toHaveBeenCalledWith('/repo/src/a.ts');
    expect(useGitStore.getState().diffFocused).toBe(false);
  });

  it('destroys the merge view on unmount', () => {
    const { unmount } = render(<GitDiffView session={base} />);

    unmount();

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the merge view when the session changes', () => {
    const { rerender } = render(<GitDiffView session={base} />);

    rerender(
      <GitDiffView
        session={{ ...base, right: { label: 'Working Tree', content: 'const a = 3;\n' } }}
      />
    );

    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(mergeViewMock).toHaveBeenCalledTimes(2);
  });

  it('shows the difference count and next/previous navigation', () => {
    render(<GitDiffView session={base} />);

    // base session: one changed line → one hunk.
    expect(screen.getByText('1 difference')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /next difference/i }));
    expect(goToNextChunkMock).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /previous difference/i }));
    expect(goToPreviousChunkMock).toHaveBeenCalled();
  });

  it('renders a draggable column divider that updates the split ratio', () => {
    render(<GitDiffView session={base} />);
    const divider = screen.getByRole('separator', { name: /resize diff columns/i });
    const root = screen.getByTestId('diff-root');
    jest
      .spyOn(root, 'getBoundingClientRect')
      .mockReturnValue({ left: 0, width: 1000, top: 0, height: 500 } as DOMRect);

    fireEvent.mouseDown(divider, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window);

    expect(root.style.getPropertyValue('--diff-left')).toBe('30%');
  });

  it('clamps the divider so neither pane collapses', () => {
    render(<GitDiffView session={base} />);
    const divider = screen.getByRole('separator', { name: /resize diff columns/i });
    const root = screen.getByTestId('diff-root');
    jest
      .spyOn(root, 'getBoundingClientRect')
      .mockReturnValue({ left: 0, width: 1000, top: 0, height: 500 } as DOMRect);

    fireEvent.mouseDown(divider, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 5 });
    fireEvent.mouseUp(window);

    expect(root.style.getPropertyValue('--diff-left')).toBe('15%');
  });

  it('supports keyboard resizing on the divider', () => {
    render(<GitDiffView session={base} />);
    const divider = screen.getByRole('separator', { name: /resize diff columns/i });

    fireEvent.keyDown(divider, { key: 'ArrowLeft' });

    expect(screen.getByTestId('diff-root').style.getPropertyValue('--diff-left')).toBe('48%');
  });

  it('builds a hunk-staging gutter on the right pane when the diff has hunks', () => {
    render(
      <GitDiffView session={{ ...base, hunks: [{ patch: 'P', newStart: 1, newLines: 1 }] }} />
    );

    // The right pane (b) gets the extra gutter; the left pane (a) does not.
    expect(gutterMock).toHaveBeenCalledWith(expect.objectContaining({ class: 'cm-hunkGutter' }));
    const config = mergeViewMock.mock.calls[0][0];
    expect(config.b.extensions).toContainEqual({ __gutter: true });
    expect(config.a.extensions).not.toContainEqual({ __gutter: true });
  });

  it('makes only the working-tree (right) pane editable in an unstaged diff', () => {
    render(<GitDiffView session={base} />);

    const config = mergeViewMock.mock.calls[0][0];
    // Left pane is the index snapshot: read-only.
    expect(config.a.extensions).toContain('EDITABLE_FALSE');
    expect(config.a.extensions).toContain('READONLY');
    expect(config.a.extensions).not.toContain('EDIT_LISTENER');
    // Right pane is the live working tree: editable, wired to persist edits.
    expect(config.b.extensions).toContain('EDIT_LISTENER');
    expect(config.b.extensions).not.toContain('EDITABLE_FALSE');
    expect(config.b.extensions).not.toContain('READONLY');
  });

  it('keeps both panes read-only in a staged diff (right side is the index)', () => {
    render(
      <GitDiffView
        session={{
          ...base,
          context: 'staged',
          left: { label: 'HEAD', content: 'const a = 1;\n' },
          right: { label: 'Index', content: 'const a = 2;\n' },
        }}
      />
    );

    const config = mergeViewMock.mock.calls[0][0];
    expect(config.b.extensions).toContain('EDITABLE_FALSE');
    expect(config.b.extensions).toContain('READONLY');
    expect(config.b.extensions).not.toContain('EDIT_LISTENER');
  });

  it('adds no hunk gutter when there are no hunks', () => {
    render(<GitDiffView session={base} />);

    expect(gutterMock).not.toHaveBeenCalled();
  });

  it('renders a binary state instead of a merge view', () => {
    render(<GitDiffView session={{ ...base, binary: true }} />);

    expect(screen.getByTestId('diff-binary')).toBeInTheDocument();
    expect(mergeViewMock).not.toHaveBeenCalled();
  });

  it('renders a too-large state instead of a merge view', () => {
    render(<GitDiffView session={{ ...base, truncated: true }} />);

    expect(screen.getByTestId('diff-too-large')).toBeInTheDocument();
    expect(mergeViewMock).not.toHaveBeenCalled();
  });
});

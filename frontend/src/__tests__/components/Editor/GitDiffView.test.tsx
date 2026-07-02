// @codemirror/* ships untransformed ESM that jest does not transpile (the
// same reason CodeMirrorEditor has no direct render test). Mock the merge
// module and verify the component's construction/teardown contract instead.
const destroyMock = jest.fn();
const fakeSideB = { state: {}, focus: jest.fn() };
const mergeViewMock = jest
  .fn()
  .mockImplementation(() => ({ destroy: destroyMock, a: { state: {} }, b: fakeSideB }));
const goToNextChunkMock = jest.fn((_arg?: unknown) => true);
const goToPreviousChunkMock = jest.fn((_arg?: unknown) => true);
const getChunksMock = jest.fn((_arg?: unknown) => ({ chunks: [{}, {}], side: null }));

jest.mock('@codemirror/merge', () => ({
  MergeView: mergeViewMock,
  goToNextChunk: (arg: unknown) => goToNextChunkMock(arg),
  goToPreviousChunk: (arg: unknown) => goToPreviousChunkMock(arg),
  getChunks: (arg: unknown) => getChunksMock(arg),
}));
jest.mock('@codemirror/view', () => ({
  EditorView: { editable: { of: jest.fn() }, lineWrapping: {} },
  lineNumbers: jest.fn(),
  keymap: { of: jest.fn() },
}));
jest.mock('@codemirror/state', () => ({
  EditorState: { readOnly: { of: jest.fn() } },
}));
jest.mock('../../../components/Editor/codemirror', () => ({
  buildTheme: jest.fn(() => []),
  getLanguageExtension: jest.fn(() => null),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { GitDiffView } from '../../../components/Editor/GitDiffView';
import type { DiffSession } from '../../../stores/gitStore';

const base: DiffSession = {
  path: 'src/a.ts',
  context: 'unstaged',
  left: { label: 'Index', content: 'const a = 1;\n' },
  right: { label: 'Working Tree', content: 'const a = 2;\n' },
  binary: false,
  truncated: false,
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

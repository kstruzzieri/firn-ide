// src/__tests__/components/FileExplorer/FileExplorer.hiddenFolders.test.tsx
// #450: the tree lists dot-folders such as .github, and the explorer header's
// Show hidden folders toggle filters only what is shown.
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileExplorer } from '../../../components/FileExplorer';
import { useIDEStore } from '../../../stores/ideStore';
import { ReadDirectoryShallow } from '../../../wails/bindings';
import { filesystem } from '../../../wails/bindings';
import { installVirtualLayout } from '../../helpers/virtualTree';
import { __resetEnsurePathLoaded } from '../../../hooks/useEnsurePathLoaded';

jest.mock('../../../wails/bindings', () => {
  const actual = jest.requireActual('../../../wails/bindings');
  return {
    ...actual,
    ReadDirectory: jest.fn(),
    ReadDirectoryShallow: jest.fn(),
    ReadFile: jest.fn(),
    OpenFolderDialog: jest.fn(),
  };
});

jest.mock('../../../wails/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

jest.mock('../../../components/FileExplorer/useDirectoryTree', () => ({
  useDirectoryTree: () => ({ refetch: jest.fn() }),
}));

// Constructor, not createFrom: createFrom turns an unloaded (undefined)
// children list into [] (see FileExplorer.lazy.test.tsx).
const entry = (path: string, isDir: boolean, children?: filesystem.FileEntry[]) =>
  new filesystem.FileEntry({
    name: path.split('/').pop()!,
    path,
    isDir,
    size: 0,
    modTime: new Date().toISOString(),
    children,
  });

const toggleButton = () => screen.getByRole('button', { name: 'Show hidden folders' });

describe('FileExplorer Show hidden folders', () => {
  let restoreVirtualLayout: () => void;

  beforeEach(() => {
    restoreVirtualLayout = installVirtualLayout(400);
    jest.clearAllMocks();
    __resetEnsurePathLoaded();
    localStorage.clear();
    useIDEStore.setState({
      workspace: { name: 'r', path: '/r' },
      isLoading: false,
      isLoadingTree: false,
      treeError: null,
      directoryTree: [
        entry('/r/.github', true, [entry('/r/.github/ci.yml', false)]),
        entry('/r/src', true, [entry('/r/src/a.ts', false)]),
        entry('/r/.env', false),
      ],
      expandedPaths: new Set(['/r/.github']),
      selectedPath: null,
      activeFileId: null,
      isRootExpanded: true,
      loadingPaths: new Set<string>(),
      dirtyPaths: new Set<string>(),
      showHiddenFolders: true,
      toast: null,
    });
  });

  afterEach(() => {
    restoreVirtualLayout();
  });

  it('lists dot-folders by default, with a pressed toggle button', () => {
    render(<FileExplorer />);
    expect(screen.getByRole('treeitem', { name: '.github' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'ci.yml' })).toBeInTheDocument();
    expect(toggleButton()).toHaveAttribute('aria-pressed', 'true');
    expect(toggleButton()).toHaveAttribute('type', 'button');
  });

  it('hides and restores dot-folders without a read, keeping the stored tree', async () => {
    const user = userEvent.setup();
    render(<FileExplorer />);
    const stored = useIDEStore.getState().directoryTree;

    await user.click(toggleButton());
    expect(toggleButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('treeitem', { name: '.github' })).not.toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'ci.yml' })).not.toBeInTheDocument();
    // Dot-files stay listed.
    expect(screen.getByRole('treeitem', { name: '.env' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'src' })).toHaveAttribute('aria-setsize', '2');
    expect(useIDEStore.getState().directoryTree).toBe(stored);
    expect(useIDEStore.getState().expandedPaths.has('/r/.github')).toBe(true);

    await user.click(toggleButton());
    expect(screen.getByRole('treeitem', { name: 'ci.yml' })).toBeInTheDocument();
    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
  });

  it('moves keyboard focus past hidden folders', async () => {
    const user = userEvent.setup();
    act(() => useIDEStore.setState({ showHiddenFolders: false }));
    render(<FileExplorer />);

    // Clicking the root row would collapse it; start from a file row.
    await user.click(screen.getByRole('treeitem', { name: '.env' }));
    await user.keyboard('{Home}{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: 'src' })).toHaveFocus();
  });

  it('shows the empty state when only hidden folders remain', () => {
    act(() =>
      useIDEStore.setState({
        directoryTree: [entry('/r/.github', true, [])],
        showHiddenFolders: false,
      })
    );
    render(<FileExplorer />);
    expect(screen.getByText('No files in workspace')).toBeInTheDocument();
    // The toggle stays reachable, so the folders can be shown again.
    expect(toggleButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not reveal an active file inside a hidden folder', async () => {
    act(() =>
      useIDEStore.setState({
        directoryTree: [entry('/r/.github', true)],
        expandedPaths: new Set<string>(),
        showHiddenFolders: false,
      })
    );
    render(<FileExplorer />);
    act(() => useIDEStore.setState({ activeFileId: '/r/.github/ci.yml' }));

    await waitFor(() => expect(useIDEStore.getState().selectedPath).toBe('/r/.github/ci.yml'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
    expect(useIDEStore.getState().expandedPaths.has('/r/.github')).toBe(false);
  });
});

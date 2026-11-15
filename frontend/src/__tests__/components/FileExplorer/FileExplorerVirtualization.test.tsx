// src/__tests__/components/FileExplorer/FileExplorerVirtualization.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { FileExplorer } from '../../../components/FileExplorer/FileExplorer';
import { useIDEStore } from '../../../stores/ideStore';
import { installVirtualLayout } from '../../helpers/virtualTree';
import type { filesystem, workspace } from '../../../wails/bindings';

// FileExplorer mounts useDirectoryTree, which auto-fetches through Wails when a
// workspace exists. This test seeds the store directly, so prevent the fetch.
const mockRefetch = jest.fn();
jest.mock('../../../components/FileExplorer/useDirectoryTree', () => ({
  useDirectoryTree: () => ({ refetch: mockRefetch }),
}));

jest.mock('../../../wails/bindings', () => ({
  ReadDirectory: jest.fn(),
  ReadFile: jest.fn(),
  OpenFolderDialog: jest.fn(),
}));

jest.mock('../../../wails/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

function makeFlatTree(n: number): filesystem.FileEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `file-${i}.ts`,
    path: `/repo/file-${i}.ts`,
    isDir: false,
    size: 0,
    modTime: '',
  })) as filesystem.FileEntry[];
}

describe('FileExplorer virtualization', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installVirtualLayout(400);
  });
  afterEach(() => {
    cleanup();
    restore();
    jest.clearAllMocks();
    act(() => {
      useIDEStore.setState({
        workspace: null,
        workspaces: [],
        activeWorkspaceId: 'project',
        lastFocusedWorkspaceId: null,
        directoryTree: [],
        expandedPaths: new Set(),
        selectedPath: null,
        activeFileId: null,
        isRootExpanded: true,
        isLoadingTree: false,
        treeError: null,
      });
    });
  });

  it('mounts only a bounded window of rows for a large tree', () => {
    const tree = makeFlatTree(5000);
    tree[0].unreadable = true;
    act(() => {
      useIDEStore.setState({
        // workspace is WorkspaceInfo: { name, path }
        workspace: { name: 'repo', path: '/repo' },
        workspaces: [
          { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
        ] as workspace.WorkspaceDef[],
        activeWorkspaceId: 'project',
        directoryTree: tree,
        isRootExpanded: true,
        isLoadingTree: false,
        treeError: null,
      });
    });

    render(<FileExplorer />);

    const rendered = screen.getAllByRole('treeitem');
    expect(screen.getByRole('treeitem', { name: 'file-0.ts, unreadable' })).toBeInTheDocument();
    expect(screen.getByTestId('unreadable-indicator')).toHaveAttribute('aria-hidden', 'true');
    // 400px / 28px ≈ 15 visible + overscan + root, nowhere near 5000.
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
  });

  it('moves actual focus across offscreen rows and retains it when the viewport scrolls away', async () => {
    const user = userEvent.setup();
    act(() =>
      useIDEStore.setState({
        workspace: { name: 'repo', path: '/repo' },
        directoryTree: makeFlatTree(5000),
        selectedPath: null,
        activeFileId: null,
        isRootExpanded: true,
        isLoadingTree: false,
        treeError: null,
      })
    );
    render(<FileExplorer />);
    const tree = screen.getByRole('tree');
    // jsdom has no scrolling layout; retain the real virtualizer and supply the
    // scroll geometry/events a browser supplies for this 5001-row fixture.
    Object.defineProperty(tree, 'scrollHeight', { configurable: true, value: 5001 * 28 });
    tree.scrollTo = (options) => {
      tree.scrollTop = (options as ScrollToOptions).top ?? 0;
      queueMicrotask(() => fireEvent.scroll(tree));
    };
    await user.click(screen.getByRole('treeitem', { name: 'file-0.ts' }));
    await user.keyboard('{End}');
    const last = screen.getByRole('treeitem', { name: 'file-4999.ts' });
    expect(last).toHaveFocus();
    expect(tree.scrollTop).toBeGreaterThan(100000);
    expect(screen.queryByRole('treeitem', { name: 'file-0.ts' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(100);

    fireEvent.scroll(tree, { target: { scrollTop: 0 } });
    expect(last).toHaveFocus();
    expect(screen.getByRole('treeitem', { name: 'file-0.ts' })).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(100);

    // A refresh that shifts the focused row leaves the viewport where it is.
    act(() =>
      useIDEStore.setState({
        directoryTree: [
          { name: 'a-new.ts', path: '/repo/a-new.ts', isDir: false, size: 0, modTime: '' },
          ...makeFlatTree(5000),
        ] as filesystem.FileEntry[],
      })
    );
    expect(tree.scrollTop).toBe(0);
    expect(last).toHaveFocus();

    await user.keyboard('{End}');
    expect(last).toHaveFocus();
    expect(tree.scrollTop).toBeGreaterThan(100000);

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('treeitem', { name: 'file-4998.ts' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('treeitem', { name: /repo.*\/repo/ })).toHaveFocus();
    expect(tree.scrollTop).toBe(0);
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(100);
  });
});

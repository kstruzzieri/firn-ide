import { renderHook, waitFor } from '@testing-library/react';
import { useDirectoryTree } from '../../../components/FileExplorer/useDirectoryTree';
import { useIDEStore, type FileEntry } from '../../../stores/ideStore';
import { ReadDirectoryShallow } from '../../../../wailsjs/go/main/App';
import { getCachedWorkspaceTree } from '../../../utils/workspaceTreeCache';
import { ensurePathLoaded, __resetEnsurePathLoaded } from '../../../hooks/useEnsurePathLoaded';
import { act } from 'react';

jest.mock('../../../../wailsjs/go/main/App', () => ({
  ReadDirectory: jest.fn(),
  ReadDirectoryShallow: jest.fn(),
  ReadFile: jest.fn(),
  OpenFolderDialog: jest.fn(),
}));

jest.mock('../../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

// ponytail: mock cache so every test starts with no cached tree (forces loading path)
jest.mock('../../../utils/workspaceTreeCache', () => ({
  getCachedWorkspaceTree: jest.fn().mockReturnValue(undefined),
  setCachedWorkspaceTree: jest.fn(),
}));
const mockGetCachedTree = getCachedWorkspaceTree as jest.Mock;

const dir = (path: string, children?: FileEntry[]): FileEntry =>
  ({
    name: path.split('/').pop()!,
    path,
    isDir: true,
    size: 0,
    modTime: '',
    children,
  }) as FileEntry;
const file = (path: string): FileEntry =>
  ({
    name: path.split('/').pop()!,
    path,
    isDir: false,
    size: 0,
    modTime: '',
  }) as FileEntry;

describe('useDirectoryTree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetEnsurePathLoaded();
    mockGetCachedTree.mockReturnValue(undefined);
    act(() => {
      useIDEStore.setState({
        workspace: { name: 'test-project', path: '/workspace' },
        directoryTree: [],
        isLoadingTree: false,
        treeError: null,
        toast: null,
        dirtyPaths: new Set(),
      });
    });
  });

  it('calls ReadDirectoryShallow with the workspace path on mount', async () => {
    (ReadDirectoryShallow as jest.Mock).mockResolvedValue([]);

    renderHook(() => useDirectoryTree());

    await waitFor(() => {
      expect(ReadDirectoryShallow).toHaveBeenCalledWith('/workspace', '/workspace');
    });
  });

  it('preserves hydrated subtrees when the shallow root fetch resolves', async () => {
    (ReadDirectoryShallow as jest.Mock).mockResolvedValue([dir('/workspace/src')]);
    act(() => {
      useIDEStore.setState({
        directoryTree: [dir('/workspace/src', [file('/workspace/src/main.ts')])],
      });
    });

    renderHook(() => useDirectoryTree());

    await waitFor(() => {
      expect(useIDEStore.getState().directoryTree[0].children).toEqual([
        file('/workspace/src/main.ts'),
      ]);
    });
  });

  it('does not call ReadDirectoryShallow when workspace has no path', async () => {
    act(() => {
      useIDEStore.setState({ workspace: null });
    });

    renderHook(() => useDirectoryTree());

    // Give effects a tick to settle
    await act(async () => {});

    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
  });

  it('surfaces an uncached root failure as the tree error', async () => {
    (ReadDirectoryShallow as jest.Mock).mockRejectedValue(
      new Error('open /private/workspace: permission denied')
    );

    renderHook(() => useDirectoryTree());

    await waitFor(() => {
      expect(useIDEStore.getState().treeError).toBe('Failed to read directory');
    });
  });

  it('keeps a cached root tree visible and toasts when its refresh fails', async () => {
    const cached = [dir('/workspace/src', [file('/workspace/src/main.ts')])];
    mockGetCachedTree.mockReturnValue(cached);
    (ReadDirectoryShallow as jest.Mock)
      .mockRejectedValueOnce(new Error('/private/root denied'))
      .mockResolvedValueOnce([file('/workspace/fresh.ts')]);
    act(() => {
      useIDEStore.setState({ directoryTree: cached, treeError: null, toast: null });
    });

    renderHook(() => useDirectoryTree());

    await waitFor(() => {
      expect(useIDEStore.getState().toast).toEqual({
        message: 'Failed to refresh file tree',
        type: 'error',
      });
    });
    expect(useIDEStore.getState().directoryTree).toBe(cached);
    expect(useIDEStore.getState().treeError).toBeNull();
    expect(useIDEStore.getState().dirtyPaths.has('/workspace')).toBe(true);

    await act(async () => {
      await ensurePathLoaded('/workspace');
    });
    expect(ReadDirectoryShallow).toHaveBeenCalledTimes(2);
    expect(useIDEStore.getState().dirtyPaths.has('/workspace')).toBe(false);
    expect(useIDEStore.getState().directoryTree).toEqual([file('/workspace/fresh.ts')]);
  });

  it('surfaces a cached-empty root failure instead of claiming the workspace is empty', async () => {
    mockGetCachedTree.mockReturnValue([]);
    (ReadDirectoryShallow as jest.Mock).mockRejectedValue(new Error('/private/root denied'));

    renderHook(() => useDirectoryTree());

    await waitFor(() => {
      expect(useIDEStore.getState().treeError).toBe('Failed to read directory');
    });
    expect(useIDEStore.getState().toast).toBeNull();
  });

  it('drops a root failure after the workspace closes', async () => {
    let reject!: (reason: unknown) => void;
    (ReadDirectoryShallow as jest.Mock).mockReturnValue(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      })
    );

    renderHook(() => useDirectoryTree());
    await waitFor(() => {
      expect(ReadDirectoryShallow).toHaveBeenCalledWith('/workspace', '/workspace');
    });

    act(() => {
      useIDEStore.setState({ workspace: null });
    });
    await act(async () => {
      reject(new Error('open /private/workspace: permission denied'));
      await Promise.resolve();
    });

    const state = useIDEStore.getState();
    expect(state.directoryTree).toEqual([]);
    expect(state.treeError).toBeNull();
    expect(state.toast).toBeNull();
  });

  it('drops a root result from an unmounted hook instance after remount', async () => {
    let resolveOld!: (entries: FileEntry[]) => void;
    let resolveFresh!: (entries: FileEntry[]) => void;
    (ReadDirectoryShallow as jest.Mock)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFresh = resolve;
        })
      );

    const oldHook = renderHook(() => useDirectoryTree());
    await waitFor(() => {
      expect(ReadDirectoryShallow).toHaveBeenCalledTimes(1);
    });
    oldHook.unmount();

    const freshHook = renderHook(() => useDirectoryTree());
    await waitFor(() => {
      expect(ReadDirectoryShallow).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      resolveFresh([file('/workspace/fresh.ts')]);
      await Promise.resolve();
    });
    expect(useIDEStore.getState().directoryTree).toEqual([file('/workspace/fresh.ts')]);

    await act(async () => {
      resolveOld([file('/workspace/stale.ts')]);
      await Promise.resolve();
    });
    expect(useIDEStore.getState().directoryTree).toEqual([file('/workspace/fresh.ts')]);
    freshHook.unmount();
  });

  it('drops a root result after a batched same-path workspace reopen', async () => {
    let resolveOld!: (entries: FileEntry[]) => void;
    let resolveFresh!: (entries: FileEntry[]) => void;
    (ReadDirectoryShallow as jest.Mock)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFresh = resolve;
        })
      );

    renderHook(() => useDirectoryTree());
    await waitFor(() => {
      expect(ReadDirectoryShallow).toHaveBeenCalledTimes(1);
    });

    const reopenedWorkspace = { name: 'reopened-project', path: '/workspace' };
    const reopenedTree = [file('/workspace/reopened.ts')];
    act(() => {
      useIDEStore.setState({
        workspace: { name: 'other-project', path: '/other' },
        directoryTree: [],
      });
      useIDEStore.setState({
        workspace: reopenedWorkspace,
        directoryTree: reopenedTree,
      });
    });

    await waitFor(() => {
      expect(ReadDirectoryShallow).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveOld([file('/workspace/stale.ts')]);
      await Promise.resolve();
    });
    expect(useIDEStore.getState().workspace).toBe(reopenedWorkspace);
    expect(useIDEStore.getState().directoryTree).toEqual(reopenedTree);

    await act(async () => {
      resolveFresh([file('/workspace/fresh.ts')]);
      await Promise.resolve();
    });
    expect(useIDEStore.getState().directoryTree).toEqual([file('/workspace/fresh.ts')]);
  });
});

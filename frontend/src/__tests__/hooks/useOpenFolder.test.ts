import { renderHook, act } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';
import { filesystem } from '../../../wailsjs/go/models';

// Mock Wails bindings
const mockOpenFolderDialog = jest.fn();
jest.mock('../../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: (...args: unknown[]) => mockOpenFolderDialog(...args),
}));

const mockWindowSetTitle = jest.fn();
jest.mock('../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: (...args: unknown[]) => mockWindowSetTitle(...args),
}));

import { useOpenFolder, _resetOpeningLock } from '../../hooks/useOpenFolder';

beforeEach(() => {
  jest.clearAllMocks();
  _resetOpeningLock();
  useIDEStore.setState({
    workspace: null,
    directoryTree: [],
    isLoadingTree: false,
    treeError: null,
    toast: null,
  });
});

describe('useOpenFolder', () => {
  it('should call OpenFolderDialog and set workspace', async () => {
    mockOpenFolderDialog.mockResolvedValue('/Users/test/my-project');

    const { result } = renderHook(() => useOpenFolder());

    await act(async () => {
      await result.current.openFolder();
    });

    const state = useIDEStore.getState();
    expect(state.workspace).toEqual({
      name: 'my-project',
      path: '/Users/test/my-project',
    });
  });

  it('should update window title with folder name', async () => {
    mockOpenFolderDialog.mockResolvedValue('/Users/test/my-project');

    const { result } = renderHook(() => useOpenFolder());

    await act(async () => {
      await result.current.openFolder();
    });

    expect(mockWindowSetTitle).toHaveBeenCalledWith('my-project — Firn');
  });

  it('should do nothing when dialog is cancelled', async () => {
    mockOpenFolderDialog.mockResolvedValue('');

    const { result } = renderHook(() => useOpenFolder());

    await act(async () => {
      await result.current.openFolder();
    });

    const state = useIDEStore.getState();
    expect(state.workspace).toBeNull();
    expect(mockWindowSetTitle).not.toHaveBeenCalled();
  });

  it('should show toast on failure', async () => {
    mockOpenFolderDialog.mockRejectedValue(new Error('Permission denied'));

    const { result } = renderHook(() => useOpenFolder());

    await act(async () => {
      await result.current.openFolder();
    });

    const state = useIDEStore.getState();
    expect(state.toast).toEqual({
      message: 'Failed to open folder: Permission denied',
      type: 'error',
    });
  });

  it('should guard against concurrent invocations across hook instances', async () => {
    // First call blocks on the dialog
    let resolveFirst: (value: string) => void;
    mockOpenFolderDialog.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolveFirst = resolve))
    );

    // Mount two independent instances (simulates Header + keyboard shortcut)
    const { result: instance1 } = renderHook(() => useOpenFolder());
    const { result: instance2 } = renderHook(() => useOpenFolder());

    // Start first call from instance1 (won't resolve yet)
    const first = act(async () => {
      await instance1.current.openFolder();
    });

    // Second call from instance2 should be a no-op (shared lock)
    await act(async () => {
      await instance2.current.openFolder();
    });

    // Only one dialog call
    expect(mockOpenFolderDialog).toHaveBeenCalledTimes(1);

    // Resolve first to clean up
    resolveFirst!('');
    await first;
  });

  it('should clear stale tree and set loading before setting workspace', async () => {
    // Simulate an already-loaded workspace with tree data
    useIDEStore.setState({
      workspace: { name: 'old-project', path: '/old' },
      directoryTree: [{ name: 'stale.ts' }] as unknown as filesystem.FileEntry[],
      isLoadingTree: false,
    });

    mockOpenFolderDialog.mockResolvedValue('/Users/test/new-project');

    const { result } = renderHook(() => useOpenFolder());

    await act(async () => {
      await result.current.openFolder();
    });

    const state = useIDEStore.getState();
    // Workspace should be updated
    expect(state.workspace?.name).toBe('new-project');
    // Tree should have been cleared (setDirectoryTree([]) resets isLoadingTree to false via store action)
    expect(state.directoryTree).toEqual([]);
  });

  it('should handle Windows path separators', async () => {
    mockOpenFolderDialog.mockResolvedValue('C:\\Users\\test\\my-project');

    const { result } = renderHook(() => useOpenFolder());

    await act(async () => {
      await result.current.openFolder();
    });

    const state = useIDEStore.getState();
    expect(state.workspace).toEqual({
      name: 'my-project',
      path: 'C:\\Users\\test\\my-project',
    });
    expect(mockWindowSetTitle).toHaveBeenCalledWith('my-project — Firn');
  });
});

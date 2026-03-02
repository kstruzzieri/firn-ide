import { renderHook, act } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';

// Mock Wails bindings
const mockOpenFolderDialog = jest.fn();
jest.mock('../../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: (...args: unknown[]) => mockOpenFolderDialog(...args),
}));

const mockWindowSetTitle = jest.fn();
jest.mock('../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: (...args: unknown[]) => mockWindowSetTitle(...args),
}));

import { useOpenFolder } from '../../hooks/useOpenFolder';

beforeEach(() => {
  jest.clearAllMocks();
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

  it('should guard against concurrent invocations', async () => {
    // First call blocks on the dialog
    let resolveFirst: (value: string) => void;
    mockOpenFolderDialog.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolveFirst = resolve))
    );

    const { result } = renderHook(() => useOpenFolder());

    // Start first call (won't resolve yet)
    const first = act(async () => {
      await result.current.openFolder();
    });

    // Second call should be a no-op
    await act(async () => {
      await result.current.openFolder();
    });

    // Only one dialog call
    expect(mockOpenFolderDialog).toHaveBeenCalledTimes(1);

    // Resolve first to clean up
    resolveFirst!('');
    await first;
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

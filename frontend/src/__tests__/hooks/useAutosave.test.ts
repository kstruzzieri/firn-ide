import { renderHook, act } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';

// Mock Wails WriteFile
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../wailsjs/go/main/App', () => ({
  WriteFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// Import after mocks
import { useAutosave } from '../../hooks/useAutosave';

beforeEach(() => {
  jest.useFakeTimers();
  mockWriteFile.mockClear();
  useIDEStore.setState({
    openFiles: [],
    activeFileId: null,
    toast: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function openTestFile(overrides = {}) {
  useIDEStore.getState().openFile({
    id: '/test/file.ts',
    name: 'file.ts',
    path: '/test/file.ts',
    language: 'typescript',
    encoding: 'utf-8',
    lineEndings: 'LF',
    content: 'original',
    isModified: false,
    ...overrides,
  });
  useIDEStore.setState({ activeFileId: '/test/file.ts' });
}

describe('useAutosave', () => {
  it('should save file after idle timeout', async () => {
    openTestFile();
    renderHook(() => useAutosave());

    // Simulate content change
    act(() => {
      useIDEStore.getState().updateFileContent('/test/file.ts', 'modified');
    });

    // Advance past debounce
    act(() => {
      jest.advanceTimersByTime(1600);
    });

    // Wait for async WriteFile
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockWriteFile).toHaveBeenCalledWith('/test/file.ts', 'modified', 'utf-8', 'LF', false);
  });

  it('should clear modified flag after successful save', async () => {
    openTestFile();
    renderHook(() => useAutosave());

    act(() => {
      useIDEStore.getState().updateFileContent('/test/file.ts', 'modified');
    });

    act(() => {
      jest.advanceTimersByTime(1600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const file = useIDEStore.getState().openFiles[0];
    expect(file.isModified).toBe(false);
  });

  it('should show toast on save failure', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('Permission denied'));
    openTestFile();
    renderHook(() => useAutosave());

    act(() => {
      useIDEStore.getState().updateFileContent('/test/file.ts', 'modified');
    });

    act(() => {
      jest.advanceTimersByTime(1600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const toast = useIDEStore.getState().toast;
    expect(toast).not.toBeNull();
    expect(toast?.type).toBe('error');
  });

  it('should not save unmodified files', () => {
    openTestFile();
    renderHook(() => useAutosave());

    // No content change, just advance time
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

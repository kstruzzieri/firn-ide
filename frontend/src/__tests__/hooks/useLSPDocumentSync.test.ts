import { renderHook, act } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';

// Mock Wails LSP bindings
const mockDidOpen = jest.fn().mockResolvedValue(undefined);
const mockDidChange = jest.fn().mockResolvedValue(undefined);
const mockDidSave = jest.fn().mockResolvedValue(undefined);
const mockDidClose = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../wailsjs/go/main/App', () => ({
  LSPDidOpen: (...args: unknown[]) => mockDidOpen(...args),
  LSPDidChange: (...args: unknown[]) => mockDidChange(...args),
  LSPDidSave: (...args: unknown[]) => mockDidSave(...args),
  LSPDidClose: (...args: unknown[]) => mockDidClose(...args),
}));

jest.mock('../../../wailsjs/go/models', () => ({
  lsp: {
    TextDocumentContentChangeEvent: class {
      text: string;
      range?: unknown;
      constructor(source: { text: string; range?: unknown }) {
        this.text = source.text;
        this.range = source.range;
      }
    },
  },
}));

// Import after mocks
import { useLSPDocumentSync } from '../../hooks/useLSPDocumentSync';

beforeEach(() => {
  jest.useFakeTimers();
  mockDidOpen.mockClear();
  mockDidChange.mockClear();
  mockDidSave.mockClear();
  mockDidClose.mockClear();
  useIDEStore.setState({
    openFiles: [],
    activeFileId: null,
    workspace: { name: 'test', path: '/test/workspace' },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function openTestFile(overrides = {}) {
  const file = {
    id: '/test/workspace/main.ts',
    name: 'main.ts',
    path: '/test/workspace/main.ts',
    language: 'typescript',
    encoding: 'utf-8',
    lineEndings: 'LF',
    content: 'const x = 1;',
    isModified: false,
    ...overrides,
  };
  useIDEStore.getState().openFile(file);
  return file;
}

describe('useLSPDocumentSync', () => {
  describe('didOpen', () => {
    it('should send didOpen when a TS file is opened', async () => {
      renderHook(() => useLSPDocumentSync());

      act(() => {
        openTestFile();
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockDidOpen).toHaveBeenCalledTimes(1);
      expect(mockDidOpen).toHaveBeenCalledWith(
        '/test/workspace/main.ts',
        'typescript',
        1,
        'const x = 1;'
      );
    });

    it('should not send didOpen for unsupported file types', async () => {
      renderHook(() => useLSPDocumentSync());

      act(() => {
        openTestFile({
          id: '/test/workspace/readme.md',
          name: 'readme.md',
          path: '/test/workspace/readme.md',
        });
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockDidOpen).not.toHaveBeenCalled();
    });

    it('should not send duplicate didOpen for the same file', async () => {
      renderHook(() => useLSPDocumentSync());

      act(() => {
        openTestFile();
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Close and reopen should send didClose then didOpen
      act(() => {
        useIDEStore.getState().closeFile('/test/workspace/main.ts');
      });

      act(() => {
        openTestFile();
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockDidOpen).toHaveBeenCalledTimes(2);
      expect(mockDidClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('didChange', () => {
    it('should send debounced didChange when content changes', async () => {
      renderHook(() => useLSPDocumentSync());

      act(() => {
        openTestFile();
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Simulate content change
      act(() => {
        useIDEStore.getState().updateFileContent('/test/workspace/main.ts', 'const x = 2;');
      });

      // Should not have sent yet (debounce)
      expect(mockDidChange).not.toHaveBeenCalled();

      // Advance past 150ms debounce
      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockDidChange).toHaveBeenCalledTimes(1);
      expect(mockDidChange).toHaveBeenCalledWith(
        '/test/workspace/main.ts',
        2,
        expect.arrayContaining([expect.objectContaining({ text: 'const x = 2;' })])
      );
    });

    it('should coalesce rapid changes into one didChange', async () => {
      renderHook(() => useLSPDocumentSync());

      act(() => {
        openTestFile();
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Three rapid changes
      act(() => {
        useIDEStore.getState().updateFileContent('/test/workspace/main.ts', 'const x = 2;');
      });
      act(() => {
        jest.advanceTimersByTime(50);
        useIDEStore.getState().updateFileContent('/test/workspace/main.ts', 'const x = 3;');
      });
      act(() => {
        jest.advanceTimersByTime(50);
        useIDEStore.getState().updateFileContent('/test/workspace/main.ts', 'const x = 4;');
      });

      // Advance past debounce from last change
      act(() => {
        jest.advanceTimersByTime(200);
      });

      // Only the final content should be sent
      expect(mockDidChange).toHaveBeenCalledTimes(1);
      expect(mockDidChange).toHaveBeenCalledWith(
        '/test/workspace/main.ts',
        expect.any(Number),
        expect.arrayContaining([expect.objectContaining({ text: 'const x = 4;' })])
      );
    });
  });

  describe('didSave', () => {
    it('should send didSave when isModified transitions to false', async () => {
      renderHook(() => useLSPDocumentSync());

      act(() => {
        openTestFile();
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Simulate edit then save
      act(() => {
        useIDEStore.getState().updateFileContent('/test/workspace/main.ts', 'const x = 2;');
      });

      act(() => {
        useIDEStore.getState().setFileModified('/test/workspace/main.ts', false);
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockDidSave).toHaveBeenCalledTimes(1);
      expect(mockDidSave).toHaveBeenCalledWith('/test/workspace/main.ts');
    });
  });

  describe('didClose', () => {
    it('should send didClose when a tab is closed', async () => {
      renderHook(() => useLSPDocumentSync());

      act(() => {
        openTestFile();
      });

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        useIDEStore.getState().closeFile('/test/workspace/main.ts');
      });

      expect(mockDidClose).toHaveBeenCalledTimes(1);
      expect(mockDidClose).toHaveBeenCalledWith('/test/workspace/main.ts');
    });

    it('should cancel pending didChange on close', async () => {
      renderHook(() => useLSPDocumentSync());

      act(() => {
        openTestFile();
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Start a change
      act(() => {
        useIDEStore.getState().updateFileContent('/test/workspace/main.ts', 'const x = 2;');
      });

      // Close before debounce fires
      act(() => {
        useIDEStore.getState().closeFile('/test/workspace/main.ts');
      });

      // Advance past debounce — should NOT send didChange
      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockDidChange).not.toHaveBeenCalled();
      expect(mockDidClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('workspace switch', () => {
    it('should close all documents when workspace changes', async () => {
      renderHook(() => useLSPDocumentSync());

      // Open two files
      act(() => {
        openTestFile();
        openTestFile({
          id: '/test/workspace/utils.ts',
          name: 'utils.ts',
          path: '/test/workspace/utils.ts',
          content: 'export const y = 2;',
        });
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockDidOpen).toHaveBeenCalledTimes(2);

      // Switch workspace
      act(() => {
        useIDEStore.setState({
          workspace: { name: 'other', path: '/other/workspace' },
        });
      });

      // Both files should get didClose
      expect(mockDidClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('version tracking', () => {
    it('should increment version numbers monotonically', async () => {
      renderHook(() => useLSPDocumentSync());

      act(() => {
        openTestFile();
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Version 1 on open
      expect(mockDidOpen).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        1,
        expect.any(String)
      );

      // Change content
      act(() => {
        useIDEStore.getState().updateFileContent('/test/workspace/main.ts', 'v2');
      });
      act(() => {
        jest.advanceTimersByTime(200);
      });

      // Version 2 on change
      expect(mockDidChange).toHaveBeenCalledWith(expect.any(String), 2, expect.any(Array));

      // Another change
      act(() => {
        useIDEStore.getState().updateFileContent('/test/workspace/main.ts', 'v3');
      });
      act(() => {
        jest.advanceTimersByTime(200);
      });

      // Version 3
      expect(mockDidChange).toHaveBeenLastCalledWith(expect.any(String), 3, expect.any(Array));
    });
  });
});

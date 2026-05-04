/**
 * Test: React Testing Library Works
 *
 * Tests that React components can be rendered and tested.
 * TDD: Written first to define expected behavior.
 */

import { act, render, screen } from '@testing-library/react';
import App from '../App';
import { useIDEStore } from '../stores/ideStore';
import { resetLSPDocumentSyncState } from '../utils/lspDocumentSync';
import type { FileEvent } from '../types/watcher';

const mockReadDirectory = jest.fn();
const mockReadFile = jest.fn();
const mockUseFileWatcher = jest.fn();
const mockDidOpen = jest.fn().mockResolvedValue(undefined);
const mockDidChange = jest.fn().mockResolvedValue(undefined);
const mockDidSave = jest.fn().mockResolvedValue(undefined);
const mockDidClose = jest.fn().mockResolvedValue(undefined);

// Mock Wails bindings
jest.mock('../../wailsjs/go/main/App', () => ({
  ReadDirectory: (...args: unknown[]) => mockReadDirectory(...args),
  ReadFile: (...args: unknown[]) => mockReadFile(...args),
  WriteFile: jest.fn(),
  OpenFolderDialog: jest.fn(),
  GetWatchedPath: jest.fn(),
  SetWatchedPath: jest.fn(),
  CreateTerminal: jest.fn(() => Promise.resolve('term-1')),
  WriteTerminal: jest.fn(),
  CloseTerminal: jest.fn(),
  ResizeTerminal: jest.fn(),
  ConfirmBeforeCloseReady: jest.fn(() => Promise.resolve()),
  SaveWorkspaceState: jest.fn(() => Promise.resolve()),
  LoadWorkspaceState: jest.fn(() => Promise.resolve(null)),
  ListRecentWorkspaces: jest.fn(() => Promise.resolve([])),
  LoadRunProfiles: jest.fn(() => Promise.resolve()),
  GetAllRunProfiles: jest.fn(() => Promise.resolve([])),
  LSPDidOpen: (...args: unknown[]) => mockDidOpen(...args),
  LSPDidChange: (...args: unknown[]) => mockDidChange(...args),
  LSPDidSave: (...args: unknown[]) => mockDidSave(...args),
  LSPDidClose: (...args: unknown[]) => mockDidClose(...args),
}));

jest.mock('../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
  EventsOn: jest.fn(() => jest.fn()),
}));

jest.mock('../hooks/useFileWatcher', () => ({
  useFileWatcher: (...args: unknown[]) => mockUseFileWatcher(...args),
}));

jest.mock('../components/Editor', () => ({
  Editor: () => null,
}));

// Mock useDirectoryTree to prevent automatic fetching
jest.mock('../components/FileExplorer/useDirectoryTree', () => ({
  useDirectoryTree: () => ({ refetch: jest.fn() }),
}));

describe('App Component', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReadDirectory.mockReset();
    mockReadFile.mockReset();
    mockUseFileWatcher.mockReset();
    mockDidOpen.mockClear();
    mockDidChange.mockClear();
    mockDidSave.mockClear();
    mockDidClose.mockClear();
    resetLSPDocumentSyncState();
    useIDEStore.setState({
      workspace: null,
      openFiles: [],
      activeFileId: null,
      directoryTree: [],
      treeError: null,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render without crashing', async () => {
    await act(async () => {
      render(<App />);
    });
    // The app should render the IDE shell
    expect(document.body).toBeInTheDocument();
  });

  it('should render the Firn IDE header', async () => {
    await act(async () => {
      render(<App />);
    });
    // Look for the app name in the header
    expect(screen.getByText('Firn')).toBeInTheDocument();
  });

  it.each(['created', 'deleted', 'renamed'] as const)(
    'should refresh the directory tree on %s file watcher events',
    async (type) => {
      useIDEStore.setState({
        workspace: { name: 'workspace', path: '/test/workspace' },
      });

      mockReadDirectory.mockResolvedValueOnce([
        { name: 'new.ts', path: '/test/workspace/new.ts', isDir: false },
      ]);

      await act(async () => {
        render(<App />);
      });

      const watcherCallback = mockUseFileWatcher.mock.calls[0]?.[1] as
        | ((event: FileEvent) => void)
        | undefined;
      expect(watcherCallback).toBeDefined();

      act(() => {
        watcherCallback!({
          type,
          path: '/test/workspace/new.ts',
          isDir: false,
          time: new Date().toISOString(),
        });
        jest.advanceTimersByTime(100);
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockReadDirectory).toHaveBeenCalledWith('/test/workspace');
      expect(useIDEStore.getState().directoryTree).toEqual([
        { name: 'new.ts', path: '/test/workspace/new.ts', isDir: false },
      ]);
    }
  );

  it('should sync LSP content when an unmodified open file is externally reloaded', async () => {
    useIDEStore.setState({
      workspace: { name: 'workspace', path: '/test/workspace' },
    });

    mockReadFile.mockResolvedValueOnce({
      content: 'const x = 2;',
      encoding: 'utf-8',
      lineEndings: 'LF',
    });

    await act(async () => {
      render(<App />);
    });

    act(() => {
      useIDEStore.getState().openFile({
        id: '/test/workspace/main.ts',
        name: 'main.ts',
        path: '/test/workspace/main.ts',
        language: 'typescript',
        encoding: 'utf-8',
        lineEndings: 'LF',
        content: 'const x = 1;',
        isModified: false,
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    const watcherCallback = mockUseFileWatcher.mock.calls[0]?.[1] as
      | ((event: FileEvent) => void)
      | undefined;
    expect(watcherCallback).toBeDefined();

    await act(async () => {
      watcherCallback!({
        type: 'modified',
        path: '/test/workspace/main.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useIDEStore.getState().openFiles[0]).toEqual(
      expect.objectContaining({
        content: 'const x = 2;',
        isModified: false,
      })
    );
    expect(mockDidChange).toHaveBeenCalledWith(
      '/test/workspace/main.ts',
      2,
      expect.arrayContaining([expect.objectContaining({ text: 'const x = 2;' })])
    );
    expect(mockDidSave).toHaveBeenCalledWith('/test/workspace/main.ts');
    expect(mockDidChange.mock.invocationCallOrder[0]).toBeLessThan(
      mockDidSave.mock.invocationCallOrder[0]
    );
  });
});

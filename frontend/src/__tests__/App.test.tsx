/**
 * Test: React Testing Library Works
 *
 * Tests that React components can be rendered and tested.
 * TDD: Written first to define expected behavior.
 */

import { act, render, screen } from '@testing-library/react';
import App from '../App';
import { useIDEStore } from '../stores/ideStore';
import type { FileEvent } from '../types/watcher';

const mockReadDirectory = jest.fn();
const mockReadFile = jest.fn();
const mockUseFileWatcher = jest.fn();

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
}));

jest.mock('../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
  EventsOn: jest.fn(() => jest.fn()),
}));

jest.mock('../hooks/useFileWatcher', () => ({
  useFileWatcher: (...args: unknown[]) => mockUseFileWatcher(...args),
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
});

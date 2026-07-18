/**
 * Test: React Testing Library Works
 *
 * Tests that React components can be rendered and tested.
 * TDD: Written first to define expected behavior.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { useIDEStore } from '../stores/ideStore';
import { useSearchStore } from '../stores/searchStore';
import { resetLSPDocumentSyncState } from '../utils/lspDocumentSync';
import { __resetEnsurePathLoaded } from '../hooks/useEnsurePathLoaded';
import type { FileEvent } from '../types/watcher';

const mockReadDirectory = jest.fn();
const mockReadDirectoryShallow = jest.fn();
const mockReadFile = jest.fn();
const mockUseFileWatcher = jest.fn();
const mockDidOpen = jest.fn().mockResolvedValue(undefined);
const mockDidChange = jest.fn().mockResolvedValue(undefined);
const mockDidSave = jest.fn().mockResolvedValue(undefined);
const mockDidClose = jest.fn().mockResolvedValue(undefined);
const mockSearchWorkspace = jest.fn().mockResolvedValue({});
const mockCancelSearch = jest.fn().mockResolvedValue(undefined);

// Mock Wails bindings
jest.mock('../../wailsjs/go/main/App', () => ({
  ReadDirectory: (...args: unknown[]) => mockReadDirectory(...args),
  ReadDirectoryShallow: (...args: unknown[]) => mockReadDirectoryShallow(...args),
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
  GetRunProfilesSnapshot: jest.fn(() => Promise.resolve({ profiles: [], profileState: {} })),
  SetActiveVariant: jest.fn(() => Promise.resolve()),
  LSPDidOpen: (...args: unknown[]) => mockDidOpen(...args),
  LSPDidChange: (...args: unknown[]) => mockDidChange(...args),
  LSPDidSave: (...args: unknown[]) => mockDidSave(...args),
  LSPDidClose: (...args: unknown[]) => mockDidClose(...args),
  SearchWorkspace: (...args: unknown[]) => mockSearchWorkspace(...args),
  CancelSearch: (...args: unknown[]) => mockCancelSearch(...args),
  DetectWorkspaces: jest.fn(() => Promise.resolve([])),
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

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: jest.fn(),
  });
});

describe('App Component', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReadDirectory.mockReset();
    mockReadDirectoryShallow.mockReset();
    mockReadDirectoryShallow.mockResolvedValue([]);
    mockReadFile.mockReset();
    mockUseFileWatcher.mockReset();
    __resetEnsurePathLoaded();
    mockDidOpen.mockClear();
    mockDidChange.mockClear();
    mockDidSave.mockClear();
    mockDidClose.mockClear();
    mockSearchWorkspace.mockClear();
    mockCancelSearch.mockClear();
    resetLSPDocumentSyncState();
    useIDEStore.setState({
      workspace: null,
      openFiles: [],
      activeFileId: null,
      directoryTree: [],
      treeError: null,
      activeSidebarView: 'explorer',
      isLeftPanelCollapsed: false,
      expandedPaths: new Set<string>(),
      loadingPaths: new Set<string>(),
      dirtyPaths: new Set<string>(),
      isRootExpanded: true,
    });
    useSearchStore.setState({
      query: '',
      options: { regex: false, caseSensitive: false, wholeWord: false },
      uiState: { kind: 'no-workspace' },
      expandedFiles: new Set<string>(),
      activeRequestId: null,
      focusInputRevision: 0,
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

  it('shows the FileExplorer in the left panel when sidebar view is explorer', async () => {
    useIDEStore.setState({ activeSidebarView: 'explorer' });
    await act(async () => {
      render(<App />);
    });
    // SearchPanel exposes a textbox labelled "Search query"; the explorer does not.
    expect(screen.queryByLabelText('Search query')).not.toBeInTheDocument();
  });

  it('routes the left panel to the SearchPanel when sidebar view is search', async () => {
    useIDEStore.setState({ activeSidebarView: 'search' });
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByLabelText('Search query')).toBeInTheDocument();
  });

  it('opens the command palette from Search Everywhere without switching sidebar views', async () => {
    useIDEStore.setState({
      workspace: { name: 'workspace', path: '/test/workspace' },
      activeSidebarView: 'explorer',
      isLeftPanelCollapsed: true,
    });
    await act(async () => {
      render(<App />);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Search everywhere' }));

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toHaveAttribute('open');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Command palette' })).toHaveFocus()
    );
    expect(useIDEStore.getState().activeSidebarView).toBe('explorer');
    expect(screen.queryByRole('textbox', { name: 'Search query' })).not.toBeInTheDocument();
  });

  it.each(['created', 'deleted', 'renamed'] as const)(
    'should surgically reconcile the parent dir on %s file watcher events',
    async (type) => {
      // Seed workspace with root loaded (directoryTree = []) and expanded
      useIDEStore.setState({
        workspace: { name: 'workspace', path: '/test/workspace' },
        directoryTree: [],
        isRootExpanded: true,
      });

      // ReadDirectoryShallow returns the new on-disk state for the root dir
      mockReadDirectoryShallow.mockResolvedValueOnce([
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

      // Surgical reconcile: calls ReadDirectoryShallow on the parent dir, NOT ReadDirectory
      expect(mockReadDirectory).not.toHaveBeenCalled();
      expect(mockReadDirectoryShallow).toHaveBeenCalledWith('/test/workspace', '/test/workspace');
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

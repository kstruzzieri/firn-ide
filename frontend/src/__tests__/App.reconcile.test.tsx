/**
 * Task 10 — surgical watcher reconcile
 *
 * On a file-change event App.tsx should:
 *  - re-read only the changed file's PARENT dir if it is loaded AND visible
 *  - mark dirty (not re-read) if loaded but hidden (collapsed)
 *  - ignore completely if the dir has never been loaded (children === undefined)
 *
 * We fire events by grabbing the watcher callback captured by mockUseFileWatcher,
 * identical to the pattern in App.test.tsx.
 */

import { act, render } from '@testing-library/react';
import App from '../App';
import { useIDEStore } from '../stores/ideStore';
import type { FileEntry } from '../stores/ideStore';
import { useSearchStore } from '../stores/searchStore';
import { resetLSPDocumentSyncState } from '../utils/lspDocumentSync';
import { ReadDirectoryShallow } from '../../wailsjs/go/main/App';
import { __resetEnsurePathLoaded } from '../hooks/useEnsurePathLoaded';
import type { FileEvent } from '../types/watcher';

// ── helpers ───────────────────────────────────────────────────────────────────
// Plain-object helpers avoid FileEntry.convertValues edge cases in tests.
// A loaded dir has children defined (even if empty []).
const loadedDir = (path: string): FileEntry =>
  ({
    name: path.split('/').pop()!,
    path,
    isDir: true,
    size: 0,
    modTime: '',
    children: [],
  }) as FileEntry;
// An unloaded dir has children undefined.
const unloadedDir = (path: string): FileEntry =>
  ({
    name: path.split('/').pop()!,
    path,
    isDir: true,
    size: 0,
    modTime: '',
    children: undefined,
  }) as FileEntry;

// ── mocks ─────────────────────────────────────────────────────────────────────
const mockUseFileWatcher = jest.fn();

jest.mock('../../wailsjs/go/main/App', () => ({
  ReadDirectory: jest.fn(),
  ReadDirectoryShallow: jest.fn(),
  ReadFile: jest.fn(),
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
  LSPDidOpen: jest.fn().mockResolvedValue(undefined),
  LSPDidChange: jest.fn().mockResolvedValue(undefined),
  LSPDidSave: jest.fn().mockResolvedValue(undefined),
  LSPDidClose: jest.fn().mockResolvedValue(undefined),
  SearchWorkspace: jest.fn().mockResolvedValue({}),
  CancelSearch: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../components/FileExplorer/useDirectoryTree', () => ({
  useDirectoryTree: () => ({ refetch: jest.fn() }),
}));

// ── test suite ────────────────────────────────────────────────────────────────
describe('App — surgical watcher reconcile', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    __resetEnsurePathLoaded();
    resetLSPDocumentSyncState();

    // Default: ReadDirectoryShallow succeeds with empty result
    (ReadDirectoryShallow as jest.Mock).mockResolvedValue([]);

    useIDEStore.setState({
      workspace: { name: 'r', path: '/r' },
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

  function getWatcherCallback(): (event: FileEvent) => void {
    const cb = mockUseFileWatcher.mock.calls[0]?.[1] as ((event: FileEvent) => void) | undefined;
    expect(cb).toBeDefined();
    return cb!;
  }

  // ── (a) visible loaded dir → ReadDirectoryShallow called ──────────────────
  it('(a) change under a visible loaded dir triggers ReadDirectoryShallow for that dir', async () => {
    await act(async () => {
      render(<App />);
    });

    // Set state AFTER render: useWorkspacePersistence resets expandedPaths on mount.
    act(() => {
      useIDEStore.setState({
        directoryTree: [loadedDir('/r/a')],
        expandedPaths: new Set(['/r/a']),
        isRootExpanded: true,
      });
    });

    const fire = getWatcherCallback();

    act(() => {
      fire({
        type: 'created',
        path: '/r/a/newfile.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      jest.advanceTimersByTime(100);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).toHaveBeenCalledTimes(1);
    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/a');
  });

  // ── (b) loaded but collapsed dir → markDirty, no fetch ────────────────────
  it('(b) change under a loaded-but-collapsed dir marks it dirty, no ReadDirectoryShallow', async () => {
    await act(async () => {
      render(<App />);
    });

    // Seed: /r/a is loaded (children=[]) but NOT in expandedPaths (collapsed).
    // Set state AFTER render to avoid useWorkspacePersistence resetting it.
    act(() => {
      useIDEStore.setState({
        directoryTree: [loadedDir('/r/a')],
        expandedPaths: new Set<string>(), // /r/a NOT expanded
        isRootExpanded: true,
      });
    });

    const fire = getWatcherCallback();

    act(() => {
      fire({
        type: 'deleted',
        path: '/r/a/oldfile.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      jest.advanceTimersByTime(100);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
    expect(useIDEStore.getState().dirtyPaths.has('/r/a')).toBe(true);
  });

  // ── (c) unloaded dir → ignored entirely ────────────────────────────────────
  it('(c) change under an unloaded dir is ignored — no fetch, not dirty', async () => {
    await act(async () => {
      render(<App />);
    });

    // Seed: /r/b has children === undefined (never loaded).
    // Set state AFTER render to avoid useWorkspacePersistence resetting it.
    act(() => {
      useIDEStore.setState({
        directoryTree: [unloadedDir('/r/b')],
        expandedPaths: new Set<string>(),
        isRootExpanded: true,
      });
    });

    const fire = getWatcherCallback();

    act(() => {
      fire({
        type: 'renamed',
        path: '/r/b/something.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      jest.advanceTimersByTime(100);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
    expect(useIDEStore.getState().dirtyPaths.has('/r/b')).toBe(false);
  });

  // ── (d) two visible dirs → two independent ReadDirectoryShallow calls ──────
  it('(d) changes under two different visible dirs each trigger their own ReadDirectoryShallow', async () => {
    await act(async () => {
      render(<App />);
    });

    // Seed: /r/a and /r/c are both loaded and expanded.
    // Set state AFTER render to avoid useWorkspacePersistence resetting it.
    act(() => {
      useIDEStore.setState({
        directoryTree: [loadedDir('/r/a'), loadedDir('/r/c')],
        expandedPaths: new Set(['/r/a', '/r/c']),
        isRootExpanded: true,
      });
    });

    const fire = getWatcherCallback();

    act(() => {
      fire({
        type: 'created',
        path: '/r/a/file1.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      fire({
        type: 'created',
        path: '/r/c/file2.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      jest.advanceTimersByTime(100);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).toHaveBeenCalledTimes(2);
    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/a');
    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/c');
  });
});

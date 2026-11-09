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
import { clearWorkspaceTreeCache } from '../utils/workspaceTreeCache';
import type { FileEntry } from '../stores/ideStore';
import type { workspace } from '../wails/bindings';
import { useSearchStore } from '../stores/searchStore';
import { useGitStore, GIT_REFRESH_DEBOUNCE_MS } from '../stores/gitStore';
import { GitStatus } from '../wails/bindings';
import { resetLSPDocumentSyncState } from '../utils/lspDocumentSync';
import { ReadDirectoryShallow } from '../wails/bindings';
import { __resetEnsurePathLoaded, ensurePathLoaded } from '../hooks/useEnsurePathLoaded';
import type { FileEvent } from '../types/watcher';
import { EventsOn } from '../wails/runtime';

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
  }) as unknown as FileEntry;
// An unloaded dir has children undefined.
const unloadedDir = (path: string): FileEntry =>
  ({
    name: path.split('/').pop()!,
    path,
    isDir: true,
    size: 0,
    modTime: '',
    children: undefined,
  }) as unknown as FileEntry;

// ── mocks ─────────────────────────────────────────────────────────────────────
const mockUseFileWatcher = jest.fn();

jest.mock('../wails/bindings', () => {
  const actual = jest.requireActual('../wails/bindings');
  return {
    ...actual,
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
    CancelBeforeClose: jest.fn(() => Promise.resolve()),
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
    GitStatus: jest.fn(() =>
      Promise.resolve({
        isRepo: false,
        repoRoot: '',
        branch: '',
        upstream: '',
        ahead: 0,
        behind: 0,
        files: [],
      })
    ),
    GitBranches: jest.fn(() => Promise.resolve([])),
    GitCommitMessageAvailable: jest.fn(() => Promise.resolve(false)),
    GitStage: jest.fn(),
    GitUnstage: jest.fn(),
    GitCommit: jest.fn(),
    GitPull: jest.fn(),
    GitPush: jest.fn(),
    GitCheckout: jest.fn(),
    GitGenerateCommitMessage: jest.fn(),
    GitConflictState: jest.fn(),
    // App now mounts useGolemBridge; an unbound repository is the quiet default.
    GetWorkspaceInfo: jest.fn((path: string) =>
      Promise.resolve({ name: '', path, repoKey: '', repoEpoch: 0 })
    ),
    GetGolemStatus: jest.fn(() =>
      Promise.resolve({
        available: false,
        workspaceLabel: '',
        identity: { repoEpoch: 0, workspaceId: '', conversationId: '' },
        needsConsent: false,
        activeRuns: [],
      })
    ),
    RunGolemTurn: jest.fn(() => Promise.resolve(null)),
    CancelGolemRun: jest.fn(() => Promise.resolve(false)),
  };
});

jest.mock('../wails/runtime', () => ({
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
    // The tree cache is module-level: a tree cached by an earlier test would
    // make the restore reconcile this test's workspace with disk.
    clearWorkspaceTreeCache();
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
      showHiddenFolders: true,
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

  it('schedules a debounced git status refresh on any file event', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useGitStore.getState().resetForWorkspace('/r');
    });
    (GitStatus as jest.Mock).mockClear();

    const fire = getWatcherCallback();
    act(() => {
      fire({
        type: 'modified',
        path: '/r/some/file.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      fire({
        type: 'modified',
        path: '/r/other/file.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      jest.advanceTimersByTime(GIT_REFRESH_DEBOUNCE_MS + 10);
    });
    await act(async () => {});

    // Burst of events → exactly one debounced status call.
    expect(GitStatus).toHaveBeenCalledTimes(1);
    expect(GitStatus).toHaveBeenCalledWith('/r');
  });

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
    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/a', '/r');
  });

  it('re-reads an expanded POSIX folder a\\b without touching its twin a/b (#447)', async () => {
    await act(async () => {
      render(<App />);
    });

    const keep = { name: 'keep.txt', path: '/r/a/b/keep.txt', isDir: false } as FileEntry;
    const added = { name: 'new.txt', path: '/r/a\\b/new.txt', isDir: false } as FileEntry;
    // /r/a is collapsed; its child /r/a/b is loaded. The top-level /r/a\b is expanded.
    act(() => {
      useIDEStore.setState({
        directoryTree: [
          { ...loadedDir('/r/a'), children: [{ ...loadedDir('/r/a/b'), children: [keep] }] },
          loadedDir('/r/a\\b'),
        ] as FileEntry[],
        expandedPaths: new Set(['/r/a\\b']),
        isRootExpanded: true,
      });
    });
    (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve(path === '/r/a\\b' ? [added] : [])
    );

    const fire = getWatcherCallback();
    act(() => {
      fire({ type: 'created', path: '/r/a\\b/new.txt', isDir: false, time: '' });
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/a\\b', '/r');
    const [a, backslash] = useIDEStore.getState().directoryTree;
    expect(a.children?.[0].children).toEqual([keep]);
    expect(backslash.children).toEqual([added]);
  });

  // #536: a git status refresh that moves the set of tracked files .gitignore
  // matches changes no watched file, so the backend names the folders whose
  // listings changed and they go through the same reconcile as watcher events.
  it('re-reads the folders a filetree:stale event names', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [loadedDir('/r/data'), unloadedDir('/r/other')],
        expandedPaths: new Set(['/r/data']),
        isRootExpanded: true,
      });
    });
    (ReadDirectoryShallow as jest.Mock).mockClear();

    const call = (EventsOn as jest.Mock).mock.calls.find(([name]) => name === 'filetree:stale');
    expect(call).toBeDefined();
    const onStale = call![1] as (dirs: string[]) => void;
    act(() => {
      onStale(['/r/data', '/r/other']);
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).toHaveBeenCalledTimes(1);
    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/data', '/r');
  });

  // A folder whose first read is still in flight has no children yet, and
  // that read may predate the change the event reports. Dropping the event
  // (as for a never-loaded folder) would let the old listing stand.
  it('re-reads a folder whose first read was in flight when the event came', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [unloadedDir('/r/data')],
        expandedPaths: new Set(['/r/data']),
        isRootExpanded: true,
      });
    });
    const stale = { name: 'a.csv', path: '/r/data/a.csv', isDir: false } as FileEntry;
    const fresh = { name: 'b.csv', path: '/r/data/b.csv', isDir: false } as FileEntry;
    let resolveFirst!: (entries: FileEntry[]) => void;
    (ReadDirectoryShallow as jest.Mock).mockReset();
    (ReadDirectoryShallow as jest.Mock)
      .mockReturnValueOnce(
        new Promise<FileEntry[]>((r) => {
          resolveFirst = r;
        })
      )
      .mockResolvedValue([fresh]);
    let firstRead!: Promise<void>;
    act(() => {
      firstRead = ensurePathLoaded('/r/data');
    });
    await act(async () => {
      await Promise.resolve();
    });

    const call = (EventsOn as jest.Mock).mock.calls.find(([name]) => name === 'filetree:stale');
    const onStale = call![1] as (dirs: string[]) => void;
    act(() => {
      onStale(['/r/data']);
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      resolveFirst([stale]);
      await firstRead;
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).toHaveBeenCalledTimes(2);
    expect(useIDEStore.getState().directoryTree[0].children).toEqual([fresh]);
  });

  it('drops a queued stale-event read after the root refresh removes its folder', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [unloadedDir('/r/a')],
        expandedPaths: new Set(['/r/a']),
        toast: null,
      });
    });
    let rejectOld!: (reason: Error) => void;
    let childReads = 0;
    (ReadDirectoryShallow as jest.Mock).mockReset();
    (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) => {
      if (path === '/r') return Promise.resolve([]);
      if (++childReads === 1) {
        return new Promise((_resolve, reject) => {
          rejectOld = reject;
        });
      }
      return Promise.reject(new Error('no such file or directory'));
    });
    let firstRead!: Promise<void>;
    await act(async () => {
      firstRead = ensurePathLoaded('/r/a');
      await Promise.resolve();
    });

    const call = (EventsOn as jest.Mock).mock.calls.find(([name]) => name === 'filetree:stale');
    await act(async () => {
      (call![1] as (dirs: string[]) => void)(['/r', '/r/a']);
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(useIDEStore.getState().directoryTree).toEqual([]);
    await act(async () => {
      rejectOld(new Error('no such file or directory'));
      await firstRead;
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useIDEStore.getState().dirtyPaths.size).toBe(0);
    expect(useIDEStore.getState().toast).toBeNull();
    expect(childReads).toBe(1);
  });

  it.each([false, true])(
    'drops a debounced child read after the ancestor refresh removes its directory (replaced by file: %s)',
    async (replacedByFile) => {
      await act(async () => {
        render(<App />);
      });
      act(() => {
        useIDEStore.setState({
          directoryTree: [loadedDir('/r/a')],
          expandedPaths: new Set(['/r/a']),
          toast: null,
        });
      });
      const nextTree = replacedByFile ? [{ ...unloadedDir('/r/a'), isDir: false }] : [];
      (ReadDirectoryShallow as jest.Mock).mockReset();
      (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) =>
        path === '/r' ? Promise.resolve(nextTree) : Promise.reject(new Error('not a directory'))
      );

      const call = (EventsOn as jest.Mock).mock.calls.find(([name]) => name === 'filetree:stale');
      await act(async () => {
        (call![1] as (dirs: string[]) => void)(['/r', '/r/a']);
        await jest.advanceTimersByTimeAsync(100);
      });

      expect(useIDEStore.getState().directoryTree).toEqual(nextTree);
      expect(useIDEStore.getState().dirtyPaths.size).toBe(0);
      expect(useIDEStore.getState().toast).toBeNull();
      expect((ReadDirectoryShallow as jest.Mock).mock.calls).toEqual([['/r', '/r']]);
    }
  );

  it.each(['/s', '/r'])(
    'drops a debounced root read after switching workspace identity to %s',
    async (nextRoot) => {
      await act(async () => {
        render(<App />);
      });
      (ReadDirectoryShallow as jest.Mock).mockClear();
      const call = (EventsOn as jest.Mock).mock.calls.find(([name]) => name === 'filetree:stale');
      act(() => {
        (call![1] as (dirs: string[]) => void)(['/r']);
        useIDEStore.setState({
          workspace: { name: 'new workspace', path: nextRoot },
          directoryTree: [],
          dirtyPaths: new Set(),
          toast: null,
        });
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });

      expect(ReadDirectoryShallow).not.toHaveBeenCalled();
      expect(useIDEStore.getState().dirtyPaths.size).toBe(0);
      expect(useIDEStore.getState().toast).toBeNull();
    }
  );

  // Marking a collapsed folder dirty is not enough while its read is in
  // flight: that read's completion clears the mark and its listing stands.
  it('re-reads a collapsed loaded folder whose read was in flight when the event came', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [loadedDir('/r/data')],
        expandedPaths: new Set<string>(),
        isRootExpanded: true,
      });
    });
    const fresh = { name: 'b.csv', path: '/r/data/b.csv', isDir: false } as FileEntry;
    let resolveFirst!: (entries: FileEntry[]) => void;
    (ReadDirectoryShallow as jest.Mock).mockReset();
    (ReadDirectoryShallow as jest.Mock)
      .mockReturnValueOnce(
        new Promise<FileEntry[]>((r) => {
          resolveFirst = r;
        })
      )
      .mockResolvedValue([fresh]);
    let firstRead!: Promise<void>;
    act(() => {
      firstRead = ensurePathLoaded('/r/data', { force: true });
    });

    const call = (EventsOn as jest.Mock).mock.calls.find(([name]) => name === 'filetree:stale');
    act(() => {
      (call![1] as (dirs: string[]) => void)(['/r/data']);
    });
    await act(async () => {
      resolveFirst([]);
      await firstRead;
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).toHaveBeenCalledTimes(2);
    expect(useIDEStore.getState().directoryTree[0].children).toEqual([fresh]);
  });

  // A loading marker is UI state and can outlive a workspace switch; only a
  // read the loader holds for this workspace makes an unloaded folder worth
  // reading on an event.
  it('ignores an unloaded folder whose loading marker no read in this workspace holds', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [unloadedDir('/r/data')],
        expandedPaths: new Set(['/r/data']),
        loadingPaths: new Set(['/r/data']),
        isRootExpanded: true,
      });
    });
    (ReadDirectoryShallow as jest.Mock).mockClear();

    const call = (EventsOn as jest.Mock).mock.calls.find(([name]) => name === 'filetree:stale');
    act(() => {
      (call![1] as (dirs: string[]) => void)(['/r/data']);
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
  });

  // The explorer re-reads the root on every mount (a sidebar switch) outside
  // the loader, and that read clears the root's dirty mark when it lands. A
  // collapsed root marked dirty by an event during it would keep the older
  // listing, and expanding the root does not re-read it. Root reads are
  // ticket-ordered, so the event re-reads it even while collapsed.
  it('re-reads a collapsed root on an event', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({ directoryTree: [loadedDir('/r/data')], isRootExpanded: false });
    });
    (ReadDirectoryShallow as jest.Mock).mockClear();

    const call = (EventsOn as jest.Mock).mock.calls.find(([name]) => name === 'filetree:stale');
    act(() => {
      (call![1] as (dirs: string[]) => void)(['/r']);
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r', '/r');
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

  // #450: a watcher event inside a hidden folder only marks it dirty, so
  // showing hidden folders again re-reads each expanded branch it brings back.
  it('re-reads an expanded hidden folder that changed while hidden once shown again', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [loadedDir('/r/.github'), loadedDir('/r/src')],
        expandedPaths: new Set(['/r/.github']),
        isRootExpanded: true,
      });
      useIDEStore.getState().setShowHiddenFolders(false);
    });

    act(() => {
      getWatcherCallback()({
        type: 'created',
        path: '/r/.github/new.yml',
        isDir: false,
        time: new Date().toISOString(),
      });
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
    expect(useIDEStore.getState().dirtyPaths.has('/r/.github')).toBe(true);

    const created = { ...loadedDir('/r/.github/new.yml'), isDir: false, children: undefined };
    (ReadDirectoryShallow as jest.Mock).mockResolvedValue([created]);
    act(() => {
      useIDEStore.getState().setShowHiddenFolders(true);
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/.github', '/r');
    const github = useIDEStore.getState().directoryTree.find((e) => e.path === '/r/.github');
    expect(github?.children?.map((c) => c.path)).toEqual(['/r/.github/new.yml']);
    expect(useIDEStore.getState().dirtyPaths.has('/r/.github')).toBe(false);
  });

  // A branch marked dirty while out of view is re-read when it comes back into
  // view, whatever brings it back: expanding a collapsed root or ancestor,
  // showing hidden folders (#450), or the Workspace view scoping the tree.
  const loadedWith = (path: string, children: FileEntry[]): FileEntry =>
    ({ ...loadedDir(path), children }) as FileEntry;
  const fileChanged = (path: string) =>
    act(() => {
      getWatcherCallback()({
        type: 'created',
        path,
        isDir: false,
        time: new Date().toISOString(),
      });
      jest.advanceTimersByTime(100);
    });
  const settle = () =>
    act(async () => {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

  it('re-reads an expanded folder that changed under a collapsed root once the root expands', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [loadedDir('/r/src')],
        expandedPaths: new Set(['/r/src']),
        isRootExpanded: false,
      });
    });
    fileChanged('/r/src/new.ts');
    await settle();
    (ReadDirectoryShallow as jest.Mock).mockClear();
    expect(useIDEStore.getState().dirtyPaths.has('/r/src')).toBe(true);

    act(() => useIDEStore.getState().toggleRootExpanded());
    await settle();

    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/src', '/r');
  });

  it('re-reads a hidden folder shown again under a collapsed root once the root expands', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [loadedDir('/r/.github')],
        expandedPaths: new Set(['/r/.github']),
        isRootExpanded: true,
      });
      useIDEStore.getState().setShowHiddenFolders(false);
    });
    fileChanged('/r/.github/new.yml');
    act(() => {
      useIDEStore.setState({ isRootExpanded: false });
      useIDEStore.getState().setShowHiddenFolders(true);
    });
    await settle();
    expect(ReadDirectoryShallow).not.toHaveBeenCalledWith('/r/.github', '/r');

    act(() => useIDEStore.getState().toggleRootExpanded());
    await settle();

    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/.github', '/r');
  });

  it('does not read a dirty folder deleted from the tree before it comes back into view', async () => {
    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [loadedDir('/r/.github')],
        expandedPaths: new Set(['/r/.github']),
        isRootExpanded: true,
      });
      useIDEStore.getState().setShowHiddenFolders(false);
    });
    fileChanged('/r/.github/new.yml');
    // A root refresh drops the deleted folder; its dirty and expanded marks stay.
    act(() => useIDEStore.setState({ directoryTree: [] }));
    (ReadDirectoryShallow as jest.Mock).mockClear();

    act(() => useIDEStore.getState().setShowHiddenFolders(true));
    await settle();

    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
  });

  describe('in the Workspace view of a nested workspace', () => {
    const scope = () =>
      act(() => {
        useIDEStore.setState({
          workspaces: [
            { id: 'project', name: 'r', relDir: '', type: 'generic', accent: '' },
            { id: 'fe', name: 'frontend', relDir: 'frontend', type: 'node', accent: '' },
          ] as unknown as workspace.WorkspaceDef[],
          activeWorkspaceId: 'fe',
          directoryTree: [
            loadedWith('/r/frontend', [
              loadedDir('/r/frontend/src'),
              loadedDir('/r/frontend/.github'),
            ]),
          ],
          // The scope folder is the view's root, not an expanded row.
          expandedPaths: new Set(['/r/frontend/src', '/r/frontend/.github']),
          isRootExpanded: true,
        });
      });

    it('re-reads an expanded folder the view shows on an event', async () => {
      await act(async () => {
        render(<App />);
      });
      scope();
      (ReadDirectoryShallow as jest.Mock).mockClear();

      fileChanged('/r/frontend/src/new.ts');
      await settle();

      expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/frontend/src', '/r');
    });

    it('re-reads a hidden folder that changed while hidden once shown again', async () => {
      await act(async () => {
        render(<App />);
      });
      scope();
      act(() => useIDEStore.getState().setShowHiddenFolders(false));
      (ReadDirectoryShallow as jest.Mock).mockClear();

      fileChanged('/r/frontend/.github/new.yml');
      await settle();
      expect(ReadDirectoryShallow).not.toHaveBeenCalled();

      act(() => useIDEStore.getState().setShowHiddenFolders(true));
      await settle();

      expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/frontend/.github', '/r');
    });
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
    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/a', '/r');
    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/c', '/r');
  });

  // ── (e) reconcile preserves loaded children of surviving subdirs ───────────
  it('(e) reconcile at root preserves loaded children of a surviving subdir', async () => {
    // /r/a is already loaded+expanded with children; a root-level event arrives.
    // ReadDirectoryShallow('/r') returns a fresh shallow level where /r/a is
    // unloaded. preserveLoadedChildren must restore /r/a's children so the tree
    // does not visually collapse to empty.
    const existingChild = {
      name: 'x.ts',
      path: '/r/a/x.ts',
      isDir: false,
      size: 0,
      modTime: '',
    } as FileEntry;

    // Mock ReadDirectoryShallow('/r') to return [unloaded /r/a, new file /r/new.ts]
    (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) => {
      if (path === '/r') {
        return Promise.resolve([
          { name: 'a', path: '/r/a', isDir: true, size: 0, modTime: '', children: undefined },
          { name: 'new.ts', path: '/r/new.ts', isDir: false, size: 0, modTime: '' },
        ]);
      }
      return Promise.resolve([]);
    });

    await act(async () => {
      render(<App />);
    });

    // Seed: root expanded, /r/a loaded+expanded with a child file.
    act(() => {
      useIDEStore.setState({
        directoryTree: [
          {
            name: 'a',
            path: '/r/a',
            isDir: true,
            size: 0,
            modTime: '',
            children: [existingChild],
            unreadable: true,
          } as FileEntry,
        ],
        expandedPaths: new Set(['/r/a']),
        isRootExpanded: true,
      });
    });

    const fire = getWatcherCallback();

    // Fire a root-level created event (new file at /r).
    act(() => {
      fire({
        type: 'created',
        path: '/r/new.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      jest.advanceTimersByTime(100);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const state = useIDEStore.getState();
    const aNode = state.directoryTree.find((e) => e.path === '/r/a');
    const newNode = state.directoryTree.find((e) => e.path === '/r/new.ts');

    // /r/new.ts must appear after reconcile
    expect(newNode).toBeTruthy();
    // /r/a must retain its previously-loaded children (not revert to undefined)
    expect(aNode?.children).toEqual([existingChild]);
    // Reading only /r does not prove that /r/a's contents became readable.
    expect(aNode?.unreadable).toBe(true);
  });

  it('a successful watcher retry of the unreadable dir clears its marker', async () => {
    const realChild = {
      name: 'new.ts',
      path: '/r/a/new.ts',
      isDir: false,
      size: 0,
      modTime: '',
    } as FileEntry;
    (ReadDirectoryShallow as jest.Mock).mockResolvedValue([realChild]);

    await act(async () => {
      render(<App />);
    });
    act(() => {
      useIDEStore.setState({
        directoryTree: [{ ...loadedDir('/r/a'), unreadable: true } as FileEntry],
        expandedPaths: new Set(['/r/a']),
        isRootExpanded: true,
      });
    });

    const fire = getWatcherCallback();
    act(() => {
      fire({
        type: 'created',
        path: '/r/a/new.ts',
        isDir: false,
        time: new Date().toISOString(),
      });
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/a', '/r');
    const aNode = useIDEStore.getState().directoryTree[0];
    expect(aNode.children).toEqual([realChild]);
    expect(aNode.unreadable).toBe(false);
  });
});

describe('App — merge session revalidation signals', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    __resetEnsurePathLoaded();
    // The tree cache is module-level: a tree cached by an earlier test would
    // make the restore reconcile this test's workspace with disk.
    clearWorkspaceTreeCache();
    resetLSPDocumentSyncState();
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
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function watcherCallback(): (event: FileEvent) => void {
    const cb = mockUseFileWatcher.mock.calls[0]?.[1] as ((event: FileEvent) => void) | undefined;
    expect(cb).toBeDefined();
    return cb!;
  }

  /**
   * Renders inside act and settles the mount: the always-mounted Golem bridge
   * resolves GetWorkspaceInfo a microtask after render, which would otherwise
   * land after the test body returns and count as an update outside act (#226).
   */
  async function renderApp() {
    await act(async () => {
      render(<App />);
    });
  }

  /** Replaces the store action so the test observes the signal, not the policy
   * (which gitStore.merge.test.ts owns). */
  function captureMergeSignal() {
    const notifyMergeFileChanged = jest.fn(() => Promise.resolve());
    useGitStore.setState({ notifyMergeFileChanged });
    return notifyMergeFileChanged;
  }

  it('hands a changed path to the merge session revalidator', async () => {
    const notify = captureMergeSignal();
    await renderApp();

    act(() => {
      watcherCallback()({
        type: 'modified',
        path: '/r/conflict.ts',
        isDir: false,
        time: '',
      });
    });

    // A merge session is not an open editor buffer, so the reload path in
    // handleFileChange never sees it — the store has to be told directly.
    expect(notify).toHaveBeenCalledWith('/r/conflict.ts');
  });

  it('hands both sides of a rename to the revalidator', async () => {
    const notify = captureMergeSignal();
    await renderApp();

    act(() => {
      watcherCallback()({
        type: 'renamed',
        path: '/r/renamed.ts',
        oldPath: '/r/conflict.ts',
        isDir: false,
        time: '',
      });
    });

    // The session's file may be either end of the rename.
    expect(notify).toHaveBeenCalledWith('/r/renamed.ts');
    expect(notify).toHaveBeenCalledWith('/r/conflict.ts');
  });

  it('signals a deletion of the session file too', async () => {
    const notify = captureMergeSignal();
    await renderApp();

    act(() => {
      watcherCallback()({
        type: 'deleted',
        path: '/r/conflict.ts',
        isDir: false,
        time: '',
      });
    });

    expect(notify).toHaveBeenCalledWith('/r/conflict.ts');
  });

  it('does not signal for directory events', async () => {
    const notify = captureMergeSignal();
    await renderApp();

    act(() => {
      watcherCallback()({ type: 'created', path: '/r/sub', isDir: true, time: '' });
    });

    expect(notify).not.toHaveBeenCalled();
  });
});

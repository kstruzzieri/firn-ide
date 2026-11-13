import './styles/tokens.css';
import './styles/reset.css';
import { useCallback, useEffect, useRef } from 'react';
import { IDEShell } from './components/layout';
import { RunProfiles } from './components/RunProfiles';
import { GolemPanel } from './components/Golem';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { FileExplorer } from './components/FileExplorer';
import { SearchPanel } from './components/Search';
import { GitPanel } from './components/GitPanel';
import { StructureView } from './components/Structure';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';
import { StatusBar } from './components/StatusBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toast } from './components/Toast';
import { useAutosave } from './hooks/useAutosave';
import { useWorkspacePersistence } from './hooks/useWorkspacePersistence';
import { useRecentWorkspaces } from './hooks/useRecentWorkspaces';
import { useRunProfilesLoader } from './hooks/useRunProfiles';
import { drainRunHistoryForClose, useRunOutputListener } from './hooks/useRunOutput';
import { useGolemBridge } from './hooks/useGolemBridge';
import { useGolemWindow } from './hooks/useGolemWindow';
import { useLSPDocumentSync } from './hooks/useLSPDocumentSync';
import { useLSPEvents } from './hooks/useLSPEvents';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useFileTreeStale } from './hooks/useFileTreeStale';
import { useGitSync } from './hooks/useGitSync';
import { useWorkspaceSearch } from './hooks/useWorkspaceSearch';
import { useWorkspaceDetection } from './hooks/useWorkspaceDetection';
import { useConflictProjectionSync } from './hooks/useProblemsProjection';
import { useWorkspace, useIDEStore, useSidebarView, useActiveAccent } from './stores/ideStore';
import { useGolemStore } from './stores/golemStore';
import { useGitStore } from './stores/gitStore';
import { ReadFile } from './wails/bindings';
import type { FileEvent } from './types/watcher';
import { getDirectoryPath, pathsReferToSameFile } from './utils/lspUri';
import { isDirListingShown } from './utils/treeVisibility';
import { findEntryByPath } from './utils/findEntryByPath';
import { ensurePathLoaded, isPathLoadInFlight } from './hooks/useEnsurePathLoaded';
import { flushAllFileEdits } from './utils/fileWrites';
import { focusConfigTab } from './utils/editorSurface';
import {
  confirmConfigClose,
  hasUnsavedConfigWork,
} from './components/GolemConfig/configCloseGuard';

/**
 * The one place the docked host learns it is not the owner (#271 §5.1). A
 * component rather than a read inside `App`, so the subscription re-renders the
 * island alone — and so the whole tree below stays out of `App`'s render.
 */
function GolemIsland({ visible }: { visible: boolean }) {
  const frozen = useGolemStore((state) => state.hostFrozen);
  return <GolemPanel visible={visible} frozen={frozen} />;
}

// Module scope, not an inline arrow: IDEShell memoizes the Golem island on this
// callback's identity, and a fresh function per App render would throw that
// memo away every time App re-renders (sidebar view, workspace, …).
const renderGolemPanel = (visible: boolean) => <GolemIsland visible={visible} />;

function App() {
  // Per-directory debounce timers so concurrent changes in different dirs don't
  // collapse into one mis-scoped refetch.
  const reconcileTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // The app-close handshake (§5.5) asks the configuration surface first: it may
  // hold a dirty draft, an open editor, or a pending settings challenge that the
  // backend must not tear down underneath. A dirty surface is revealed before it
  // is asked, because the dialog it raises lives inside that pane.
  const golemConfigCloseGuard = useCallback(async () => {
    if (hasUnsavedConfigWork()) focusConfigTab();
    return confirmConfigClose('quit');
  }, []);

  useAutosave();
  useWorkspacePersistence(flushAllFileEdits, drainRunHistoryForClose, golemConfigCloseGuard);
  // Own run-event capture at the always-mounted App so collapsing the bottom
  // panel (which unmounts Terminal) cannot drop run output or history (#235).
  useRunOutputListener();
  // The Golem island stays mounted now (#271), but the bridge and the
  // repository binding it owns still live at the always-mounted App: they are
  // app-level, not panel-level.
  useGolemBridge();
  // The undocked-window owner, mounted beside the bridge and only here: the
  // satellite runs `startGolemSatellite()` in its own JS context instead, and
  // this one is ready — subscriptions and core wiring — whether or not the
  // bridge ever binds a repository.
  useGolemWindow();
  useWorkspaceDetection();
  useLSPDocumentSync();
  useLSPEvents();
  useRecentWorkspaces();
  // Mount workspace-search wiring once at the App level so the in-flight
  // request guards (workspace switch, unmount) survive panel toggling.
  useWorkspaceSearch();
  useGitSync();
  // Own the conflict-state reads at the always-mounted App: the Problems panel
  // unmounts when the bottom panel collapses, but the StatusBar consumes the
  // same conflict-aware projection and is always visible (#254).
  useConflictProjectionSync();
  const workspace = useWorkspace();
  const sidebarView = useSidebarView();
  const activeAccent = useActiveAccent();
  useRunProfilesLoader(workspace?.path);

  const reconcileDir = useCallback((dir: string) => {
    const s = useIDEStore.getState();
    const workspace = s.workspace;
    const root = workspace?.path;
    if (!root) return;
    // A read in flight may predate this change, and its completion clears any
    // dirty mark set now: re-read once it settles, loaded or not, shown or not.
    if (isPathLoadInFlight(dir)) {
      void ensurePathLoaded(dir, { force: true });
      return;
    }
    const isRoot = pathsReferToSameFile(dir, root);
    const node = isRoot ? { children: s.directoryTree } : findEntryByPath(s.directoryTree, dir);
    if (!node || node.children === undefined) return; // not loaded → ignore

    // Re-read a listing the explorer shows (isDirListingShown); mark any other
    // dirty, and re-read it when it comes into view (below). The root is
    // always re-read, collapsed or not: the explorer's mount read
    // (useDirectoryTree) runs outside the loader and clears a dirty mark when
    // it lands, and root reads are ticket-ordered, so racing that read is
    // safe (#536).
    const visible = isRoot || isDirListingShown(dir, s);
    if (!visible) {
      s.markDirty(dir);
      return;
    }

    const timers = reconcileTimersRef.current;
    const existing = timers.get(dir);
    if (existing) clearTimeout(existing);
    timers.set(
      dir,
      setTimeout(() => {
        timers.delete(dir);
        const after = useIDEStore.getState();
        if (after.workspace !== workspace) return;
        if (!isRoot && findEntryByPath(after.directoryTree, dir)?.isDir !== true) return;
        void ensurePathLoaded(dir, { force: true });
      }, 75)
    );
  }, []);

  const handleFileChange = useCallback(
    (event: FileEvent) => {
      // Any working-tree event can change git status; the store debounces.
      useGitStore.getState().scheduleRefresh();

      // An open merge session is not an open editor buffer, so the reload path
      // below never sees it. Hand it every event for a file — including both
      // ends of a rename, since the session's path may be either — and let the
      // store decide whether anything actually moved. The backend watcher
      // already coalesces per path, so there is no timer here.
      if (!event.isDir) {
        const git = useGitStore.getState();
        void git.notifyMergeFileChanged(event.path);
        if (event.oldPath) void git.notifyMergeFileChanged(event.oldPath);
      }

      const { openFiles } = useIDEStore.getState();
      const openFile = openFiles.find((f) => f.path === event.path);

      // git restore/checkout/stash/switch and rename-over saves replace a file
      // by unlinking it and creating a new one. The backend delivers the last
      // event it saw for the path, `created` or `modified` depending on whether
      // its watch on the new file caught the write (#563), so both reload.
      if (
        (event.type === 'modified' || event.type === 'created') &&
        !event.isDir &&
        openFile &&
        !openFile.isModified
      ) {
        ReadFile(event.path)
          .then((result) => {
            if (result === null) {
              throw new Error(`ReadFile returned no content for ${event.path}`);
            }
            const state = useIDEStore.getState();
            const file = state.openFiles.find((f) => f.path === event.path);
            if (file && !file.isModified) {
              state.updateFileContent(file.id, result.content);
              state.setFileModified(file.id, false);
            }
          })
          .catch((err) => {
            console.error(`Failed to reload ${event.path}:`, err);
          });
      }

      if (
        event.type === 'created' ||
        event.type === 'deleted' ||
        event.type === 'renamed' ||
        event.isDir
      ) {
        const dir = getDirectoryPath(event.path) || event.path;
        reconcileDir(dir);
      }
    },
    [reconcileDir]
  );

  useFileWatcher(workspace?.path ?? null, handleFileChange);
  useFileTreeStale(reconcileDir);

  // A listing marked dirty while out of view is re-read when it comes into
  // view: a collapsed root or folder above it expanding, hidden folders shown
  // again (#450), or the Workspace view changing which folder is the root.
  // Expanding a folder reads only that folder, so its expanded descendants
  // would otherwise show what they held before. Listings that stay in or out
  // of view are left alone, and a workspace switch reconciles its own tree.
  useEffect(
    () =>
      useIDEStore.subscribe((state, prev) => {
        if (state.dirtyPaths.size === 0 || state.workspace !== prev.workspace) return;
        if (
          state.expandedPaths === prev.expandedPaths &&
          state.isRootExpanded === prev.isRootExpanded &&
          state.showHiddenFolders === prev.showHiddenFolders &&
          state.activeWorkspaceId === prev.activeWorkspaceId &&
          state.workspaces === prev.workspaces
        )
          return;
        const root = state.workspace?.path ?? '';
        for (const dir of state.dirtyPaths) {
          if (
            isDirListingShown(dir, state) &&
            !isDirListingShown(dir, prev) &&
            // A folder deleted from the tree keeps its dirty and expanded
            // marks; reading it would fail and keep it dirty.
            (pathsReferToSameFile(dir, root) ||
              findEntryByPath(state.directoryTree, dir)?.isDir === true)
          ) {
            void ensurePathLoaded(dir);
          }
        }
      }),
    []
  );

  useEffect(() => {
    const timers = reconcileTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return (
    <ErrorBoundary>
      <IDEShell
        accent={activeAccent}
        header={(openCommandPalette) => <Header onOpenCommandPalette={openCommandPalette} />}
        sidebar={<Sidebar />}
        leftPanel={
          sidebarView === 'search' ? (
            <SearchPanel />
          ) : sidebarView === 'git' ? (
            <GitPanel />
          ) : sidebarView === 'structure' ? (
            <StructureView />
          ) : (
            <FileExplorer />
          )
        }
        centerPanel={<Editor />}
        golemPanel={renderGolemPanel}
        bottomPanel={<Terminal />}
        rightPanel={<RunProfiles />}
        statusBar={<StatusBar />}
      />
      <Toast />
    </ErrorBoundary>
  );
}

export default App;

import './styles/tokens.css';
import './styles/reset.css';
import { useCallback, useEffect, useRef } from 'react';
import { IDEShell } from './components/layout';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { FileExplorer } from './components/FileExplorer';
import { SearchPanel } from './components/Search';
import { GitPanel } from './components/GitPanel';
import { StructureView } from './components/Structure';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';
import { RunProfiles } from './components/RunProfiles';
import { StatusBar } from './components/StatusBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toast } from './components/Toast';
import { useAutosave } from './hooks/useAutosave';
import { useWorkspacePersistence } from './hooks/useWorkspacePersistence';
import { useRecentWorkspaces } from './hooks/useRecentWorkspaces';
import { useRunProfilesLoader } from './hooks/useRunProfiles';
import { useLSPDocumentSync } from './hooks/useLSPDocumentSync';
import { useLSPEvents } from './hooks/useLSPEvents';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useGitSync } from './hooks/useGitSync';
import { useWorkspaceSearch } from './hooks/useWorkspaceSearch';
import { useWorkspaceDetection } from './hooks/useWorkspaceDetection';
import { useWorkspace, useIDEStore, useSidebarView, useActiveAccent } from './stores/ideStore';
import { useGitStore } from './stores/gitStore';
import { ReadFile } from '../wailsjs/go/main/App';
import type { FileEvent } from './types/watcher';
import { getDirectoryPath, pathsReferToSameFile } from './utils/lspUri';
import { isDirVisible } from './utils/treeVisibility';
import { findEntryByPath } from './utils/findEntryByPath';
import { ensurePathLoaded } from './hooks/useEnsurePathLoaded';
import { flushAllFileEdits } from './utils/fileWrites';

function App() {
  // Per-directory debounce timers so concurrent changes in different dirs don't
  // collapse into one mis-scoped refetch.
  const reconcileTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useAutosave();
  useWorkspacePersistence(flushAllFileEdits);
  useWorkspaceDetection();
  useLSPDocumentSync();
  useLSPEvents();
  useRecentWorkspaces();
  // Mount workspace-search wiring once at the App level so the in-flight
  // request guards (workspace switch, unmount) survive panel toggling.
  useWorkspaceSearch();
  useGitSync();
  const workspace = useWorkspace();
  const sidebarView = useSidebarView();
  const activeAccent = useActiveAccent();
  useRunProfilesLoader(workspace?.path);

  const reconcileDir = useCallback((dir: string) => {
    const s = useIDEStore.getState();
    const root = s.workspace?.path;
    if (!root) return;
    const isRoot = pathsReferToSameFile(dir, root);
    const node = isRoot ? { children: s.directoryTree } : findEntryByPath(s.directoryTree, dir);
    if (!node || node.children === undefined) return; // not loaded → ignore

    // A dir's children are visible when: it's root (always expanded via isRootExpanded)
    // or it's in expandedPaths AND its ancestor chain is visible (isDirVisible).
    // ponytail: isDirVisible alone is insufficient — it checks row visibility not content visibility
    const visible = isRoot
      ? s.isRootExpanded
      : s.expandedPaths.has(dir) &&
        isDirVisible(dir, {
          rootPath: root,
          isRootExpanded: s.isRootExpanded,
          expandedPaths: s.expandedPaths,
        });
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
        void ensurePathLoaded(dir, { force: true });
      }, 75)
    );
  }, []);

  const handleFileChange = useCallback(
    (event: FileEvent) => {
      // Any working-tree event can change git status; the store debounces.
      useGitStore.getState().scheduleRefresh();

      const { openFiles } = useIDEStore.getState();
      const openFile = openFiles.find((f) => f.path === event.path);

      if (event.type === 'modified' && !event.isDir) {
        if (!openFile || openFile.isModified) return;

        ReadFile(event.path)
          .then((result) => {
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
        return;
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
        header={<Header />}
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
        bottomPanel={<Terminal />}
        rightPanel={<RunProfiles />}
        statusBar={<StatusBar />}
      />
      <Toast />
    </ErrorBoundary>
  );
}

export default App;

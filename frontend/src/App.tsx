import './styles/tokens.css';
import './styles/reset.css';
import { useCallback, useEffect, useRef } from 'react';
import { IDEShell } from './components/layout';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { FileExplorer } from './components/FileExplorer';
import { SearchPanel } from './components/Search';
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
import { useWorkspaceSearch } from './hooks/useWorkspaceSearch';
import { useWorkspace, useIDEStore, useSidebarView } from './stores/ideStore';
import { ReadDirectory, ReadFile } from '../wailsjs/go/main/App';
import type { FileEvent } from './types/watcher';

function App() {
  const treeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeRefreshRequestIdRef = useRef(0);

  useAutosave();
  useWorkspacePersistence();
  useLSPDocumentSync();
  useLSPEvents();
  useRecentWorkspaces();
  // Mount workspace-search wiring once at the App level so the in-flight
  // request guards (workspace switch, unmount) survive panel toggling.
  useWorkspaceSearch();
  const workspace = useWorkspace();
  const sidebarView = useSidebarView();
  useRunProfilesLoader(workspace?.path);

  const refreshDirectoryTree = useCallback(() => {
    const workspacePath = useIDEStore.getState().workspace?.path;
    if (!workspacePath) return;

    const requestId = ++treeRefreshRequestIdRef.current;

    ReadDirectory(workspacePath)
      .then((entries) => {
        const state = useIDEStore.getState();
        if (
          treeRefreshRequestIdRef.current !== requestId ||
          state.workspace?.path !== workspacePath
        ) {
          return;
        }
        state.setDirectoryTree(entries);
      })
      .catch((err) => {
        const state = useIDEStore.getState();
        if (
          treeRefreshRequestIdRef.current !== requestId ||
          state.workspace?.path !== workspacePath
        ) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to read directory';
        state.setTreeError(message);
      });
  }, []);

  const scheduleDirectoryTreeRefresh = useCallback(() => {
    if (treeRefreshTimerRef.current) {
      clearTimeout(treeRefreshTimerRef.current);
    }

    treeRefreshTimerRef.current = setTimeout(() => {
      treeRefreshTimerRef.current = null;
      refreshDirectoryTree();
    }, 75);
  }, [refreshDirectoryTree]);

  const handleFileChange = useCallback(
    (event: FileEvent) => {
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
        scheduleDirectoryTreeRefresh();
      }
    },
    [scheduleDirectoryTreeRefresh]
  );

  useFileWatcher(workspace?.path ?? null, handleFileChange);

  useEffect(() => {
    return () => {
      if (treeRefreshTimerRef.current) {
        clearTimeout(treeRefreshTimerRef.current);
      }
    };
  }, []);

  return (
    <ErrorBoundary>
      <IDEShell
        accent="project"
        header={<Header />}
        sidebar={<Sidebar />}
        leftPanel={sidebarView === 'search' ? <SearchPanel /> : <FileExplorer />}
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

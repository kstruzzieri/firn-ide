import { useEffect, useRef, useCallback } from 'react';
import { useIDEStore } from '../stores/ideStore';
import {
  ConfirmBeforeCloseReady,
  SaveWorkspaceState,
  LoadWorkspaceState,
  ReadFile,
} from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import type { workspace } from '../../wailsjs/go/models';

const SAVE_DEBOUNCE_MS = 2000;

interface WorkspaceIdentity {
  path: string;
  name: string;
}

/**
 * Collects the current workspace state from the Zustand store
 * and maps it to the Go backend's WorkspaceState shape.
 *
 * Accepts an optional identity override so callers can serialize
 * the current editor/explorer state under a *different* workspace
 * path (e.g., when flushing the old workspace before a switch).
 */
function collectWorkspaceState(overrideIdentity?: WorkspaceIdentity): workspace.State | null {
  const state = useIDEStore.getState();

  const wsPath = overrideIdentity?.path ?? state.workspace?.path;
  const wsName = overrideIdentity?.name ?? state.workspace?.name;
  if (!wsPath) return null;

  return {
    workspacePath: wsPath,
    workspaceName: wsName ?? '',
    lastOpened: '', // set by backend
    layout: {
      panelSizes: { ...state.panelSizes },
      leftCollapsed: state.isLeftPanelCollapsed,
      rightCollapsed: state.isRightPanelCollapsed,
      bottomCollapsed: state.isBottomPanelCollapsed,
    },
    editor: {
      activeFilePath: state.activeFileId ?? '',
      openFiles: state.openFiles.map((f) => ({
        path: f.path,
        cursorLine: state.cursorPositions[f.id]?.line ?? 1,
        cursorColumn: state.cursorPositions[f.id]?.column ?? 1,
        scrollTop: state.scrollPositions[f.id] ?? 0,
      })),
    },
    explorer: {
      expandedPaths: Array.from(state.expandedPaths),
      rootExpanded: state.isRootExpanded,
    },
    activeSidebar: state.activeSidebarView,
  } as workspace.State;
}

/**
 * Restores workspace state from the backend after a folder is opened.
 */
async function restoreWorkspaceState(workspacePath: string): Promise<void> {
  const store = useIDEStore.getState();
  store.setRestoringWorkspace(true);

  try {
    // Reset workspace-scoped state before applying saved values.
    store.resetWorkspaceSession();

    const state = await LoadWorkspaceState(workspacePath);
    if (!state) return; // first time opening, use defaults

    // Restore layout
    if (state.layout) {
      if (state.layout.panelSizes) {
        const { left, right, bottom } = state.layout.panelSizes;
        if (left > 0) store.setPanelSize('left', left);
        if (right > 0) store.setPanelSize('right', right);
        if (bottom > 0) store.setPanelSize('bottom', bottom);
      }

      // Restore collapsed states — only toggle if current state differs
      const current = useIDEStore.getState();
      if (state.layout.leftCollapsed !== current.isLeftPanelCollapsed) {
        store.toggleLeftPanel();
      }
      if (state.layout.rightCollapsed !== current.isRightPanelCollapsed) {
        store.toggleRightPanel();
      }
      if (state.layout.bottomCollapsed !== current.isBottomPanelCollapsed) {
        store.toggleBottomPanel();
      }
    }

    // Restore sidebar view
    if (state.activeSidebar) {
      store.setSidebarView(state.activeSidebar as 'explorer' | 'search' | 'git' | 'run');
    }

    // Restore explorer expanded paths
    if (state.explorer) {
      if (state.explorer.expandedPaths) {
        useIDEStore.setState({
          expandedPaths: new Set(state.explorer.expandedPaths),
        });
      }
      if (state.explorer.rootExpanded !== undefined) {
        useIDEStore.setState({ isRootExpanded: state.explorer.rootExpanded });
      }
    }

    // Restore open files
    if (state.editor?.openFiles?.length) {
      const scrollPositions: Record<string, number> = {};
      const cursorPositions: Record<string, { line: number; column: number }> = {};

      for (const fileState of state.editor.openFiles) {
        try {
          const fileContent = await ReadFile(fileState.path);
          if (fileContent.isBinary) continue;

          const fileName =
            fileState.path.split('/').pop() ?? fileState.path.split('\\').pop() ?? fileState.path;

          store.openFile({
            id: fileState.path,
            name: fileName,
            path: fileState.path,
            language: '',
            encoding: fileContent.encoding,
            lineEndings: fileContent.lineEndings,
            content: fileContent.content,
            isModified: false,
          });

          // Store view state for later application
          if (fileState.scrollTop > 0) {
            scrollPositions[fileState.path] = fileState.scrollTop;
          }
          if (fileState.cursorLine > 0) {
            cursorPositions[fileState.path] = {
              line: fileState.cursorLine,
              column: fileState.cursorColumn || 1,
            };
          }
        } catch {
          // File no longer exists — skip silently
          continue;
        }
      }

      // Apply saved view state in bulk
      useIDEStore.setState((prev) => ({
        scrollPositions: { ...prev.scrollPositions, ...scrollPositions },
        cursorPositions: { ...prev.cursorPositions, ...cursorPositions },
      }));

      // Set active file (only if it was successfully opened)
      if (state.editor.activeFilePath) {
        const openFiles = useIDEStore.getState().openFiles;
        const activeExists = openFiles.some((f) => f.id === state.editor.activeFilePath);
        if (activeExists) {
          store.setActiveFile(state.editor.activeFilePath);
        }
      }
    }
  } catch (err) {
    console.warn('Failed to restore workspace state:', err);
  } finally {
    useIDEStore.getState().setRestoringWorkspace(false);
  }
}

/**
 * Main persistence hook. Handles:
 * - Debounced save on any relevant state change
 * - Restore on workspace switch (with correct flush of old workspace)
 * - Immediate flush on visibility change, blur, and app close
 */
export function useWorkspacePersistence() {
  const workspace = useIDEStore((state) => state.workspace);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const prevWorkspaceRef = useRef<WorkspaceIdentity | null>(null);

  /**
   * Flush save — optionally for a specific workspace identity.
   * When switching workspaces, the caller passes the OLD identity
   * so the current editor state is saved under the correct path.
   */
  const flushSave = useCallback(async (identityOverride?: WorkspaceIdentity) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (isSavingRef.current) return;

    const state = collectWorkspaceState(identityOverride);
    if (!state) return;

    isSavingRef.current = true;
    try {
      await SaveWorkspaceState(state);
    } catch (err) {
      console.error('Failed to save workspace state:', err);
    } finally {
      isSavingRef.current = false;
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (useIDEStore.getState().isRestoringWorkspace) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushSave(), SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // Subscribe to relevant state changes
  useEffect(() => {
    if (!workspace) return;

    const unsubscribe = useIDEStore.subscribe((state, prevState) => {
      if (state.isRestoringWorkspace) return;

      if (
        state.openFiles !== prevState.openFiles ||
        state.activeFileId !== prevState.activeFileId ||
        state.panelSizes !== prevState.panelSizes ||
        state.isLeftPanelCollapsed !== prevState.isLeftPanelCollapsed ||
        state.isRightPanelCollapsed !== prevState.isRightPanelCollapsed ||
        state.isBottomPanelCollapsed !== prevState.isBottomPanelCollapsed ||
        state.activeSidebarView !== prevState.activeSidebarView ||
        state.expandedPaths !== prevState.expandedPaths ||
        state.isRootExpanded !== prevState.isRootExpanded ||
        state.scrollPositions !== prevState.scrollPositions ||
        state.cursorPositions !== prevState.cursorPositions
      ) {
        scheduleSave();
      }
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [workspace, scheduleSave]);

  // Restore state when workspace changes
  useEffect(() => {
    if (!workspace?.path) return;

    // Don't restore on first mount if workspace was already set
    if (prevWorkspaceRef.current?.path === workspace.path) return;

    // Flush save for previous workspace BEFORE updating the ref.
    // Pass the old identity so collectWorkspaceState serializes
    // the current editor state under the OLD workspace path.
    if (prevWorkspaceRef.current) {
      flushSave(prevWorkspaceRef.current);
    }

    prevWorkspaceRef.current = { path: workspace.path, name: workspace.name };
    restoreWorkspaceState(workspace.path);
  }, [workspace?.path, workspace?.name, flushSave]);

  // Flush on visibility change and window blur
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushSave();
      }
    };
    const handleBlur = () => flushSave();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [flushSave]);

  // Listen for app:beforeclose event from Go backend
  useEffect(() => {
    const handleBeforeClose = async () => {
      try {
        await flushSave();
      } finally {
        try {
          await ConfirmBeforeCloseReady();
        } catch (err) {
          console.error('Failed to acknowledge app close:', err);
        }
      }
    };

    const cancel = EventsOn('app:beforeclose', () => {
      void handleBeforeClose();
    });
    return cancel;
  }, [flushSave]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}

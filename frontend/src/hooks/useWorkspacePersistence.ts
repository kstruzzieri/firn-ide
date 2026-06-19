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
import { createEditorFile } from '../utils/editorFile';
import { pathsReferToSameFile } from '../utils/lspUri';
import { getCachedWorkspaceTree, setCachedWorkspaceTree } from '../utils/workspaceTreeCache';

const SAVE_DEBOUNCE_MS = 2000;

interface WorkspaceIdentity {
  path: string;
  name: string;
}

interface CollectWorkspaceOptions {
  includeTreeSnapshot?: boolean;
}

/**
 * Collects the current workspace state from the Zustand store
 * and maps it to the Go backend's WorkspaceState shape.
 *
 * Accepts an optional identity override so callers can serialize
 * the current editor/explorer state under a *different* workspace
 * path (e.g., when flushing the old workspace before a switch).
 */
function collectWorkspaceState(
  overrideIdentity?: WorkspaceIdentity,
  options?: CollectWorkspaceOptions
): workspace.State | null {
  const state = useIDEStore.getState();
  const includeTreeSnapshot = options?.includeTreeSnapshot ?? false;

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
      treeSnapshot: includeTreeSnapshot ? state.directoryTree : undefined,
    },
    activeSidebar: state.activeSidebarView,
    hiddenProfileIds: state.hiddenProfileIds,
    activeWorkspaceId: state.activeWorkspaceId,
  } as workspace.State;
}

/**
 * Restores workspace state from the backend after a folder is opened.
 * Accepts an AbortSignal so the caller can cancel a stale restore when
 * the user switches workspaces before the previous restore completes.
 */
async function restoreWorkspaceState(workspacePath: string, signal: AbortSignal): Promise<void> {
  const store = useIDEStore.getState();
  store.setRestoringWorkspace(true);

  try {
    const cachedTree = getCachedWorkspaceTree(workspacePath);

    // Reset workspace-scoped state before applying saved values.
    store.resetWorkspaceSession();

    if (cachedTree !== undefined) {
      store.setDirectoryTree(cachedTree);
    }

    const state = await LoadWorkspaceState(workspacePath);
    if (signal.aborted) return;
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

    // Restore hidden profile IDs
    if (state.hiddenProfileIds) {
      useIDEStore.setState({ hiddenProfileIds: state.hiddenProfileIds });
    }

    // Restore active workspace selection
    if (state.activeWorkspaceId) {
      // Set the raw id; setWorkspaces (run by detection) re-validates it against
      // the detected list, so this is order-independent w.r.t. detection. The
      // accent selectors also fall back to "project" while the id is unresolved.
      useIDEStore.setState({ activeWorkspaceId: state.activeWorkspaceId });
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
      if (state.explorer.treeSnapshot) {
        setCachedWorkspaceTree(workspacePath, state.explorer.treeSnapshot);
        store.setDirectoryTree(state.explorer.treeSnapshot);
      }
    }

    if (signal.aborted) return;

    // Restore open files
    if (state.editor?.openFiles?.length) {
      const scrollPositions: Record<string, number> = {};
      const cursorPositions: Record<string, { line: number; column: number }> = {};

      for (const fileState of state.editor.openFiles) {
        if (signal.aborted) return;
        try {
          const fileContent = await ReadFile(fileState.path);
          if (signal.aborted) return;
          if (fileContent.isBinary) continue;

          const editorFile = createEditorFile(fileState.path, fileContent);
          store.openFile(editorFile);

          // Use the normalized file ID for view-state keys so they match
          // the ID that openFile stored (important on Windows where
          // createEditorFile normalizes c:/... -> C:\...).
          const fileId = editorFile.id;
          if (fileState.scrollTop > 0) {
            scrollPositions[fileId] = fileState.scrollTop;
          }
          if (fileState.cursorLine > 0) {
            cursorPositions[fileId] = {
              line: fileState.cursorLine,
              column: fileState.cursorColumn || 1,
            };
          }
        } catch {
          // File no longer exists — skip silently
          continue;
        }
      }

      if (signal.aborted) return;

      // Apply saved view state in bulk
      useIDEStore.setState((prev) => ({
        scrollPositions: { ...prev.scrollPositions, ...scrollPositions },
        cursorPositions: { ...prev.cursorPositions, ...cursorPositions },
      }));

      // Set active file (only if it was successfully opened).
      // Compare with pathsReferToSameFile since the saved activeFilePath may
      // differ in case/slash form from the normalized EditorFile.id.
      if (state.editor.activeFilePath) {
        const openFiles = useIDEStore.getState().openFiles;
        const match = openFiles.find((f) =>
          pathsReferToSameFile(f.id, state.editor.activeFilePath)
        );
        if (match) {
          store.setActiveFile(match.id);
        }
      }
    }
  } catch (err) {
    console.warn('Failed to restore workspace state:', err);
  } finally {
    if (!signal.aborted) {
      useIDEStore.getState().setRestoringWorkspace(false);
    }
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
  const savePromiseRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveOptionsRef = useRef<CollectWorkspaceOptions>({});
  const prevWorkspaceRef = useRef<WorkspaceIdentity | null>(null);

  /**
   * Flush save — optionally for a specific workspace identity.
   * When switching workspaces, the caller passes the OLD identity
   * so the current editor state is saved under the correct path.
   *
   * If a save is already in flight, waits for it to finish and then
   * saves a fresh snapshot so recent changes are never dropped.
   */
  const flushSave = useCallback(
    async (identityOverride?: WorkspaceIdentity, options?: CollectWorkspaceOptions) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const saveOptions = {
        includeTreeSnapshot: Boolean(
          pendingSaveOptionsRef.current.includeTreeSnapshot || options?.includeTreeSnapshot
        ),
      };
      pendingSaveOptionsRef.current = {};

      // Wait for any in-flight save to complete before collecting a fresh snapshot.
      await savePromiseRef.current;

      const state = collectWorkspaceState(identityOverride, saveOptions);
      if (!state) return;

      const promise = SaveWorkspaceState(state)
        .catch((err) => {
          console.error('Failed to save workspace state:', err);
        })
        .finally(() => {
          if (savePromiseRef.current === promise) {
            savePromiseRef.current = Promise.resolve();
          }
        });

      savePromiseRef.current = promise;
      await promise;
    },
    []
  );

  const scheduleSave = useCallback(
    (options?: CollectWorkspaceOptions) => {
      if (useIDEStore.getState().isRestoringWorkspace) return;

      pendingSaveOptionsRef.current = {
        includeTreeSnapshot: Boolean(
          pendingSaveOptionsRef.current.includeTreeSnapshot || options?.includeTreeSnapshot
        ),
      };

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => flushSave(), SAVE_DEBOUNCE_MS);
    },
    [flushSave]
  );

  // Subscribe to relevant state changes
  useEffect(() => {
    if (!workspace) return;

    const unsubscribe = useIDEStore.subscribe((state, prevState) => {
      if (state.isRestoringWorkspace) return;
      if (state.workspace?.path !== prevState.workspace?.path) return;

      if (state.workspace?.path && state.directoryTree !== prevState.directoryTree) {
        setCachedWorkspaceTree(state.workspace.path, state.directoryTree);
      }

      const treeChanged = state.directoryTree !== prevState.directoryTree;
      const shouldSaveTree = treeChanged;

      if (
        state.openFiles !== prevState.openFiles ||
        state.activeFileId !== prevState.activeFileId ||
        shouldSaveTree ||
        state.panelSizes !== prevState.panelSizes ||
        state.isLeftPanelCollapsed !== prevState.isLeftPanelCollapsed ||
        state.isRightPanelCollapsed !== prevState.isRightPanelCollapsed ||
        state.isBottomPanelCollapsed !== prevState.isBottomPanelCollapsed ||
        state.activeSidebarView !== prevState.activeSidebarView ||
        state.expandedPaths !== prevState.expandedPaths ||
        state.isRootExpanded !== prevState.isRootExpanded ||
        state.scrollPositions !== prevState.scrollPositions ||
        state.cursorPositions !== prevState.cursorPositions ||
        state.hiddenProfileIds !== prevState.hiddenProfileIds ||
        state.activeWorkspaceId !== prevState.activeWorkspaceId
      ) {
        scheduleSave(shouldSaveTree ? { includeTreeSnapshot: true } : undefined);
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

  // Restore state when workspace changes.
  // An AbortController cancels any in-flight restore when the workspace
  // changes again, preventing stale state from leaking into the new session.
  useEffect(() => {
    if (!workspace?.path) return;

    // Don't restore on first mount if workspace was already set
    if (prevWorkspaceRef.current?.path === workspace.path) return;

    // Flush save for previous workspace BEFORE updating the ref.
    // Pass the old identity so collectWorkspaceState serializes
    // the current editor state under the OLD workspace path.
    if (prevWorkspaceRef.current) {
      void flushSave(prevWorkspaceRef.current, { includeTreeSnapshot: true });
    }

    prevWorkspaceRef.current = { path: workspace.path, name: workspace.name };

    const controller = new AbortController();
    restoreWorkspaceState(workspace.path, controller.signal);

    return () => {
      controller.abort();
    };
  }, [workspace?.path, workspace?.name, flushSave]);

  // Flush on visibility change and window blur
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushSave(undefined, { includeTreeSnapshot: true });
      }
    };
    const handleBlur = () => {
      void flushSave(undefined, { includeTreeSnapshot: true });
    };

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
        await flushSave(undefined, { includeTreeSnapshot: true });
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

import { useIDEStore, type WorkspaceInfo } from '../stores/ideStore';
import { WindowSetTitle } from '../wails/runtime';
import { ensurePathLoaded } from '../hooks/useEnsurePathLoaded';
import { getCachedWorkspaceTree } from './workspaceTreeCache';
import { pathsUnderRootAncestorFirst } from './workspaceRegions';

const MAX_RECENT = 10;

/**
 * Opens a workspace by its absolute path. Handles clearing stale tree,
 * setting workspace state, updating the window title, and optimistically
 * updating the recent workspaces list.
 *
 * Shared by both the native dialog flow and recent-project clicks.
 */
export function openWorkspaceByPath(folderPath: string) {
  if (!folderPath || !folderPath.trim()) {
    return;
  }

  const store = useIDEStore.getState();

  // Already on this workspace: a reopen is a tree-only refresh. A full open
  // would pause run events and reset run state for no reason, but doing
  // nothing leaves a tree that went stale while the project was closed (#256).
  if (store.workspace?.path === folderPath) {
    void refreshTreeFromDisk(store.workspace, store.expandedPaths);
    return;
  }

  const separator = folderPath.includes('\\') ? '\\' : '/';
  const folderName = folderPath.split(separator).pop() || folderPath;
  const cachedTree = getCachedWorkspaceTree(folderPath);

  try {
    store.pauseRunEvents();
    store.resetWorkspaceRunState();
    // Switch workspace and tree state in one store update so the explorer can
    // immediately render a cached tree for the target workspace, while still
    // avoiding any brief stale-tree flash from the previous workspace.
    useIDEStore.setState(
      {
        workspace: { name: folderName, path: folderPath },
        workingDirectory: folderPath,
        directoryTree: cachedTree ?? [],
        isLoadingTree: cachedTree === undefined,
        treeError: null,
      },
      false,
      'openWorkspace'
    );

    // Update window title
    WindowSetTitle(`${folderName} \u2014 Firn`);

    // Optimistically update the recent workspaces list so the UI reflects
    // the change immediately, without waiting for the backend save + refetch.
    // Bump the version so any in-flight backend fetch knows to discard its result.
    const now = new Date().toISOString();
    const filtered = store.recentWorkspaces.filter((w) => w.path !== folderPath);
    const updated = [{ name: folderName, path: folderPath, lastOpened: now }, ...filtered];
    useIDEStore.setState(
      (s) => ({
        recentWorkspaces: updated.slice(0, MAX_RECENT),
        recentWorkspacesVersion: s.recentWorkspacesVersion + 1,
      }),
      false,
      'setRecentWorkspaces/optimistic'
    );
  } catch (err) {
    console.error('Failed to open workspace:', err);
    store.showToast(
      `Failed to open workspace: ${err instanceof Error ? err.message : 'Unknown error'}`,
      'error'
    );
  }
}

/**
 * Re-reads the root and every expanded directory of `workspace` from disk,
 * ancestor-first. Stops if the workspace changes underneath it; each read's
 * own failure handling (dirty marker + toast) lives in ensurePathLoaded.
 */
async function refreshTreeFromDisk(
  workspace: WorkspaceInfo,
  expandedPaths: Iterable<string>
): Promise<void> {
  const paths = pathsUnderRootAncestorFirst(workspace.path, [workspace.path, ...expandedPaths]);
  for (const path of paths) {
    if (useIDEStore.getState().workspace !== workspace) return;
    await ensurePathLoaded(path, { force: true });
  }
}

/**
 * Shortens a filesystem path for display by replacing the home directory with ~.
 */
export function shortenPath(fullPath: string): string {
  if (!fullPath) return fullPath;

  // Unix: /Users/<name>/rest... or /home/<name>/rest... -> ~/rest...
  if (fullPath.startsWith('/Users/') || fullPath.startsWith('/home/')) {
    const parts = fullPath.split('/');
    if (parts.length > 3) {
      return '~/' + parts.slice(3).join('/');
    }
    return '~';
  }

  // Windows: C:\Users\<name>\rest... -> ~\rest...
  if (/^[A-Z]:\\Users\\/i.test(fullPath)) {
    const parts = fullPath.split('\\');
    if (parts.length > 3) {
      return '~\\' + parts.slice(3).join('\\');
    }
    return '~';
  }

  return fullPath;
}

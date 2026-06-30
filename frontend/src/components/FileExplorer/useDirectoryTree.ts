import { useEffect, useCallback, useRef } from 'react';
import { ReadDirectoryShallow } from '../../../wailsjs/go/main/App';
import { useIDEStore, useWorkspace } from '../../stores/ideStore';
import { getCachedWorkspaceTree } from '../../utils/workspaceTreeCache';

/**
 * Hook to manage directory tree data fetching and state.
 * Automatically fetches the tree when the workspace changes.
 *
 * Uses a request generation counter so that when the workspace changes
 * mid-flight, stale ReadDirectoryShallow results are silently discarded instead
 * of overwriting the tree for the newly-selected workspace.
 */
export function useDirectoryTree() {
  const workspace = useWorkspace();
  const setDirectoryTree = useIDEStore((state) => state.setDirectoryTree);
  const setTreeLoading = useIDEStore((state) => state.setTreeLoading);
  const setTreeError = useIDEStore((state) => state.setTreeError);
  const requestIdRef = useRef(0);

  const fetchTree = useCallback(async () => {
    if (!workspace?.path) {
      setDirectoryTree([]);
      setTreeLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const hasCachedTree = getCachedWorkspaceTree(workspace.path) !== undefined;

    if (!hasCachedTree) {
      setTreeLoading(true);
    }
    setTreeError(null);

    try {
      const entries = await ReadDirectoryShallow(workspace.path);
      if (requestIdRef.current !== requestId) return;
      setDirectoryTree(entries);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      if (hasCachedTree) {
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to read directory';
      setTreeError(message);
    } finally {
      if (requestIdRef.current === requestId && !hasCachedTree) {
        setTreeLoading(false);
      }
    }
  }, [workspace?.path, setDirectoryTree, setTreeLoading, setTreeError]);

  // Fetch tree when workspace changes
  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  return { refetch: fetchTree };
}

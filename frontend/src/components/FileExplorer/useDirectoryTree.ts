import { useEffect, useCallback } from 'react';
import { ReadDirectory } from '../../../wailsjs/go/main/App';
import { useIDEStore, useWorkspace } from '../../stores/ideStore';

/**
 * Hook to manage directory tree data fetching and state.
 * Automatically fetches the tree when the workspace changes.
 */
export function useDirectoryTree() {
  const workspace = useWorkspace();
  const setDirectoryTree = useIDEStore((state) => state.setDirectoryTree);
  const setTreeLoading = useIDEStore((state) => state.setTreeLoading);
  const setTreeError = useIDEStore((state) => state.setTreeError);

  const fetchTree = useCallback(async () => {
    if (!workspace?.path) {
      setDirectoryTree([]);
      return;
    }

    setTreeLoading(true);
    setTreeError(null);

    try {
      const entries = await ReadDirectory(workspace.path);
      setDirectoryTree(entries);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read directory';
      setTreeError(message);
    } finally {
      setTreeLoading(false);
    }
  }, [workspace?.path, setDirectoryTree, setTreeLoading, setTreeError]);

  // Fetch tree when workspace changes
  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  return { refetch: fetchTree };
}

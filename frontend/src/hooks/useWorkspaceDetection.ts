import { useEffect } from 'react';
import { useIDEStore } from '../stores/ideStore';
import { DetectWorkspaces } from '../../wailsjs/go/main/App';

/**
 * Detects the focused workspaces inside the open repo whenever the repo path
 * changes. Read-only: results are held in the store, never written to disk.
 * Clears the list when no repo is open.
 */
export function useWorkspaceDetection() {
  const repoPath = useIDEStore((state) => state.workspace?.path ?? '');

  useEffect(() => {
    if (!repoPath) {
      useIDEStore.getState().setWorkspaces([]);
      return;
    }

    let cancelled = false;
    DetectWorkspaces(repoPath)
      .then((defs) => {
        if (!cancelled) {
          useIDEStore.getState().setWorkspaces(defs ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('workspace detection failed:', err);
          useIDEStore.getState().setWorkspaces([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);
}

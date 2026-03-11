import { useEffect } from 'react';
import { useIDEStore } from '../stores/ideStore';
import { ListRecentWorkspaces } from '../../wailsjs/go/main/App';

const MAX_RECENT = 10;

/**
 * Fetches recent workspaces from the backend on mount and whenever the
 * active workspace changes (since opening a workspace updates lastOpened).
 */
export function useRecentWorkspaces() {
  const workspacePath = useIDEStore((state) => state.workspace?.path);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const all = await ListRecentWorkspaces();
        if (cancelled) return;
        const limited = (all ?? []).slice(0, MAX_RECENT);
        useIDEStore.getState().setRecentWorkspaces(limited);
      } catch (err) {
        console.warn('Failed to load recent workspaces:', err);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);
}

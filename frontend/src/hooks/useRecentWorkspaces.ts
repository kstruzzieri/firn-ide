import { useEffect } from 'react';
import { useIDEStore } from '../stores/ideStore';
import { ListRecentWorkspaces } from '../../wailsjs/go/main/App';

const MAX_RECENT = 10;

/**
 * Fetches recent workspaces from the backend on mount.
 *
 * In-session workspace switches are handled by the optimistic update in
 * `openWorkspaceByPath`, so we intentionally do NOT refetch when
 * `workspace.path` changes — the backend only persists `LastOpened`
 * during `SaveWorkspaceState` (autosave / blur / close), so an
 * immediate refetch would overwrite the optimistic state with stale data.
 */
export function useRecentWorkspaces() {
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
  }, []);
}

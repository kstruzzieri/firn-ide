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
 *
 * To guard the mount fetch itself, we snapshot `recentWorkspacesVersion`
 * before calling the backend. If an optimistic update bumps the version
 * while the fetch is in flight, we discard the stale backend response.
 */
export function useRecentWorkspaces() {
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const versionAtStart = useIDEStore.getState().recentWorkspacesVersion;

      try {
        const all = await ListRecentWorkspaces();
        if (cancelled) return;

        // An optimistic update happened while the fetch was in flight —
        // the in-memory list is more current than the backend response.
        if (useIDEStore.getState().recentWorkspacesVersion !== versionAtStart) return;

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

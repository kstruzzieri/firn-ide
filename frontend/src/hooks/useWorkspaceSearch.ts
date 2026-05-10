import { useEffect, useRef } from 'react';
import { CancelSearch, SearchWorkspace } from '../../wailsjs/go/main/App';
import { search } from '../../wailsjs/go/models';
import { useIDEStore } from '../stores/ideStore';
import { useSearchStore } from '../stores/searchStore';
import type { SearchResponse, SearchStatus } from '../types/search';

export const SEARCH_DEBOUNCE_MS = 250;

const KNOWN_STATUSES: ReadonlySet<SearchStatus> = new Set<SearchStatus>([
  'success',
  'no_matches',
  'missing_tool',
  'invalid_regex',
  'canceled',
  'failed',
]);

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string' && err.length > 0) return err;
  return 'Search failed.';
}

// Narrow the generated `status: string` to the SearchStatus union, defaulting
// unknown statuses to 'failed' so the UI surfaces the issue rather than
// silently dropping the response.
function narrowResponse(raw: search.SearchResponse): SearchResponse {
  const status: SearchStatus = KNOWN_STATUSES.has(raw.status as SearchStatus)
    ? (raw.status as SearchStatus)
    : 'failed';
  return {
    requestId: raw.requestId,
    status,
    message:
      status === 'failed' && !raw.message ? `Unexpected search status: ${raw.status}` : raw.message,
    files: raw.files,
    totalFiles: raw.totalFiles,
    totalLines: raw.totalLines,
    truncated: raw.truncated,
    matchCap: raw.matchCap,
    durationMs: raw.durationMs,
  };
}

function fireCancelSearch(requestId: string): void {
  void CancelSearch(requestId).catch((err) => {
    console.error(`Search cancel failed for ${requestId}:`, err);
  });
}

/**
 * useWorkspaceSearch wires the search store to backend ripgrep.
 *
 * Responsibilities:
 *   - debounce query/option changes by SEARCH_DEBOUNCE_MS before invoking
 *     SearchWorkspace, so rapid typing collapses into one request
 *   - assign each fired request a unique RequestID; drop stale responses by
 *     comparing against the store's activeRequestId
 *   - on workspace switch or unmount, fire CancelSearch(activeRequestId) so
 *     the backend ripgrep process is reaped instead of running to completion
 *   - keep ideStore.workspace and searchStore in sync: empty query → empty
 *     state, no workspace → no-workspace state
 *
 * The hook is fire-and-forget; mount it once at the top of the app.
 */
export function useWorkspaceSearch(): void {
  const workspacePath = useIDEStore((state) => state.workspace?.path ?? null);
  const query = useSearchStore((state) => state.query);
  const options = useSearchStore((state) => state.options);
  const requestCounter = useRef(0);

  // Workspace-switch listener: cancel any in-flight search and reset state
  // when the user opens a different workspace. Subscribed once at mount; the
  // dep array is empty so the subscription persists for the hook's lifetime.
  useEffect(() => {
    let previousWorkspacePath = useIDEStore.getState().workspace?.path ?? null;

    return useIDEStore.subscribe((state) => {
      const nextWorkspacePath = state.workspace?.path ?? null;
      if (nextWorkspacePath === previousWorkspacePath) return;

      const activeRequestId = useSearchStore.getState().activeRequestId;
      if (activeRequestId) fireCancelSearch(activeRequestId);

      useSearchStore.getState().resetForWorkspace(nextWorkspacePath);
      previousWorkspacePath = nextWorkspacePath;
    });
  }, []);

  // Unmount cleanup: cancel any in-flight backend search so the ripgrep
  // process does not outlive the IDE session.
  useEffect(() => {
    return () => {
      const activeRequestId = useSearchStore.getState().activeRequestId;
      if (activeRequestId) fireCancelSearch(activeRequestId);
    };
  }, []);

  // Main debounced search effect. Re-runs whenever the workspace, query, or
  // options change. Stale debounced supersessions are dropped by RequestID,
  // and any request that already reached the backend is canceled during
  // cleanup so only the latest active query keeps a ripgrep process alive.
  useEffect(() => {
    const trimmedQuery = query.trim();

    if (!workspacePath) {
      useSearchStore.getState().setNoWorkspace();
      return;
    }

    if (!trimmedQuery) {
      useSearchStore.getState().setEmptyQuery();
      return;
    }

    let canceled = false;
    let started = false;
    const requestId = `search-${Date.now()}-${++requestCounter.current}`;

    const timer = window.setTimeout(() => {
      if (canceled) return;

      started = true;
      useSearchStore.getState().beginSearch(requestId);

      const request = new search.SearchRequest({
        requestId,
        root: workspacePath,
        query,
        options: { ...options },
      });

      void SearchWorkspace(request)
        .then((raw) => {
          if (canceled) return;
          if (useSearchStore.getState().activeRequestId !== requestId) return;
          useSearchStore.getState().applyResponse(narrowResponse(raw));
        })
        .catch((err) => {
          if (canceled) return;
          if (useSearchStore.getState().activeRequestId !== requestId) return;
          useSearchStore.getState().failSearch(requestId, errorMessage(err));
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
      if (started && useSearchStore.getState().activeRequestId === requestId) {
        fireCancelSearch(requestId);
      }
    };
  }, [options, query, workspacePath]);
}

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import {
  defaultSearchOptions,
  type FileResult,
  type SearchOptions,
  type SearchResponse,
  type SearchUIState,
} from '../types/search';

// Number of file groups expanded by default when results arrive. Picking a
// finite cap prevents the panel from auto-expanding 1000+ files on a wide
// search; smaller results stay fully visible. Task 3 (panel UI) can override
// per-file via toggleFileExpanded.
export const DEFAULT_EXPAND_FILE_LIMIT = 10;

interface SearchState {
  query: string;
  options: SearchOptions;
  uiState: SearchUIState;
  expandedFiles: Set<string>;
  activeRequestId: string | null;
  // Monotonic revision bumped whenever a consumer (e.g. the Cmd+Shift+F
  // keyboard shortcut) wants the SearchPanel input to grab focus. The panel
  // watches this via useEffect so focus requests work even when the panel
  // isn't mounted yet — the shortcut bumps the counter, the panel mounts,
  // sees the new revision in its initial render, and focuses the input.
  focusInputRevision: number;
}

interface SearchActions {
  setQuery: (query: string) => void;
  setOption: (option: keyof SearchOptions, value: boolean) => void;
  beginSearch: (requestId: string) => void;
  applyResponse: (response: SearchResponse) => void;
  failSearch: (requestId: string, message: string) => void;
  setNoWorkspace: () => void;
  setEmptyQuery: () => void;
  resetForWorkspace: (workspacePath: string | null | undefined) => void;
  toggleFileExpanded: (path: string) => void;
  clearResults: () => void;
  requestInputFocus: () => void;
}

type SearchStore = SearchState & SearchActions;

function responseToUIState(response: SearchResponse): SearchUIState {
  switch (response.status) {
    case 'success':
      if (response.files.length === 0) {
        return { kind: 'no-matches', durationMs: response.durationMs };
      }
      return {
        kind: 'results',
        files: response.files,
        totalFiles: response.totalFiles,
        totalLines: response.totalLines,
        truncated: response.truncated,
        matchCap: response.matchCap,
        durationMs: response.durationMs,
      };
    case 'no_matches':
      return { kind: 'no-matches', durationMs: response.durationMs };
    case 'missing_tool':
      return {
        kind: 'missing-tool',
        message: response.message || 'ripgrep is not available on PATH.',
      };
    case 'invalid_regex':
      return {
        kind: 'invalid-regex',
        message: response.message || 'The regular expression is invalid.',
      };
    case 'canceled':
      return { kind: 'canceled' };
    case 'failed':
      return {
        kind: 'failed',
        message: response.message || 'Search failed.',
      };
  }
}

function defaultExpansion(files: FileResult[]): Set<string> {
  if (files.length === 0) return new Set();
  return new Set(files.slice(0, DEFAULT_EXPAND_FILE_LIMIT).map((f) => f.path));
}

export const useSearchStore = create<SearchStore>()(
  devtools(
    (set) => ({
      query: '',
      options: { ...defaultSearchOptions },
      uiState: { kind: 'no-workspace' },
      expandedFiles: new Set<string>(),
      activeRequestId: null,
      focusInputRevision: 0,

      setQuery: (query) => set({ query }, false, 'search/setQuery'),

      setOption: (option, value) =>
        set(
          (state) => ({
            options: { ...state.options, [option]: value },
          }),
          false,
          'search/setOption'
        ),

      beginSearch: (requestId) =>
        set(
          {
            activeRequestId: requestId,
            uiState: { kind: 'loading', requestId },
          },
          false,
          'search/beginSearch'
        ),

      applyResponse: (response) =>
        set(
          (state) => {
            if (state.activeRequestId !== response.requestId) return {};

            const uiState = responseToUIState(response);
            const expandedFiles =
              uiState.kind === 'results' ? defaultExpansion(uiState.files) : new Set<string>();

            return {
              activeRequestId: null,
              uiState,
              expandedFiles,
            };
          },
          false,
          'search/applyResponse'
        ),

      failSearch: (requestId, message) =>
        set(
          (state) => {
            if (state.activeRequestId !== requestId) return {};
            return {
              activeRequestId: null,
              uiState: { kind: 'failed', message },
              expandedFiles: new Set<string>(),
            };
          },
          false,
          'search/failSearch'
        ),

      setNoWorkspace: () =>
        set(
          (state) => {
            if (
              state.uiState.kind === 'no-workspace' &&
              state.activeRequestId === null &&
              state.expandedFiles.size === 0
            ) {
              return {};
            }
            return {
              uiState: { kind: 'no-workspace' },
              activeRequestId: null,
              expandedFiles: new Set<string>(),
            };
          },
          false,
          'search/setNoWorkspace'
        ),

      setEmptyQuery: () =>
        set(
          (state) => {
            if (
              state.uiState.kind === 'empty-query' &&
              state.activeRequestId === null &&
              state.expandedFiles.size === 0
            ) {
              return {};
            }
            return {
              uiState: { kind: 'empty-query' },
              activeRequestId: null,
              expandedFiles: new Set<string>(),
            };
          },
          false,
          'search/setEmptyQuery'
        ),

      resetForWorkspace: (workspacePath) =>
        set(
          {
            query: '',
            options: { ...defaultSearchOptions },
            uiState: workspacePath ? { kind: 'empty-query' } : { kind: 'no-workspace' },
            expandedFiles: new Set<string>(),
            activeRequestId: null,
          },
          false,
          'search/resetForWorkspace'
        ),

      toggleFileExpanded: (path) =>
        set(
          (state) => {
            const expandedFiles = new Set(state.expandedFiles);
            if (expandedFiles.has(path)) {
              expandedFiles.delete(path);
            } else {
              expandedFiles.add(path);
            }
            return { expandedFiles };
          },
          false,
          'search/toggleFileExpanded'
        ),

      clearResults: () =>
        set(
          {
            uiState: { kind: 'empty-query' },
            expandedFiles: new Set<string>(),
            activeRequestId: null,
          },
          false,
          'search/clearResults'
        ),

      requestInputFocus: () =>
        set(
          (state) => ({ focusInputRevision: state.focusInputRevision + 1 }),
          false,
          'search/requestInputFocus'
        ),
    }),
    { name: 'search-store' }
  )
);

export const useSearchOptions = () => useSearchStore((state) => state.options);

export const useSearchSnapshot = () =>
  useSearchStore(
    useShallow((state) => ({
      query: state.query,
      options: state.options,
      uiState: state.uiState,
      expandedFiles: state.expandedFiles,
    }))
  );

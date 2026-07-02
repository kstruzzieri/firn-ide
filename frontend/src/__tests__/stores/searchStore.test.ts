import { DEFAULT_EXPAND_FILE_LIMIT, useSearchStore } from '../../stores/searchStore';
import type { FileResult, SearchResponse } from '../../types/search';

function fileResult(path: string, lines: number[] = [1]): FileResult {
  return {
    path,
    relativePath: path.replace(/^\/workspace\//, ''),
    matches: lines.map((line) => ({
      line,
      column: 1,
      text: `match on line ${line}`,
      submatches: [],
    })),
  };
}

function response(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    requestId: 'request-1',
    status: 'success',
    message: '',
    files: [],
    totalFiles: 0,
    totalLines: 0,
    truncated: false,
    matchCap: 1000,
    durationMs: 4,
    ...overrides,
  };
}

beforeEach(() => {
  useSearchStore.setState(useSearchStore.getInitialState());
});

describe('searchStore', () => {
  describe('initial state', () => {
    it('starts in no-workspace with empty query and default options', () => {
      const state = useSearchStore.getState();
      expect(state.uiState).toEqual({ kind: 'no-workspace' });
      expect(state.query).toBe('');
      expect(state.options).toEqual({ regex: false, caseSensitive: false, wholeWord: false });
      expect(state.expandedFiles.size).toBe(0);
      expect(state.activeRequestId).toBeNull();
    });
  });

  describe('setQuery', () => {
    it('updates the query and leaves uiState alone', () => {
      useSearchStore.getState().setQuery('alpha');
      expect(useSearchStore.getState().query).toBe('alpha');
      expect(useSearchStore.getState().uiState.kind).toBe('no-workspace');
    });
  });

  describe('setOption', () => {
    it.each(['regex', 'caseSensitive', 'wholeWord'] as const)(
      'toggles %s independently',
      (option) => {
        useSearchStore.getState().setOption(option, true);
        expect(useSearchStore.getState().options[option]).toBe(true);

        useSearchStore.getState().setOption(option, false);
        expect(useSearchStore.getState().options[option]).toBe(false);
      }
    );
  });

  describe('beginSearch', () => {
    it('sets activeRequestId and transitions to loading', () => {
      useSearchStore.getState().beginSearch('request-1');
      const state = useSearchStore.getState();
      expect(state.activeRequestId).toBe('request-1');
      expect(state.uiState).toEqual({ kind: 'loading', requestId: 'request-1' });
    });
  });

  describe('applyResponse', () => {
    it('drops responses whose requestId does not match activeRequestId', () => {
      useSearchStore.getState().beginSearch('request-2');
      useSearchStore.getState().applyResponse(response({ requestId: 'request-1' }));

      expect(useSearchStore.getState().uiState).toEqual({
        kind: 'loading',
        requestId: 'request-2',
      });
      expect(useSearchStore.getState().activeRequestId).toBe('request-2');
    });

    it('maps a successful response with files to results state', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().applyResponse(
        response({
          totalFiles: 1,
          totalLines: 1,
          files: [fileResult('/workspace/src/App.tsx')],
        })
      );

      const state = useSearchStore.getState();
      expect(state.uiState).toEqual({
        kind: 'results',
        files: [fileResult('/workspace/src/App.tsx')],
        totalFiles: 1,
        totalLines: 1,
        truncated: false,
        matchCap: 1000,
        durationMs: 4,
      });
      expect(state.activeRequestId).toBeNull();
    });

    it('expands all result files when count is at or below the default limit', () => {
      const files = Array.from({ length: DEFAULT_EXPAND_FILE_LIMIT }, (_, i) =>
        fileResult(`/workspace/file${i}.ts`)
      );
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore
        .getState()
        .applyResponse(response({ totalFiles: files.length, totalLines: files.length, files }));

      const state = useSearchStore.getState();
      expect(state.expandedFiles.size).toBe(DEFAULT_EXPAND_FILE_LIMIT);
      for (const file of files) {
        expect(state.expandedFiles.has(file.path)).toBe(true);
      }
    });

    it('caps default expansion when result count exceeds the limit', () => {
      const files = Array.from({ length: DEFAULT_EXPAND_FILE_LIMIT + 5 }, (_, i) =>
        fileResult(`/workspace/file${i}.ts`)
      );
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore
        .getState()
        .applyResponse(response({ totalFiles: files.length, totalLines: files.length, files }));

      const state = useSearchStore.getState();
      expect(state.expandedFiles.size).toBe(DEFAULT_EXPAND_FILE_LIMIT);
      // First N expanded; tail collapsed.
      for (let i = 0; i < DEFAULT_EXPAND_FILE_LIMIT; i++) {
        expect(state.expandedFiles.has(files[i].path)).toBe(true);
      }
      for (let i = DEFAULT_EXPAND_FILE_LIMIT; i < files.length; i++) {
        expect(state.expandedFiles.has(files[i].path)).toBe(false);
      }
    });

    it('preserves truncation flag and matchCap in results state', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().applyResponse(
        response({
          truncated: true,
          matchCap: 5000,
          totalFiles: 100,
          totalLines: 5000,
          files: [fileResult('/workspace/big.log')],
        })
      );

      const state = useSearchStore.getState();
      expect(state.uiState.kind).toBe('results');
      if (state.uiState.kind === 'results') {
        expect(state.uiState.truncated).toBe(true);
        expect(state.uiState.matchCap).toBe(5000);
        expect(state.uiState.totalFiles).toBe(100);
        expect(state.uiState.totalLines).toBe(5000);
      }
    });

    it('maps a successful response with zero files to no-matches', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().applyResponse(response({ status: 'success', files: [] }));

      expect(useSearchStore.getState().uiState).toEqual({
        kind: 'no-matches',
        durationMs: 4,
      });
    });

    it('maps a no_matches response to no-matches', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().applyResponse(response({ status: 'no_matches' }));

      expect(useSearchStore.getState().uiState).toEqual({
        kind: 'no-matches',
        durationMs: 4,
      });
    });

    it('maps a missing_tool response to missing-tool with the backend message', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore
        .getState()
        .applyResponse(response({ status: 'missing_tool', message: 'install rg' }));

      expect(useSearchStore.getState().uiState).toEqual({
        kind: 'missing-tool',
        message: 'install rg',
      });
    });

    it('uses a fallback message when the backend missing_tool message is empty', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().applyResponse(response({ status: 'missing_tool', message: '' }));

      expect(useSearchStore.getState().uiState).toEqual({
        kind: 'missing-tool',
        message: 'ripgrep is not available on PATH.',
      });
    });

    it('maps an invalid_regex response to invalid-regex with the backend message', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore
        .getState()
        .applyResponse(response({ status: 'invalid_regex', message: 'unclosed group' }));

      expect(useSearchStore.getState().uiState).toEqual({
        kind: 'invalid-regex',
        message: 'unclosed group',
      });
    });

    it('maps a canceled response to canceled', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().applyResponse(response({ status: 'canceled' }));

      expect(useSearchStore.getState().uiState).toEqual({ kind: 'canceled' });
    });

    it('maps a failed response to failed with the backend message', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore
        .getState()
        .applyResponse(response({ status: 'failed', message: 'rg exited with 2' }));

      expect(useSearchStore.getState().uiState).toEqual({
        kind: 'failed',
        message: 'rg exited with 2',
      });
    });

    it('clears expandedFiles on non-result terminal states', () => {
      useSearchStore.getState().toggleFileExpanded('/workspace/keep.ts');
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().applyResponse(response({ status: 'failed', message: 'boom' }));

      expect(useSearchStore.getState().expandedFiles.size).toBe(0);
    });
  });

  describe('failSearch', () => {
    it('transitions to failed when requestId matches', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().failSearch('request-1', 'IPC error');

      const state = useSearchStore.getState();
      expect(state.uiState).toEqual({ kind: 'failed', message: 'IPC error' });
      expect(state.activeRequestId).toBeNull();
    });

    it('ignores stale failures from superseded requests', () => {
      useSearchStore.getState().beginSearch('request-2');
      useSearchStore.getState().failSearch('request-1', 'late failure');

      expect(useSearchStore.getState().uiState).toEqual({
        kind: 'loading',
        requestId: 'request-2',
      });
    });
  });

  describe('setNoWorkspace', () => {
    it('clears uiState, activeRequestId, and expandedFiles', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().toggleFileExpanded('/workspace/x.ts');
      useSearchStore.getState().setNoWorkspace();

      const state = useSearchStore.getState();
      expect(state.uiState).toEqual({ kind: 'no-workspace' });
      expect(state.activeRequestId).toBeNull();
      expect(state.expandedFiles.size).toBe(0);
    });

    it('is a no-op when already in clean no-workspace state (preserves identity)', () => {
      const before = useSearchStore.getState();
      useSearchStore.getState().setNoWorkspace();
      const after = useSearchStore.getState();
      expect(after.uiState).toBe(before.uiState);
      expect(after.expandedFiles).toBe(before.expandedFiles);
    });
  });

  describe('setEmptyQuery', () => {
    it('transitions to empty-query and clears active request', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().setEmptyQuery();

      const state = useSearchStore.getState();
      expect(state.uiState).toEqual({ kind: 'empty-query' });
      expect(state.activeRequestId).toBeNull();
    });

    it('is a no-op when already in clean empty-query state', () => {
      useSearchStore.getState().setEmptyQuery();
      const before = useSearchStore.getState();
      useSearchStore.getState().setEmptyQuery();
      const after = useSearchStore.getState();
      expect(after.uiState).toBe(before.uiState);
    });
  });

  describe('resetForWorkspace', () => {
    it('resets to empty-query when given a non-null path', () => {
      useSearchStore.getState().setQuery('alpha');
      useSearchStore.getState().setOption('regex', true);
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().resetForWorkspace('/workspace');

      const state = useSearchStore.getState();
      expect(state.query).toBe('');
      expect(state.options).toEqual({ regex: false, caseSensitive: false, wholeWord: false });
      expect(state.uiState).toEqual({ kind: 'empty-query' });
      expect(state.activeRequestId).toBeNull();
      expect(state.expandedFiles.size).toBe(0);
    });

    it('resets to no-workspace when given null', () => {
      useSearchStore.getState().setQuery('alpha');
      useSearchStore.getState().resetForWorkspace(null);

      expect(useSearchStore.getState().uiState).toEqual({ kind: 'no-workspace' });
      expect(useSearchStore.getState().query).toBe('');
    });

    it('resets to no-workspace when given undefined', () => {
      useSearchStore.getState().resetForWorkspace(undefined);
      expect(useSearchStore.getState().uiState).toEqual({ kind: 'no-workspace' });
    });
  });

  describe('toggleFileExpanded', () => {
    it('adds the path when not present', () => {
      useSearchStore.getState().toggleFileExpanded('/workspace/a.ts');
      expect(useSearchStore.getState().expandedFiles.has('/workspace/a.ts')).toBe(true);
    });

    it('removes the path when already present', () => {
      useSearchStore.getState().toggleFileExpanded('/workspace/a.ts');
      useSearchStore.getState().toggleFileExpanded('/workspace/a.ts');
      expect(useSearchStore.getState().expandedFiles.has('/workspace/a.ts')).toBe(false);
    });

    it('preserves other expansions', () => {
      useSearchStore.getState().toggleFileExpanded('/workspace/a.ts');
      useSearchStore.getState().toggleFileExpanded('/workspace/b.ts');
      useSearchStore.getState().toggleFileExpanded('/workspace/a.ts');

      const expanded = useSearchStore.getState().expandedFiles;
      expect(expanded.has('/workspace/a.ts')).toBe(false);
      expect(expanded.has('/workspace/b.ts')).toBe(true);
    });

    it('returns a fresh Set instance to support shallow equality re-render checks', () => {
      const before = useSearchStore.getState().expandedFiles;
      useSearchStore.getState().toggleFileExpanded('/workspace/a.ts');
      const after = useSearchStore.getState().expandedFiles;
      expect(after).not.toBe(before);
    });
  });

  describe('clearResults', () => {
    it('returns the store to empty-query and drops expansions and active id', () => {
      useSearchStore.getState().beginSearch('request-1');
      useSearchStore.getState().toggleFileExpanded('/workspace/a.ts');
      useSearchStore.getState().clearResults();

      const state = useSearchStore.getState();
      expect(state.uiState).toEqual({ kind: 'empty-query' });
      expect(state.activeRequestId).toBeNull();
      expect(state.expandedFiles.size).toBe(0);
    });
  });
});

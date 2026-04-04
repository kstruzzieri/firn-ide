import { renderHook, act } from '@testing-library/react';
import {
  useLSPStore,
  useLSPDiagnosticCount,
  useLSPErrorCount,
  useLSPInfoCount,
  useLSPWarningCount,
  useGroupedDiagnostics,
  type LSPDiagnostic,
} from '../../stores/lspStore';

beforeEach(() => {
  useLSPStore.setState(useLSPStore.getInitialState());
});

describe('lspStore', () => {
  describe('diagnostics', () => {
    const sampleDiag: LSPDiagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      severity: 1,
      message: 'Type error',
      source: 'ts',
    };

    it('stores diagnostics by URI', () => {
      useLSPStore.getState().setDiagnostics('file:///test.ts', [sampleDiag]);
      expect(useLSPStore.getState().diagnostics.get('file:///test.ts')).toEqual([sampleDiag]);
    });

    it('replaces previous diagnostics for same URI', () => {
      const { setDiagnostics } = useLSPStore.getState();
      setDiagnostics('file:///test.ts', [sampleDiag]);
      setDiagnostics('file:///test.ts', []);
      expect(useLSPStore.getState().diagnostics.get('file:///test.ts')).toEqual([]);
    });

    it('tracks diagnostics for multiple URIs independently', () => {
      const { setDiagnostics } = useLSPStore.getState();
      setDiagnostics('file:///a.ts', [sampleDiag]);
      setDiagnostics('file:///b.ts', [{ ...sampleDiag, severity: 2, message: 'Warning' }]);

      const diags = useLSPStore.getState().diagnostics;
      expect(diags.size).toBe(2);
      expect(diags.get('file:///a.ts')![0].severity).toBe(1);
      expect(diags.get('file:///b.ts')![0].severity).toBe(2);
    });

    it('removes diagnostics for a single URI', () => {
      const { setDiagnostics, removeDiagnostics } = useLSPStore.getState();
      setDiagnostics('file:///a.ts', [sampleDiag]);
      setDiagnostics('file:///b.ts', [sampleDiag]);
      removeDiagnostics('file:///a.ts');

      const diags = useLSPStore.getState().diagnostics;
      expect(diags.has('file:///a.ts')).toBe(false);
      expect(diags.has('file:///b.ts')).toBe(true);
    });

    it('clears all diagnostics', () => {
      const { setDiagnostics, clearAllDiagnostics } = useLSPStore.getState();
      setDiagnostics('file:///a.ts', [sampleDiag]);
      setDiagnostics('file:///b.ts', [sampleDiag]);
      clearAllDiagnostics();
      expect(useLSPStore.getState().diagnostics.size).toBe(0);
    });
  });

  describe('derived counts', () => {
    it('counts errors (severity 1) and warnings (severity 2)', () => {
      useLSPStore.getState().setDiagnostics('file:///a.ts', [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 1,
          message: 'err1',
        },
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
          severity: 1,
          message: 'err2',
        },
      ]);
      useLSPStore.getState().setDiagnostics('file:///b.ts', [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 2,
          message: 'warn1',
        },
      ]);

      expect(useLSPStore.getState().errorCount()).toBe(2);
      expect(useLSPStore.getState().warningCount()).toBe(1);
    });

    it('returns 0 when no diagnostics', () => {
      expect(useLSPStore.getState().errorCount()).toBe(0);
      expect(useLSPStore.getState().warningCount()).toBe(0);
    });
  });

  describe('reactive selectors', () => {
    it('useLSPErrorCount returns error count reactively', () => {
      const { result } = renderHook(() => useLSPErrorCount());
      expect(result.current).toBe(0);

      act(() => {
        useLSPStore.getState().setDiagnostics('file:///test.ts', [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1,
            message: 'err',
          },
        ]);
      });

      expect(result.current).toBe(1);
    });

    it('useLSPWarningCount returns warning count reactively', () => {
      const { result } = renderHook(() => useLSPWarningCount());
      expect(result.current).toBe(0);

      act(() => {
        useLSPStore.getState().setDiagnostics('file:///test.ts', [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 2,
            message: 'warn',
          },
        ]);
      });

      expect(result.current).toBe(1);
    });

    it('useLSPInfoCount includes informational and unspecified severities', () => {
      const { result } = renderHook(() => useLSPInfoCount());
      expect(result.current).toBe(0);

      act(() => {
        useLSPStore.getState().setDiagnostics('file:///test.ts', [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 3,
            message: 'info',
          },
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
            message: 'hint-like without severity',
          },
        ]);
      });

      expect(result.current).toBe(2);
    });

    it('useLSPDiagnosticCount matches every Problems panel entry', () => {
      const { result } = renderHook(() => useLSPDiagnosticCount());
      expect(result.current).toBe(0);

      act(() => {
        useLSPStore.getState().setDiagnostics('file:///test.ts', [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1,
            message: 'error',
          },
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
            severity: 4,
            message: 'hint',
          },
        ]);
      });

      expect(result.current).toBe(2);
    });

    it('useGroupedDiagnostics groups by file and sorts by severity', () => {
      const { result } = renderHook(() => useGroupedDiagnostics());

      act(() => {
        useLSPStore.getState().setDiagnostics('file:///b.ts', [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 2,
            message: 'warning only',
          },
        ]);
        useLSPStore.getState().setDiagnostics('file:///a.ts', [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1,
            message: 'error here',
          },
        ]);
      });

      // File with errors should come first
      expect(result.current).toHaveLength(2);
      expect(result.current[0].filePath).toContain('a.ts');
      expect(result.current[1].filePath).toContain('b.ts');
    });

    it('useGroupedDiagnostics excludes empty groups', () => {
      const { result } = renderHook(() => useGroupedDiagnostics());

      act(() => {
        useLSPStore.getState().setDiagnostics('file:///a.ts', []);
        useLSPStore.getState().setDiagnostics('file:///b.ts', [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1,
            message: 'err',
          },
        ]);
      });

      expect(result.current).toHaveLength(1);
      expect(result.current[0].filePath).toContain('b.ts');
    });

    it('counts clear to zero when diagnostics are removed', () => {
      const { result: errorResult } = renderHook(() => useLSPErrorCount());

      act(() => {
        useLSPStore.getState().setDiagnostics('file:///test.ts', [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1,
            message: 'err',
          },
        ]);
      });
      expect(errorResult.current).toBe(1);

      act(() => {
        useLSPStore.getState().clearAllDiagnostics();
      });
      expect(errorResult.current).toBe(0);
    });
  });

  describe('server status', () => {
    it('stores server status keyed by workspace::family', () => {
      useLSPStore.getState().setServerStatus({
        family: 'typescript',
        workspace: '/project',
        state: 'ready',
      });

      const key = '/project::typescript';
      const statuses = useLSPStore.getState().serverStatuses;
      expect(statuses.get(key)).toEqual({
        family: 'typescript',
        workspace: '/project',
        state: 'ready',
      });
    });

    it('updates existing server status', () => {
      const { setServerStatus } = useLSPStore.getState();
      setServerStatus({ family: 'typescript', workspace: '/project', state: 'starting' });
      setServerStatus({ family: 'typescript', workspace: '/project', state: 'ready' });

      expect(useLSPStore.getState().serverStatuses.get('/project::typescript')?.state).toBe(
        'ready'
      );
    });

    it('tracks different workspaces independently', () => {
      const { setServerStatus } = useLSPStore.getState();
      setServerStatus({ family: 'typescript', workspace: '/project-a', state: 'ready' });
      setServerStatus({ family: 'typescript', workspace: '/project-b', state: 'starting' });

      const statuses = useLSPStore.getState().serverStatuses;
      expect(statuses.get('/project-a::typescript')?.state).toBe('ready');
      expect(statuses.get('/project-b::typescript')?.state).toBe('starting');
    });

    it('removes server status', () => {
      const { setServerStatus, removeServerStatus } = useLSPStore.getState();
      setServerStatus({ family: 'typescript', workspace: '/project', state: 'ready' });
      removeServerStatus('/project', 'typescript');
      expect(useLSPStore.getState().serverStatuses.has('/project::typescript')).toBe(false);
    });

    it('clears all statuses', () => {
      const { setServerStatus, clearAllStatuses } = useLSPStore.getState();
      setServerStatus({ family: 'typescript', workspace: '/project', state: 'ready' });
      clearAllStatuses();
      expect(useLSPStore.getState().serverStatuses.size).toBe(0);
    });
  });

  describe('workspace cleanup', () => {
    it('clears all state for a workspace', () => {
      const state = useLSPStore.getState();
      state.setDiagnostics('file:///project/a.ts', [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 1,
          message: 'err',
        },
      ]);
      state.setServerStatus({ family: 'typescript', workspace: '/project', state: 'ready' });

      useLSPStore.getState().clearWorkspaceState('/project');

      expect(useLSPStore.getState().serverStatuses.has('/project::typescript')).toBe(false);
    });
  });
});

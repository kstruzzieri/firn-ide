import { renderHook, act } from '@testing-library/react';
import {
  useLSPStore,
  useLSPDiagnosticCount,
  useLSPErrorCount,
  useLSPInfoCount,
  useLSPWarningCount,
  useGroupedDiagnostics,
  findServerStatusForFile,
  pathContainsOrEquals,
  type LSPDiagnostic,
  type LSPServerStatus,
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

    it('stores a provisioning status with provisionPct', () => {
      useLSPStore.getState().setServerStatus({
        family: 'python',
        workspace: '/project',
        state: 'starting',
        setupState: 'provisioning',
        provisionPct: 60,
      });

      const status = useLSPStore.getState().serverStatuses.get('/project::python');
      expect(status?.setupState).toBe('provisioning');
      expect(status?.provisionPct).toBe(60);
    });

    it('stores offline + provision_failed setup states', () => {
      const { setServerStatus } = useLSPStore.getState();
      setServerStatus({
        family: 'python',
        workspace: '/offline',
        state: 'error',
        setupState: 'offline',
        action: 'retry',
      });
      setServerStatus({
        family: 'python',
        workspace: '/failed',
        state: 'error',
        setupState: 'provision_failed',
        action: 'retry',
      });

      const statuses = useLSPStore.getState().serverStatuses;
      expect(statuses.get('/offline::python')?.setupState).toBe('offline');
      expect(statuses.get('/offline::python')?.action).toBe('retry');
      expect(statuses.get('/failed::python')?.setupState).toBe('provision_failed');
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

    it('clears nested project-root statuses inside the workspace', () => {
      // TypeScript project-root detection (#20) means a single workspace can
      // host multiple servers keyed by nested project roots. Workspace cleanup
      // must sweep all of them.
      const state = useLSPStore.getState();
      state.setServerStatus({
        family: 'typescript',
        workspace: '/project/frontend',
        state: 'ready',
      });
      state.setServerStatus({
        family: 'typescript',
        workspace: '/project/admin',
        state: 'ready',
      });
      state.setServerStatus({
        family: 'typescript',
        workspace: '/other-project',
        state: 'ready',
      });

      useLSPStore.getState().clearWorkspaceState('/project');

      const statuses = useLSPStore.getState().serverStatuses;
      expect(statuses.size).toBe(1);
      expect(Array.from(statuses.values())[0].workspace).toBe('/other-project');
    });
  });

  describe('pathContainsOrEquals', () => {
    it('treats equal paths as contained', () => {
      expect(pathContainsOrEquals('/a/b', '/a/b')).toBe(true);
    });

    it('accepts strict descendants', () => {
      expect(pathContainsOrEquals('/a/b', '/a/b/c')).toBe(true);
      expect(pathContainsOrEquals('/a/b', '/a/b/c/d/e.ts')).toBe(true);
    });

    it('rejects prefix collisions', () => {
      expect(pathContainsOrEquals('/a/b', '/a/bc')).toBe(false);
      expect(pathContainsOrEquals('/foo', '/foobar')).toBe(false);
    });

    it('rejects ancestors and siblings', () => {
      expect(pathContainsOrEquals('/a/b', '/a')).toBe(false);
      expect(pathContainsOrEquals('/a/b', '/a/c')).toBe(false);
    });

    it('treats empty inputs as not contained', () => {
      expect(pathContainsOrEquals('', '/a')).toBe(false);
      expect(pathContainsOrEquals('/a', '')).toBe(false);
    });
  });

  describe('findServerStatusForFile', () => {
    const ready = (workspace: string, family = 'typescript'): LSPServerStatus => ({
      family,
      workspace,
      state: 'ready',
    });

    it('returns undefined when no status covers the file', () => {
      const statuses = new Map([['/proj::typescript', ready('/proj')]]);
      expect(findServerStatusForFile(statuses, '/elsewhere/foo.ts', 'typescript')).toBeUndefined();
    });

    it('picks the longest-matching workspace root', () => {
      // Monorepo with a repo-root server (legacy single workspace install) AND
      // a per-package server. A file inside the package must resolve to the
      // package-specific status, not the repo-root one.
      const repoRoot = ready('/repo');
      const pkgRoot = ready('/repo/packages/ui');
      const statuses = new Map([
        ['/repo::typescript', repoRoot],
        ['/repo/packages/ui::typescript', pkgRoot],
      ]);

      const got = findServerStatusForFile(
        statuses,
        '/repo/packages/ui/src/Button.tsx',
        'typescript'
      );
      expect(got).toBe(pkgRoot);
    });

    it('falls back to a covering workspace-root status', () => {
      const statuses = new Map([['/repo::typescript', ready('/repo')]]);
      const got = findServerStatusForFile(statuses, '/repo/src/index.ts', 'typescript');
      expect(got?.workspace).toBe('/repo');
    });

    it('ignores statuses for other families', () => {
      const statuses = new Map([
        ['/repo::go', ready('/repo', 'go')],
        ['/repo/pkg::typescript', ready('/repo/pkg')],
      ]);
      const got = findServerStatusForFile(statuses, '/repo/pkg/a.ts', 'go');
      // No Go status covers /repo/pkg/a.ts because Go status is rooted at /repo
      // and the file is at /repo/pkg/a.ts — so containment matches but family
      // discrimination must keep TS out and only the Go status remains.
      expect(got?.family).toBe('go');
      expect(got?.workspace).toBe('/repo');
    });

    it('does not confuse prefix-collision paths', () => {
      const statuses = new Map([['/repo/ba::typescript', ready('/repo/ba')]]);
      // /repo/bar/index.ts must NOT match /repo/ba
      const got = findServerStatusForFile(statuses, '/repo/bar/index.ts', 'typescript');
      expect(got).toBeUndefined();
    });

    it('returns undefined for empty file path', () => {
      const statuses = new Map([['/repo::typescript', ready('/repo')]]);
      expect(findServerStatusForFile(statuses, '', 'typescript')).toBeUndefined();
    });
  });
});

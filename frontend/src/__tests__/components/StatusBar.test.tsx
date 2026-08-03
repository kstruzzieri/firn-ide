import { act, render, screen } from '@testing-library/react';
import { StatusBar } from '../../components/StatusBar';
import { useConflictProjectionSync } from '../../hooks/useProblemsProjection';
import { useIDEStore } from '../../stores/ideStore';
import { useGitStore } from '../../stores/gitStore';
import { useLSPStore, type LSPDiagnostic } from '../../stores/lspStore';
import { git } from '../../../wailsjs/go/models';

const mockGitConflictState = jest.fn();

jest.mock('../../../wailsjs/go/main/App', () => ({
  GitConflictState: (...args: unknown[]) => mockGitConflictState(...args),
}));

jest.mock('../../../wailsjs/runtime', () => ({
  EventsOn: jest.fn(() => jest.fn()),
}));

/** The conflict-read effect lives at App level, always mounted; mirror that here. */
function StatusBarWithSync() {
  useConflictProjectionSync();
  return <StatusBar />;
}

function conflictRegion(index: number, hasBase = false) {
  return {
    index,
    startLine: index * 8 + 1,
    endLine: index * 8 + (hasBase ? 8 : 6),
    ours: ['ours'],
    base: hasBase ? ['base'] : [],
    theirs: ['theirs'],
    hasBase,
    oursLabel: 'HEAD',
    theirLabel: 'feature',
    baseEndsWithNewline: true,
    oursEndsWithNewline: true,
    theirsEndsWithNewline: true,
  };
}

function conflictState(path: string, regions: ReturnType<typeof conflictRegion>[]) {
  const stage = { hash: 'abc123', mode: '100644', size: 12 };
  return {
    stages: { path, base: stage, ours: stage, theirs: stage, binary: false },
    snapshot: {
      content: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\n',
      encoding: 'utf-8',
      lineEndings: 'lf',
      regions,
    },
    heads: {
      operation: 'merge',
      ours: { label: 'main', hash: 'abc123', subject: 'main change' },
      theirs: { label: 'feature', hash: 'def456', subject: 'feature change' },
    },
    sourceVersion: `version:${path}`,
  };
}

function setGitStatus(
  repoRoot: string,
  files: Array<{ path: string; index: string; worktree: string; unmerged: boolean }>
) {
  useGitStore.setState({
    root: repoRoot,
    epoch: 1,
    statusRevision: 1,
    status: new git.RepoStatus({
      isRepo: true,
      repoRoot,
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      files,
    }),
  });
}

function diagnostic(message: string, severity = 1): LSPDiagnostic {
  return {
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 7 } },
    severity,
    source: 'gopls',
    message,
  };
}

describe('StatusBar diagnostics summary', () => {
  beforeEach(() => {
    mockGitConflictState.mockReset();
    useIDEStore.setState(useIDEStore.getInitialState(), true);
    useGitStore.setState(useGitStore.getInitialState(), true);
    useLSPStore.setState(useLSPStore.getInitialState(), true);
  });

  afterEach(() => {
    act(() => {
      useIDEStore.setState(useIDEStore.getInitialState(), true);
      useGitStore.setState(useGitStore.getInitialState(), true);
      useLSPStore.setState(useLSPStore.getInitialState(), true);
    });
  });

  it('shows raw severity counts when no merge is active', () => {
    useLSPStore
      .getState()
      .setDiagnostics('file:///repo/a.go', [
        diagnostic('undefined: foo'),
        diagnostic('unused variable', 2),
        diagnostic('consider simplifying', 3),
      ]);

    render(<StatusBarWithSync />);

    expect(screen.getByText('1 error, 1 warning, 1 info')).toBeInTheDocument();
  });

  it('counts conflict regions as warnings and suppresses raw marker errors during a merge', async () => {
    mockGitConflictState.mockResolvedValue(
      conflictState('conflict.go', [
        conflictRegion(0),
        conflictRegion(1, true),
        conflictRegion(2),
        conflictRegion(3),
      ])
    );
    setGitStatus('/repo', [{ path: 'conflict.go', index: 'U', worktree: 'U', unmerged: true }]);
    useLSPStore
      .getState()
      .setDiagnostics('file:///repo/conflict.go', [
        diagnostic('expected declaration'),
        diagnostic('expected semicolon'),
      ]);
    useLSPStore.getState().setDiagnostics('file:///repo/other.go', [diagnostic('undefined: bar')]);

    render(<StatusBarWithSync />);

    // 1 raw error from the clean file plus 4 conflict regions as warnings; the
    // conflicted file's 2 raw errors are suppressed, matching the Problems tab.
    expect(await screen.findByText('1 error, 4 warnings')).toBeInTheDocument();
    expect(screen.queryByText(/2 errors/)).not.toBeInTheDocument();
  });

  it('drops the conflict warnings when accepted status marks the file clean', async () => {
    mockGitConflictState.mockResolvedValue(conflictState('app.py', [conflictRegion(0)]));
    setGitStatus('/repo', [{ path: 'app.py', index: 'U', worktree: 'U', unmerged: true }]);
    useLSPStore
      .getState()
      .setDiagnostics('file:///repo/app.py', [diagnostic('Unexpected indentation')]);

    render(<StatusBarWithSync />);
    expect(await screen.findByText('1 warning')).toBeInTheDocument();

    act(() => {
      const status = useGitStore.getState().status!;
      useGitStore.setState((state) => ({
        status: new git.RepoStatus({
          ...status,
          files: [{ path: 'app.py', index: 'M', worktree: '.', unmerged: false }],
        }),
        statusRevision: state.statusRevision + 1,
      }));
    });

    expect(screen.getByText('1 error')).toBeInTheDocument();
  });
});

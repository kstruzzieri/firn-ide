/**
 * Test: StatusBar Component
 *
 * Tests for the StatusBar component.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { useIDEStore } from '../stores/ideStore';
import { GitPull, GitPush } from '../../wailsjs/go/main/App';
import { StatusBar } from '../components/StatusBar';
import { useLSPStore } from '../stores/lspStore';
import { useGitStore } from '../stores/gitStore';
import type { git } from '../../wailsjs/go/models';

jest.mock('../../wailsjs/go/main/App', () => ({
  GitStatus: jest.fn(),
  GitStage: jest.fn(),
  GitUnstage: jest.fn(),
  GitCommit: jest.fn(),
  GitPull: jest.fn(),
  GitPush: jest.fn(),
  GitBranches: jest.fn(),
  GitCheckout: jest.fn(),
  GitCommitMessageAvailable: jest.fn(),
  GitGenerateCommitMessage: jest.fn(),
}));

const gitStatus = (over: Partial<git.RepoStatus> = {}) =>
  ({
    isRepo: true,
    repoRoot: '/repo',
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    files: [],
    ...over,
  }) as git.RepoStatus;

beforeEach(() => {
  useLSPStore.setState(useLSPStore.getInitialState());
  useGitStore.setState({ status: null });
});

describe('StatusBar git segment', () => {
  it('shows the branch name when the workspace is a repo', () => {
    render(<StatusBar />);

    act(() => {
      useGitStore.setState({ status: gitStatus({ branch: 'feature/git-integration' }) });
    });

    expect(screen.getByText('feature/git-integration')).toBeInTheDocument();
  });

  it('shows ahead/behind counts only when nonzero', () => {
    render(<StatusBar />);

    act(() => {
      useGitStore.setState({ status: gitStatus({ ahead: 2, behind: 1 }) });
    });

    expect(screen.getByText('↑2')).toBeInTheDocument();
    expect(screen.getByText('↓1')).toBeInTheDocument();
  });

  it('hides arrows for an in-sync branch', () => {
    render(<StatusBar />);

    act(() => {
      useGitStore.setState({ status: gitStatus() });
    });

    expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
    expect(screen.queryByText(/↓/)).not.toBeInTheDocument();
  });

  it('renders no git segment outside a repository', () => {
    render(<StatusBar />);

    act(() => {
      useGitStore.setState({ status: gitStatus({ isRepo: false, branch: '' }) });
    });

    expect(screen.queryByText('main')).not.toBeInTheDocument();
  });

  it('branch click reveals the git panel and requests branch popup focus', () => {
    render(<StatusBar />);
    act(() => {
      useGitStore.setState({ status: gitStatus() });
      useIDEStore.setState({ activeSidebarView: 'explorer' });
    });
    const before = useGitStore.getState().focusBranchRevision;

    fireEvent.click(screen.getByRole('button', { name: /branch: main/i }));

    expect(useIDEStore.getState().activeSidebarView).toBe('git');
    expect(useGitStore.getState().focusBranchRevision).toBe(before + 1);
  });

  it('ahead arrow pushes, behind arrow pulls', async () => {
    (GitPush as jest.Mock).mockResolvedValue('');
    (GitPull as jest.Mock).mockResolvedValue('');
    render(<StatusBar />);
    act(() => {
      useGitStore.setState({ root: '/repo', status: gitStatus({ ahead: 2, behind: 1 }) });
    });

    fireEvent.click(screen.getByRole('button', { name: /push 2/i }));
    await act(async () => {});
    expect(GitPush).toHaveBeenCalledWith('/repo');

    fireEvent.click(screen.getByRole('button', { name: /pull 1/i }));
    await act(async () => {});
    expect(GitPull).toHaveBeenCalledWith('/repo');
  });
});

describe('StatusBar Component', () => {
  it('should render without crashing', () => {
    render(<StatusBar />);
    expect(document.body).toBeInTheDocument();
  });

  it('should display "No issues" when there are no diagnostics', () => {
    render(<StatusBar />);
    expect(screen.getByText(/No issues/)).toBeInTheDocument();
  });

  it('should display error and warning counts from lspStore', () => {
    render(<StatusBar />);

    act(() => {
      useLSPStore.getState().setDiagnostics('file:///test.ts', [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 1,
          message: 'Type error',
        },
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
          severity: 2,
          message: 'Unused variable',
        },
      ]);
    });

    expect(screen.getByText(/1 error, 1 warning/)).toBeInTheDocument();
  });

  it('should display info diagnostics instead of reporting "No issues"', () => {
    render(<StatusBar />);

    act(() => {
      useLSPStore.getState().setDiagnostics('file:///test.ts', [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 3,
          message: 'Info diagnostic',
        },
      ]);
    });

    expect(screen.getByText(/1 info/)).toBeInTheDocument();
    expect(screen.queryByText(/No issues/)).not.toBeInTheDocument();
  });

  it('should clear counts when diagnostics are removed', () => {
    render(<StatusBar />);

    act(() => {
      useLSPStore.getState().setDiagnostics('file:///test.ts', [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 1,
          message: 'Type error',
        },
      ]);
    });

    expect(screen.getByText(/1 error/)).toBeInTheDocument();

    act(() => {
      useLSPStore.getState().clearAllDiagnostics();
    });

    expect(screen.getByText(/No issues/)).toBeInTheDocument();
  });
});

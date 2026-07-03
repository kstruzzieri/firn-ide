jest.mock('../../../../wailsjs/go/main/App', () => ({
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
  GitFileAtRev: jest.fn(),
  ReadFile: jest.fn(),
}));

import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { GitPanel } from '../../../components/GitPanel';
import { useGitStore } from '../../../stores/gitStore';
import { useIDEStore } from '../../../stores/ideStore';
import {
  GitStatus,
  GitStage,
  GitUnstage,
  GitCommit,
  GitPull,
  GitPush,
  GitCheckout,
  GitGenerateCommitMessage,
  GitFileAtRev,
  ReadFile,
} from '../../../../wailsjs/go/main/App';
import type { git, workspace } from '../../../../wailsjs/go/models';

const mockGitStatus = GitStatus as jest.MockedFunction<typeof GitStatus>;
const mockGenerate = GitGenerateCommitMessage as jest.MockedFunction<
  typeof GitGenerateCommitMessage
>;

const file = (path: string, index: string, worktree: string, unmerged = false) => ({
  path,
  index,
  worktree,
  unmerged,
});

const repoStatus = (files: ReturnType<typeof file>[], over: Record<string, unknown> = {}) =>
  ({
    isRepo: true,
    repoRoot: '/repo',
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    files,
    ...over,
  }) as unknown as git.RepoStatus;

function seed(files: ReturnType<typeof file>[], over: Record<string, unknown> = {}) {
  act(() => {
    useGitStore.getState().resetForWorkspace('/repo');
    useGitStore.setState({ status: repoStatus(files, over), branches: ['main', 'feature/x'] });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGitStatus.mockResolvedValue(repoStatus([]));
  act(() => {
    useIDEStore.setState({
      workspace: { name: 'repo', path: '/repo' },
      workspaces: [] as workspace.WorkspaceDef[],
      runProfiles: [],
    });
  });
});

describe('GitPanel empty states', () => {
  it('shows a message when the workspace is not a repository', () => {
    act(() => {
      useGitStore.getState().resetForWorkspace('/repo');
      useGitStore.setState({ status: repoStatus([], { isRepo: false, branch: '' }) });
    });

    render(<GitPanel />);

    expect(screen.getByText(/not a git repository/i)).toBeInTheDocument();
  });
});

describe('GitPanel sections', () => {
  it('buckets files into Conflicts, Staged, Changes, and Untracked', () => {
    seed([
      file('conflict.go', 'U', 'U', true),
      file('staged.ts', 'M', '.'),
      file('changed.ts', '.', 'M'),
      file('new.md', '?', '?'),
    ]);

    render(<GitPanel />);

    expect(within(screen.getByTestId('section-conflicts')).getByText('conflict.go')).toBeVisible();
    expect(within(screen.getByTestId('section-staged')).getByText('staged.ts')).toBeVisible();
    expect(within(screen.getByTestId('section-changes')).getByText('changed.ts')).toBeVisible();
    expect(within(screen.getByTestId('section-untracked')).getByText('new.md')).toBeVisible();
  });

  it('shows a partially staged file in both Staged and Changes', () => {
    seed([file('both.ts', 'M', 'M')]);

    render(<GitPanel />);

    expect(within(screen.getByTestId('section-staged')).getByText('both.ts')).toBeVisible();
    expect(within(screen.getByTestId('section-changes')).getByText('both.ts')).toBeVisible();
  });

  it('shows the repo-relative directory path beside a nested filename', () => {
    seed([file('internal/git/service.go', '.', 'M')]);

    render(<GitPanel />);

    const row = screen.getByText('service.go').closest('li');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('internal/git')).toBeInTheDocument();
  });

  it('shows the repo folder name as the location for a repo-root file', () => {
    // seed() uses repoRoot '/repo', so root files locate to 'repo'.
    seed([file('app.go', '.', 'M')]);

    render(<GitPanel />);

    const row = screen.getByText('app.go').closest('li');
    expect(within(row!).getByTestId('row-dir')).toHaveTextContent('repo');
  });

  it('stages a file from its row action', async () => {
    (GitStage as jest.Mock).mockResolvedValue(undefined);
    seed([file('changed.ts', '.', 'M')]);

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /stage changed\.ts/i }));
    await act(async () => {});

    expect(GitStage).toHaveBeenCalledWith('/repo', ['changed.ts']);
  });

  it('unstages a file from its row action', async () => {
    (GitUnstage as jest.Mock).mockResolvedValue(undefined);
    seed([file('staged.ts', 'M', '.')]);

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /unstage staged\.ts/i }));
    await act(async () => {});

    expect(GitUnstage).toHaveBeenCalledWith('/repo', ['staged.ts']);
  });

  it('stages all unstaged and untracked files from the section bulk action', async () => {
    (GitStage as jest.Mock).mockResolvedValue(undefined);
    seed([file('a.ts', '.', 'M'), file('b.md', '?', '?')]);

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /stage all/i }));
    await act(async () => {});

    expect(GitStage).toHaveBeenCalledWith('/repo', ['a.ts']);
  });
});

describe('GitPanel diff open', () => {
  beforeEach(() => {
    (GitFileAtRev as jest.Mock).mockResolvedValue({
      content: 'x',
      binary: false,
      truncated: false,
    });
    (ReadFile as jest.Mock).mockResolvedValue({ content: 'y' });
  });

  it('clicking a staged row opens a HEAD-vs-index diff', async () => {
    seed([file('staged.ts', 'M', '.')]);

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^staged\.ts/i }));
    await act(async () => {});

    expect(GitFileAtRev).toHaveBeenCalledWith('/repo', 'HEAD', 'staged.ts');
    expect(GitFileAtRev).toHaveBeenCalledWith('/repo', ':0', 'staged.ts');
    expect(useGitStore.getState().diffSession?.context).toBe('staged');
  });

  it('clicking an unstaged row opens an index-vs-worktree diff', async () => {
    seed([file('changed.ts', '.', 'M')]);

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^changed\.ts/i }));
    await act(async () => {});

    expect(GitFileAtRev).toHaveBeenCalledWith('/repo', ':0', 'changed.ts');
    expect(ReadFile).toHaveBeenCalledWith('/repo/changed.ts');
    expect(useGitStore.getState().diffSession?.context).toBe('unstaged');
  });

  it('clicking a conflict row opens the file itself, not a diff', async () => {
    (ReadFile as jest.Mock).mockResolvedValue({ content: 'conflict body' });
    seed([file('clash.go', 'U', 'U', true)]);

    render(<GitPanel />);
    fireEvent.click(
      within(screen.getByTestId('section-conflicts')).getByRole('button', { name: /^clash\.go/i })
    );
    await act(async () => {});

    expect(useGitStore.getState().diffSession).toBeNull();
    expect(GitFileAtRev).not.toHaveBeenCalled();
  });
});

describe('GitPanel workspace scoping', () => {
  beforeEach(() => {
    act(() => {
      useIDEStore.setState({ workspace: { name: 'frontend', path: '/repo/frontend' } });
    });
  });

  it('defaults to workspace view, hiding files outside the workspace', () => {
    seed([file('frontend/app.ts', '.', 'M'), file('backend/main.go', '.', 'M')]);

    render(<GitPanel />);

    expect(screen.getByText('app.ts')).toBeInTheDocument();
    expect(screen.queryByText('main.go')).not.toBeInTheDocument();
  });

  it('project view shows all repository changes', () => {
    seed([file('frontend/app.ts', '.', 'M'), file('backend/main.go', '.', 'M')]);

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /project/i }));

    expect(screen.getByText('app.ts')).toBeInTheDocument();
    expect(screen.getByText('main.go')).toBeInTheDocument();
  });
});

describe('GitPanel commit area', () => {
  it('disables commit until a message and staged changes exist', () => {
    seed([file('changed.ts', '.', 'M')]);

    render(<GitPanel />);
    const commit = screen.getByRole('button', { name: /^commit$/i });
    expect(commit).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: /commit message/i }), {
      target: { value: 'feat: x' },
    });
    expect(commit).toBeDisabled(); // message but nothing staged
  });

  it('enables commit with a message and staged changes', () => {
    seed([file('staged.ts', 'M', '.')]);

    render(<GitPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: /commit message/i }), {
      target: { value: 'feat: x' },
    });

    expect(screen.getByRole('button', { name: /^commit$/i })).toBeEnabled();
  });

  it('amend enables commit without staged changes', () => {
    seed([]);

    render(<GitPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: /commit message/i }), {
      target: { value: 'fixup subject' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /amend/i }));

    expect(screen.getByRole('button', { name: /^commit$/i })).toBeEnabled();
  });

  it('commits with the drafted message and amend flag', async () => {
    (GitCommit as jest.Mock).mockResolvedValue('[main abc1234] feat: x');
    seed([file('staged.ts', 'M', '.')]);

    render(<GitPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: /commit message/i }), {
      target: { value: 'feat: x' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^commit$/i }));
    await act(async () => {});

    expect(GitCommit).toHaveBeenCalledWith('/repo', 'feat: x', false);
  });

  it('shows a commit receipt after a successful commit', () => {
    seed([]);
    act(() => {
      useGitStore.setState({
        lastCommitReceipt: {
          branch: 'main',
          hash: '1a2b3c4',
          subject: 'feat: add thing',
          files: ['a.ts'],
          output: '1 file changed',
        },
      });
    });

    render(<GitPanel />);

    const receipt = screen.getByTestId('commit-receipt');
    expect(within(receipt).getByText(/1a2b3c4/)).toBeInTheDocument();
    expect(within(receipt).getByText(/feat: add thing/)).toBeInTheDocument();
  });

  it('warns when staged files span multiple workspaces', () => {
    act(() => {
      useIDEStore.setState({
        workspaces: [
          { id: 'ws-frontend', name: 'Frontend', relDir: 'frontend', type: 'node', accent: 'blue' },
          { id: 'ws-go', name: 'Go', relDir: 'backend', type: 'go', accent: 'green' },
        ] as unknown as workspace.WorkspaceDef[],
      });
    });
    seed([file('frontend/a.ts', 'M', '.'), file('backend/b.go', 'M', '.')]);

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /project/i }));

    expect(screen.getByText(/spans frontend \+ go/i)).toBeInTheDocument();
  });
});

describe('GitPanel AI message generation', () => {
  it('hides the generate button when golem is unavailable', () => {
    seed([file('staged.ts', 'M', '.')]);

    render(<GitPanel />);

    expect(screen.queryByRole('button', { name: /generate message/i })).not.toBeInTheDocument();
  });

  it('fills an empty draft directly from the generator', async () => {
    mockGenerate.mockResolvedValue('feat: generated');
    seed([file('staged.ts', 'M', '.')]);
    act(() => {
      useGitStore.setState({ aiAvailable: true });
    });

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /generate message/i }));
    await act(async () => {});

    expect(screen.getByRole('textbox', { name: /commit message/i })).toHaveValue('feat: generated');
  });

  it('offers a non-destructive suggestion when a draft exists', async () => {
    mockGenerate.mockResolvedValue('feat: generated');
    seed([file('staged.ts', 'M', '.')]);
    act(() => {
      useGitStore.setState({ aiAvailable: true });
    });

    render(<GitPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: /commit message/i }), {
      target: { value: 'my careful draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate message/i }));
    await act(async () => {});

    // Draft untouched; suggestion shown with explicit accept/dismiss.
    expect(screen.getByRole('textbox', { name: /commit message/i })).toHaveValue(
      'my careful draft'
    );
    const suggestion = screen.getByTestId('ai-suggestion');
    expect(within(suggestion).getByText('feat: generated')).toBeInTheDocument();

    fireEvent.click(within(suggestion).getByRole('button', { name: /use/i }));
    expect(screen.getByRole('textbox', { name: /commit message/i })).toHaveValue('feat: generated');
  });
});

describe('GitPanel conflicts and errors', () => {
  it('renders a conflict playbook naming files with open actions', () => {
    seed([file('clash.go', 'U', 'U', true)]);
    act(() => {
      useGitStore.setState({
        lastError: 'git pull: CONFLICT (content): Merge conflict in clash.go',
      });
    });

    render(<GitPanel />);

    const banner = screen.getByTestId('conflict-banner');
    expect(within(banner).getByText(/resolve conflicts on main/i)).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: /open clash\.go/i })).toBeInTheDocument();
  });

  it('shows operation errors inline', () => {
    seed([]);
    act(() => {
      useGitStore.setState({ lastError: 'hook rejected: lint failed' });
    });

    render(<GitPanel />);

    expect(screen.getByTestId('git-error')).toHaveTextContent('hook rejected: lint failed');
  });
});

describe('GitPanel branch and sync controls', () => {
  it('pull and push buttons run the operations', async () => {
    (GitPull as jest.Mock).mockResolvedValue('ok');
    (GitPush as jest.Mock).mockResolvedValue('ok');
    seed([], { ahead: 1, behind: 2 });

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /pull/i }));
    fireEvent.click(screen.getByRole('button', { name: /push/i }));
    await act(async () => {});

    expect(GitPull).toHaveBeenCalledWith('/repo');
    // push is single-flight-blocked while pull is in flight OR queued after;
    // both operations must eventually have been attempted once each.
    expect(GitPull).toHaveBeenCalledTimes(1);
  });

  it('opens the branch popup, filters, and checks out a branch', async () => {
    (GitCheckout as jest.Mock).mockResolvedValue(undefined);
    seed([]);

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /branch: main/i }));
    const popup = screen.getByRole('listbox');
    fireEvent.change(screen.getByPlaceholderText(/find or create branch/i), {
      target: { value: 'feature' },
    });
    fireEvent.click(within(popup).getByRole('option', { name: 'feature/x' }));
    await act(async () => {});

    expect(GitCheckout).toHaveBeenCalledWith('/repo', 'feature/x', false);
  });

  it('creates a new branch from the popup query', async () => {
    (GitCheckout as jest.Mock).mockResolvedValue(undefined);
    seed([]);

    render(<GitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /branch: main/i }));
    fireEvent.change(screen.getByPlaceholderText(/find or create branch/i), {
      target: { value: 'feature/brand-new' },
    });
    fireEvent.click(screen.getByRole('option', { name: /create branch feature\/brand-new/i }));
    await act(async () => {});

    expect(GitCheckout).toHaveBeenCalledWith('/repo', 'feature/brand-new', true);
  });

  it('does not auto-open the panel branch popup on a focus request', () => {
    // The always-visible header switcher owns the status-bar handoff, so the
    // panel copy stays closed to avoid two popups opening at once.
    seed([]);

    render(<GitPanel />);
    act(() => {
      useGitStore.getState().requestBranchPopupFocus();
    });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

jest.mock('../../../wailsjs/go/main/App', () => ({
  GitStatus: jest.fn(),
  GitBranches: jest.fn(),
  GitCheckout: jest.fn(),
  GitStage: jest.fn(),
  GitUnstage: jest.fn(),
  GitCommit: jest.fn(),
  GitPull: jest.fn(),
  GitPush: jest.fn(),
  GitCommitMessageAvailable: jest.fn(),
  GitGenerateCommitMessage: jest.fn(),
  GitFileAtRev: jest.fn(),
  ReadFile: jest.fn(),
}));

import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { GitCheckout, GitBranches } from '../../../wailsjs/go/main/App';
import { BranchSwitcher } from './BranchSwitcher';
import { useGitStore } from '../../stores/gitStore';
import type { git } from '../../../wailsjs/go/models';

const mockCheckout = GitCheckout as jest.MockedFunction<typeof GitCheckout>;

function seed(isRepo: boolean, branch = 'main', branches = ['main', 'feature/x']) {
  act(() => {
    useGitStore.getState().resetForWorkspace('/repo');
    useGitStore.setState({
      status: {
        isRepo,
        repoRoot: '/repo',
        branch,
        upstream: '',
        ahead: 0,
        behind: 0,
        files: [],
      } as unknown as git.RepoStatus,
      branches,
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckout.mockResolvedValue(undefined);
  (GitBranches as jest.Mock).mockResolvedValue(['main', 'feature/x']);
});

describe('BranchSwitcher', () => {
  it('renders nothing outside a git repository', () => {
    seed(false);
    const { container } = render(<BranchSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the current branch name', () => {
    seed(true, 'feature/git-integration');
    render(<BranchSwitcher />);
    expect(screen.getByRole('button', { name: /feature\/git-integration/i })).toBeInTheDocument();
  });

  it('opens a searchable popup and checks out a branch', async () => {
    seed(true);
    render(<BranchSwitcher />);

    fireEvent.click(screen.getByRole('button', { name: /branch: main/i }));
    const popup = screen.getByRole('listbox');
    fireEvent.change(screen.getByPlaceholderText(/find or create branch/i), {
      target: { value: 'feature' },
    });
    fireEvent.click(within(popup).getByRole('option', { name: 'feature/x' }));
    await act(async () => {});

    expect(GitCheckout).toHaveBeenCalledWith('/repo', 'feature/x', false);
  });

  it('creates a branch from a novel query', async () => {
    seed(true);
    render(<BranchSwitcher />);

    fireEvent.click(screen.getByRole('button', { name: /branch: main/i }));
    fireEvent.change(screen.getByPlaceholderText(/find or create branch/i), {
      target: { value: 'feature/brand-new' },
    });
    fireEvent.click(screen.getByRole('option', { name: /create branch feature\/brand-new/i }));
    await act(async () => {});

    expect(GitCheckout).toHaveBeenCalledWith('/repo', 'feature/brand-new', true);
  });

  it('opens when focusBranchRevision bumps (status bar / shortcut handoff)', () => {
    seed(true);
    render(<BranchSwitcher />);

    act(() => {
      useGitStore.getState().requestBranchPopupFocus();
    });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

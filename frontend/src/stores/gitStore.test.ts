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
  GitFileAtRev: jest.fn(),
  ReadFile: jest.fn(),
}));

import {
  GitStatus,
  GitStage,
  GitCommit,
  GitPull,
  GitBranches,
  GitCheckout,
  GitCommitMessageAvailable,
  GitGenerateCommitMessage,
  GitFileAtRev,
  ReadFile,
} from '../../wailsjs/go/main/App';
import { useGitStore, GIT_REFRESH_DEBOUNCE_MS } from './gitStore';
import { useIDEStore } from './ideStore';

const mockGitStatus = GitStatus as jest.MockedFunction<typeof GitStatus>;
const mockGitStage = GitStage as jest.MockedFunction<typeof GitStage>;
const mockGitCommit = GitCommit as jest.MockedFunction<typeof GitCommit>;
const mockGitPull = GitPull as jest.MockedFunction<typeof GitPull>;
const mockGitBranches = GitBranches as jest.MockedFunction<typeof GitBranches>;
const mockGitCheckout = GitCheckout as jest.MockedFunction<typeof GitCheckout>;
const mockAvailable = GitCommitMessageAvailable as jest.MockedFunction<
  typeof GitCommitMessageAvailable
>;
const mockGenerate = GitGenerateCommitMessage as jest.MockedFunction<
  typeof GitGenerateCommitMessage
>;

const repoStatus = (over: Record<string, unknown> = {}) =>
  ({
    isRepo: true,
    repoRoot: '/repo',
    branch: 'main',
    upstream: 'origin/main',
    ahead: 1,
    behind: 2,
    files: [
      { path: 'a.ts', index: 'M', worktree: '.' },
      { path: 'b.ts', index: '.', worktree: 'M' },
    ],
    ...over,
  }) as Awaited<ReturnType<typeof GitStatus>>;

function resetStores() {
  useGitStore.getState().resetForWorkspace('/repo');
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
});

describe('gitStore refresh', () => {
  it('populates status and the absolute statusByPath map', async () => {
    mockGitStatus.mockResolvedValue(repoStatus());

    await useGitStore.getState().refresh();

    const s = useGitStore.getState();
    expect(s.status?.branch).toBe('main');
    expect(s.statusByPath['/repo/a.ts']).toBe('modified');
    expect(s.isRefreshing).toBe(false);
  });

  it('clears state for a non-repo workspace', async () => {
    mockGitStatus.mockResolvedValue(repoStatus({ isRepo: false, branch: '', files: [] }));

    await useGitStore.getState().refresh();

    const s = useGitStore.getState();
    expect(s.status?.isRepo).toBe(false);
    expect(s.statusByPath).toEqual({});
  });

  it('drops a stale refresh that resolves after a workspace switch', async () => {
    let resolveA!: (v: Awaited<ReturnType<typeof GitStatus>>) => void;
    mockGitStatus.mockReturnValueOnce(
      new Promise((res) => {
        resolveA = res;
      })
    );
    const inFlight = useGitStore.getState().refresh();

    useGitStore.getState().resetForWorkspace('/other');
    resolveA(repoStatus({ branch: 'stale-branch' }));
    await inFlight;

    expect(useGitStore.getState().status?.branch).not.toBe('stale-branch');
  });

  it('surfaces refresh failure as a toast and stops the spinner', async () => {
    mockGitStatus.mockRejectedValue(new Error('boom'));

    await useGitStore.getState().refresh();

    expect(useGitStore.getState().isRefreshing).toBe(false);
    expect(useIDEStore.getState().toast?.type).toBe('error');
  });

  it('debounces scheduleRefresh into a single call', async () => {
    jest.useFakeTimers();
    mockGitStatus.mockResolvedValue(repoStatus());

    const s = useGitStore.getState();
    s.scheduleRefresh();
    s.scheduleRefresh();
    s.scheduleRefresh();
    jest.advanceTimersByTime(GIT_REFRESH_DEBOUNCE_MS + 10);
    await Promise.resolve();

    expect(mockGitStatus).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe('gitStore operations', () => {
  beforeEach(() => {
    mockGitStatus.mockResolvedValue(repoStatus());
  });

  it('stage calls the binding with the workspace root and refreshes', async () => {
    mockGitStage.mockResolvedValue(undefined);

    await useGitStore.getState().stage(['a.ts']);

    expect(mockGitStage).toHaveBeenCalledWith('/repo', ['a.ts']);
    expect(mockGitStatus).toHaveBeenCalled();
  });

  it('commit clears the message on success', async () => {
    mockGitCommit.mockResolvedValue('[main abc] subject');
    useGitStore.getState().setCommitMessage('feat: thing');

    await useGitStore.getState().commit(false);

    expect(mockGitCommit).toHaveBeenCalledWith('/repo', 'feat: thing', false);
    expect(useGitStore.getState().commitMessage).toBe('');
  });

  it('commit success records a receipt with hash, subject, and staged files', async () => {
    mockGitStatus.mockResolvedValue(
      repoStatus({
        files: [
          { path: 'a.ts', index: 'M', worktree: '.' },
          { path: 'b.ts', index: '.', worktree: 'M' },
        ],
      })
    );
    await useGitStore.getState().refresh();
    mockGitCommit.mockResolvedValue(
      '[main 1a2b3c4] feat: add thing\n 1 file changed, 2 insertions(+)'
    );
    useGitStore.getState().setCommitMessage('feat: add thing');

    await useGitStore.getState().commit(false);

    const receipt = useGitStore.getState().lastCommitReceipt;
    expect(receipt?.hash).toBe('1a2b3c4');
    expect(receipt?.branch).toBe('main');
    expect(receipt?.subject).toBe('feat: add thing');
    expect(receipt?.files).toEqual(['a.ts']); // only staged files, not b.ts
    expect(receipt?.output).toContain('1 file changed');
  });

  it('commit failure leaves no receipt', async () => {
    mockGitCommit.mockRejectedValue(new Error('hook rejected'));
    useGitStore.getState().setCommitMessage('x');

    await useGitStore.getState().commit(false);

    expect(useGitStore.getState().lastCommitReceipt).toBeNull();
  });

  it('commit failure keeps the message and toasts the git error', async () => {
    mockGitCommit.mockRejectedValue(new Error('git commit: nothing staged'));
    useGitStore.getState().setCommitMessage('feat: thing');

    await useGitStore.getState().commit(false);

    expect(useGitStore.getState().commitMessage).toBe('feat: thing');
    expect(useGitStore.getState().lastError).toContain('nothing staged');
  });

  it('pull records op-in-flight state and output', async () => {
    let resolvePull!: (v: string) => void;
    mockGitPull.mockReturnValue(
      new Promise((res) => {
        resolvePull = res;
      })
    );

    const p = useGitStore.getState().pull();
    expect(useGitStore.getState().opInFlight).toBe('pull');

    resolvePull('Already up to date.');
    await p;
    expect(useGitStore.getState().opInFlight).toBeNull();
    expect(useGitStore.getState().lastOpOutput).toContain('up to date');
  });

  it('pull conflict error lands in lastError for the panel', async () => {
    mockGitPull.mockRejectedValue(new Error('git pull: CONFLICT (content): a.ts'));

    await useGitStore.getState().pull();

    expect(useGitStore.getState().lastError).toContain('CONFLICT');
    expect(useGitStore.getState().opInFlight).toBeNull();
  });

  it('checkout refreshes branches and status', async () => {
    mockGitCheckout.mockResolvedValue(undefined);
    mockGitBranches.mockResolvedValue(['main', 'feature/x']);

    await useGitStore.getState().checkout('feature/x', false);

    expect(mockGitCheckout).toHaveBeenCalledWith('/repo', 'feature/x', false);
    expect(useGitStore.getState().branches).toEqual(['main', 'feature/x']);
  });

  it('generateMessage fills commitMessage when golem responds', async () => {
    mockGenerate.mockResolvedValue('feat: generated subject');

    await useGitStore.getState().generateMessage();

    expect(useGitStore.getState().commitMessage).toBe('feat: generated subject');
  });

  it('probeAiAvailable stores availability', async () => {
    mockAvailable.mockResolvedValue(true);

    await useGitStore.getState().probeAiAvailable();

    expect(useGitStore.getState().aiAvailable).toBe(true);
  });
});

describe('gitStore diff sessions', () => {
  const mockFileAtRev = GitFileAtRev as jest.MockedFunction<typeof GitFileAtRev>;
  const mockReadFile = ReadFile as jest.MockedFunction<typeof ReadFile>;
  const rev = (content: string, flags: Partial<{ binary: boolean; truncated: boolean }> = {}) =>
    ({ content, binary: false, truncated: false, ...flags }) as Awaited<
      ReturnType<typeof GitFileAtRev>
    >;

  beforeEach(() => {
    mockGitStatus.mockResolvedValue(repoStatus());
    mockFileAtRev.mockResolvedValue(rev(''));
    mockReadFile.mockResolvedValue({
      content: 'worktree text',
    } as Awaited<ReturnType<typeof ReadFile>>);
  });

  it('staged context diffs HEAD against the index', async () => {
    mockFileAtRev.mockResolvedValueOnce(rev('head text')).mockResolvedValueOnce(rev('index text'));

    await useGitStore
      .getState()
      .openDiff({ path: 'src/a.ts', index: 'M', worktree: '.' }, 'staged');

    expect(mockFileAtRev).toHaveBeenNthCalledWith(1, '/repo', 'HEAD', 'src/a.ts');
    expect(mockFileAtRev).toHaveBeenNthCalledWith(2, '/repo', ':0', 'src/a.ts');
    const session = useGitStore.getState().diffSession;
    expect(session?.left).toEqual({ label: 'HEAD', content: 'head text' });
    expect(session?.right).toEqual({ label: 'Index', content: 'index text' });
    expect(session?.path).toBe('src/a.ts');
    expect(useGitStore.getState().diffFocused).toBe(true);
  });

  it('unstaged context diffs the index against the working tree', async () => {
    mockFileAtRev.mockResolvedValueOnce(rev('index text'));

    await useGitStore
      .getState()
      .openDiff({ path: 'src/a.ts', index: '.', worktree: 'M' }, 'unstaged');

    expect(mockFileAtRev).toHaveBeenCalledWith('/repo', ':0', 'src/a.ts');
    expect(mockReadFile).toHaveBeenCalledWith('/repo/src/a.ts');
    const session = useGitStore.getState().diffSession;
    expect(session?.right).toEqual({ label: 'Working Tree', content: 'worktree text' });
  });

  it('untracked files diff against empty content without a rev fetch', async () => {
    await useGitStore
      .getState()
      .openDiff({ path: 'new.md', index: '?', worktree: '?' }, 'unstaged');

    expect(mockFileAtRev).not.toHaveBeenCalled();
    const session = useGitStore.getState().diffSession;
    expect(session?.left).toEqual({ label: 'Index', content: '' });
  });

  it('flags binary sessions instead of shipping content', async () => {
    mockFileAtRev.mockResolvedValue(rev('', { binary: true }));

    await useGitStore.getState().openDiff({ path: 'img.png', index: 'M', worktree: '.' }, 'staged');

    expect(useGitStore.getState().diffSession?.binary).toBe(true);
  });

  it('a worktree read failure means a deleted file and diffs against empty', async () => {
    mockFileAtRev.mockResolvedValueOnce(rev('index text'));
    mockReadFile.mockRejectedValue(new Error('no such file'));

    await useGitStore
      .getState()
      .openDiff({ path: 'gone.ts', index: '.', worktree: 'D' }, 'unstaged');

    expect(useGitStore.getState().diffSession?.right).toEqual({
      label: 'Working Tree',
      content: '',
    });
  });

  it('closeDiff clears the session and focus', async () => {
    await useGitStore
      .getState()
      .openDiff({ path: 'src/a.ts', index: 'M', worktree: '.' }, 'staged');

    useGitStore.getState().closeDiff();

    expect(useGitStore.getState().diffSession).toBeNull();
    expect(useGitStore.getState().diffFocused).toBe(false);
  });

  it('resetForWorkspace drops any open diff session', async () => {
    await useGitStore
      .getState()
      .openDiff({ path: 'src/a.ts', index: 'M', worktree: '.' }, 'staged');

    useGitStore.getState().resetForWorkspace('/other');

    expect(useGitStore.getState().diffSession).toBeNull();
  });
});

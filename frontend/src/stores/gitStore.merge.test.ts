jest.mock('../../wailsjs/go/main/App', () => ({
  GitStatus: jest.fn(),
  GitStage: jest.fn(),
  GitUnstage: jest.fn(),
  GitIntentToAdd: jest.fn(),
  GitCommit: jest.fn(),
  GitPull: jest.fn(),
  GitPush: jest.fn(),
  GitBranches: jest.fn(),
  GitCheckout: jest.fn(),
  GitCommitMessageAvailable: jest.fn(),
  GitGenerateCommitMessage: jest.fn(),
  GitFileAtRev: jest.fn(),
  GitFileHunks: jest.fn(),
  GitApplyHunk: jest.fn(),
  ReadFile: jest.fn(),
  WriteFile: jest.fn(),
  GitConflictStages: jest.fn(),
  GitMergeHeads: jest.fn(),
  GitConflictSnapshot: jest.fn(),
  GitResolveConflictSide: jest.fn(),
}));

import {
  GitStatus,
  WriteFile,
  GitConflictStages,
  GitMergeHeads,
  GitConflictSnapshot,
} from '../../wailsjs/go/main/App';
import type { git } from '../../wailsjs/go/models';
import { useGitStore } from './gitStore';
import { useIDEStore, type EditorFile } from './ideStore';

const mockStages = GitConflictStages as jest.MockedFunction<typeof GitConflictStages>;
const mockHeads = GitMergeHeads as jest.MockedFunction<typeof GitMergeHeads>;
const mockSnapshot = GitConflictSnapshot as jest.MockedFunction<typeof GitConflictSnapshot>;
const mockWriteFile = WriteFile as jest.MockedFunction<typeof WriteFile>;
const mockGitStatus = GitStatus as jest.MockedFunction<typeof GitStatus>;

const repoStatus = (over: Record<string, unknown> = {}) =>
  ({
    isRepo: true,
    repoRoot: '/repo',
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    files: [{ path: 'file.txt', index: 'U', worktree: 'U', unmerged: true }],
    ...over,
  }) as git.RepoStatus;

const blob = (): git.StageBlob => ({ hash: 'abc123', size: 10 }) as git.StageBlob;

const allStages = (over: Partial<git.ConflictStages> = {}): git.ConflictStages =>
  ({
    path: 'file.txt',
    base: blob(),
    ours: blob(),
    theirs: blob(),
    binary: false,
    ...over,
  }) as git.ConflictStages;

const heads = (): git.MergeHeads =>
  ({
    operation: 'merge',
    ours: { label: 'main', hash: 'abc123', subject: 'ours subject' },
    theirs: { label: 'feature', hash: 'def456', subject: 'theirs subject' },
  }) as git.MergeHeads;

const region = (): git.ConflictRegion =>
  ({
    index: 0,
    startLine: 1,
    endLine: 5,
    ours: ['ours line'],
    base: [],
    theirs: ['theirs line'],
    hasBase: false,
    oursLabel: 'HEAD',
    theirLabel: 'feature',
  }) as git.ConflictRegion;

const snapshot = (over: Partial<git.ConflictSnapshot> = {}): git.ConflictSnapshot =>
  ({
    content: '<<<<<<< HEAD\nours line\n=======\ntheirs line\n>>>>>>> feature\n',
    encoding: 'utf-8',
    lineEndings: 'lf',
    regions: [region()],
    ...over,
  }) as git.ConflictSnapshot;

const openFile = (over: Partial<EditorFile> = {}): EditorFile => ({
  id: 'f1',
  name: 'file.txt',
  path: '/repo/file.txt',
  language: 'plaintext',
  encoding: 'utf-8',
  lineEndings: 'lf',
  content: 'buffer content',
  isModified: false,
  ...over,
});

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  useGitStore.getState().resetForWorkspace('/repo');
  useGitStore.setState({ status: repoStatus() });
  useIDEStore.setState({ openFiles: [], toast: null });
  mockGitStatus.mockResolvedValue(repoStatus());
  mockWriteFile.mockResolvedValue(undefined as never);
});

describe('openMergeResolution', () => {
  it('builds a text session from stages, heads, and one snapshot read', async () => {
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot());

    const ok = await useGitStore
      .getState()
      .openMergeResolution('file.txt', ['file.txt', 'other.txt']);

    expect(ok).toBe(true);
    const session = useGitStore.getState().mergeSession;
    expect(session).not.toBeNull();
    if (session?.kind !== 'text') throw new Error('expected text session');
    expect(session.path).toBe('file.txt');
    expect(session.absPath).toBe('/repo/file.txt');
    expect(session.repoRoot).toBe('/repo');
    expect(session.labels.ours.label).toBe('main');
    expect(session.labels.theirs.label).toBe('feature');
    expect(session.fileQueue).toEqual(['file.txt', 'other.txt']);
    expect(session.content).toBe(snapshot().content);
    expect(session.encoding).toBe('utf-8');
    expect(session.lineEndings).toBe('lf');
    expect(session.regions).toHaveLength(1);
    expect(session.decisions).toEqual({});
    expect(session.readOnly).toBe(false);
    expect(mockSnapshot).toHaveBeenCalledTimes(1);
    expect(mockSnapshot).toHaveBeenCalledWith('/repo', 'file.txt');
  });

  it('builds a sides session for a binary conflict without reading a snapshot', async () => {
    mockStages.mockResolvedValue(allStages({ binary: true }));
    mockHeads.mockResolvedValue(heads());

    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    expect(ok).toBe(true);
    const session = useGitStore.getState().mergeSession;
    if (session?.kind !== 'sides') throw new Error('expected sides session');
    expect(session.stages.binary).toBe(true);
    expect(session.selectedSide).toBeUndefined();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('builds a sides session when ours is absent (delete/modify)', async () => {
    mockStages.mockResolvedValue(allStages({ ours: undefined }));
    mockHeads.mockResolvedValue(heads());

    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    expect(ok).toBe(true);
    const session = useGitStore.getState().mergeSession;
    if (session?.kind !== 'sides') throw new Error('expected sides session');
    expect(session.stages.ours).toBeUndefined();
    expect(session.stages.theirs).toBeDefined();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('returns false with a toast and no session when the path is not conflicted', async () => {
    mockStages.mockResolvedValue(
      allStages({ base: undefined, ours: undefined, theirs: undefined })
    );

    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    expect(ok).toBe(false);
    expect(useGitStore.getState().mergeSession).toBeNull();
    expect(useIDEStore.getState().toast?.message).toMatch(/not conflicted/i);
    expect(mockHeads).not.toHaveBeenCalled();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('returns false with a toast when the snapshot read fails', async () => {
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockRejectedValue(new Error('marker parse failed'));

    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    expect(ok).toBe(false);
    expect(useGitStore.getState().mergeSession).toBeNull();
    expect(useIDEStore.getState().toast?.message).toContain('marker parse failed');
  });

  it('returns false with a toast when the snapshot has no regions', async () => {
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot({ regions: [] }));

    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    expect(ok).toBe(false);
    expect(useGitStore.getState().mergeSession).toBeNull();
    expect(useIDEStore.getState().toast?.message).toBeTruthy();
  });

  it('flushes a dirty open buffer to disk before reading the snapshot', async () => {
    useIDEStore.setState({
      openFiles: [openFile({ isModified: true, content: 'unsaved edits' })],
    });
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot());

    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    expect(ok).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/repo/file.txt',
      'unsaved edits',
      'utf-8',
      'lf',
      false
    );
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0];
    const snapshotOrder = mockSnapshot.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(snapshotOrder);
    expect(useIDEStore.getState().openFiles[0].isModified).toBe(false);
  });

  it('returns false with a toast when flushing the dirty buffer fails', async () => {
    useIDEStore.setState({
      openFiles: [openFile({ isModified: true, content: 'unsaved edits' })],
    });
    mockWriteFile.mockRejectedValue(new Error('disk full'));

    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    expect(ok).toBe(false);
    expect(useGitStore.getState().mergeSession).toBeNull();
    expect(useIDEStore.getState().toast?.message).toContain('disk full');
    expect(mockStages).not.toHaveBeenCalled();
  });

  it('drops the result when the workspace switches mid-flight', async () => {
    const gate = deferred<git.ConflictStages>();
    mockStages.mockReturnValue(gate.promise);

    const call = useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);
    useGitStore.getState().resetForWorkspace('/other');
    gate.resolve(allStages());
    const ok = await call;

    expect(ok).toBe(false);
    expect(useGitStore.getState().mergeSession).toBeNull();
    expect(useIDEStore.getState().toast).toBeNull();
  });

  it('drops a superseded request in favor of the newer one', async () => {
    const first = deferred<git.ConflictStages>();
    // Key the mock by path — the two opens run concurrently, so call order
    // between them is scheduling-dependent.
    mockStages.mockImplementation((_root, p) =>
      p === 'a.txt' ? first.promise : Promise.resolve(allStages({ path: 'b.txt', binary: true }))
    );
    mockHeads.mockResolvedValue(heads());

    const firstCall = useGitStore.getState().openMergeResolution('a.txt', ['a.txt', 'b.txt']);
    const secondOk = await useGitStore.getState().openMergeResolution('b.txt', ['a.txt', 'b.txt']);
    first.resolve(allStages({ path: 'a.txt', binary: true }));
    await firstCall;

    expect(secondOk).toBe(true);
    const session = useGitStore.getState().mergeSession;
    expect(session?.path).toBe('b.txt');
  });

  it('opens read-only when the snapshot encoding is not writable', async () => {
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot({ encoding: 'latin-1' }));

    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    expect(ok).toBe(true);
    const session = useGitStore.getState().mergeSession;
    if (session?.kind !== 'text') throw new Error('expected text session');
    expect(session.readOnly).toBe(true);
  });
});

describe('merge decision actions', () => {
  async function openTextSession() {
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot());
    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);
    expect(ok).toBe(true);
  }

  async function openSidesSession() {
    mockStages.mockResolvedValue(allStages({ binary: true }));
    mockHeads.mockResolvedValue(heads());
    const ok = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);
    expect(ok).toBe(true);
  }

  it('recordDecision stores a choice for a region on a text session', async () => {
    await openTextSession();

    useGitStore.getState().recordDecision(0, 'C');

    const session = useGitStore.getState().mergeSession;
    if (session?.kind !== 'text') throw new Error('expected text session');
    expect(session.decisions).toEqual({ 0: 'C' });
  });

  it('recordDecision replaces an earlier choice for the same region', async () => {
    await openTextSession();

    useGitStore.getState().recordDecision(0, 'C');
    useGitStore.getState().recordDecision(0, 'I');

    const session = useGitStore.getState().mergeSession;
    if (session?.kind !== 'text') throw new Error('expected text session');
    expect(session.decisions).toEqual({ 0: 'I' });
  });

  it('reopenDecision removes a recorded choice', async () => {
    await openTextSession();
    useGitStore.getState().recordDecision(0, 'B');

    useGitStore.getState().reopenDecision(0);

    const session = useGitStore.getState().mergeSession;
    if (session?.kind !== 'text') throw new Error('expected text session');
    expect(session.decisions).toEqual({});
  });

  it('recordDecision is a no-op on a sides session and with no session', async () => {
    useGitStore.getState().recordDecision(0, 'C');
    expect(useGitStore.getState().mergeSession).toBeNull();

    await openSidesSession();
    const before = useGitStore.getState().mergeSession;
    useGitStore.getState().recordDecision(0, 'C');
    expect(useGitStore.getState().mergeSession).toBe(before);
  });

  it('selectMergeSide sets the chosen side on a sides session', async () => {
    await openSidesSession();

    useGitStore.getState().selectMergeSide('theirs');

    const session = useGitStore.getState().mergeSession;
    if (session?.kind !== 'sides') throw new Error('expected sides session');
    expect(session.selectedSide).toBe('theirs');
  });

  it('selectMergeSide is a no-op on a text session and with no session', async () => {
    useGitStore.getState().selectMergeSide('ours');
    expect(useGitStore.getState().mergeSession).toBeNull();

    await openTextSession();
    const before = useGitStore.getState().mergeSession;
    useGitStore.getState().selectMergeSide('ours');
    expect(useGitStore.getState().mergeSession).toBe(before);
  });

  it('closeMergeResolution discards the session without writing anything', async () => {
    await openTextSession();
    useGitStore.getState().recordDecision(0, 'C');
    mockWriteFile.mockClear();

    useGitStore.getState().closeMergeResolution();

    expect(useGitStore.getState().mergeSession).toBeNull();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('resetForWorkspace clears an open merge session', async () => {
    await openTextSession();

    useGitStore.getState().resetForWorkspace('/other');

    expect(useGitStore.getState().mergeSession).toBeNull();
  });
});

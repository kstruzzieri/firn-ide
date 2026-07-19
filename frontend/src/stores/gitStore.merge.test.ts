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
  GitStage,
  WriteFile,
  GitConflictStages,
  GitMergeHeads,
  GitConflictSnapshot,
  GitResolveConflictSide,
} from '../../wailsjs/go/main/App';
import type { git } from '../../wailsjs/go/models';
import { useGitStore } from './gitStore';
import { useIDEStore, type EditorFile } from './ideStore';

const mockStages = GitConflictStages as jest.MockedFunction<typeof GitConflictStages>;
const mockGitStage = GitStage as jest.MockedFunction<typeof GitStage>;
const mockResolveSide = GitResolveConflictSide as jest.MockedFunction<
  typeof GitResolveConflictSide
>;
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
  mockWriteFile.mockResolvedValue(undefined);
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
    expect(useIDEStore.getState().toast?.message).toMatch(/no conflict markers/i);
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
    const firstOk = await firstCall;

    expect(firstOk).toBe(false);
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

  it('recordDecision ignores out-of-range region indices', async () => {
    await openTextSession();

    useGitStore.getState().recordDecision(5, 'C');
    useGitStore.getState().recordDecision(-1, 'C');

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

describe('mergeFinalizeAndStage', () => {
  const RESOLVED = 'resolved line\n';

  async function openTextSession(queue = ['file.txt']) {
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot());
    const ok = await useGitStore.getState().openMergeResolution('file.txt', queue);
    expect(ok).toBe(true);
  }

  async function openSidesSession(queue = ['file.txt']) {
    mockStages.mockResolvedValue(allStages({ binary: true }));
    mockHeads.mockResolvedValue(heads());
    const ok = await useGitStore.getState().openMergeResolution('file.txt', queue);
    expect(ok).toBe(true);
  }

  beforeEach(() => {
    mockGitStage.mockResolvedValue(undefined);
    mockResolveSide.mockResolvedValue(undefined);
  });

  it('writes the result, stages the file, and closes on an exhausted queue', async () => {
    await openTextSession();

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith('/repo/file.txt', RESOLVED, 'utf-8', 'lf', false);
    expect(mockGitStage).toHaveBeenCalledWith('/repo', ['file.txt']);
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0];
    const stageOrder = mockGitStage.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(stageOrder);
    expect(useGitStore.getState().mergeSession).toBeNull();
  });

  it('reconciles an open clean buffer with the resolved content', async () => {
    useIDEStore.setState({
      openFiles: [openFile({ content: snapshot().content, isModified: false })],
    });
    await openTextSession();

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(true);
    const file = useIDEStore.getState().openFiles[0];
    expect(file.content).toBe(RESOLVED);
    expect(file.isModified).toBe(false);
  });

  it('blocks finalize when the open buffer diverged from the session content', async () => {
    useIDEStore.setState({
      openFiles: [openFile({ content: snapshot().content, isModified: false })],
    });
    await openTextSession();
    useIDEStore.setState({
      openFiles: [openFile({ content: 'concurrent edit', isModified: true })],
    });
    mockWriteFile.mockClear();

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockGitStage).not.toHaveBeenCalled();
    expect(useGitStore.getState().mergeSession).not.toBeNull();
    expect(useIDEStore.getState().toast?.message).toBeTruthy();
  });

  it('refuses to finalize a read-only text session', async () => {
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot({ encoding: 'latin-1' }));
    await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);
    mockWriteFile.mockClear();

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockGitStage).not.toHaveBeenCalled();
  });

  it('finalizes a sides session through GitResolveConflictSide', async () => {
    await openSidesSession();
    useGitStore.getState().selectMergeSide('theirs');

    const ok = await useGitStore.getState().mergeFinalizeAndStage();

    expect(ok).toBe(true);
    expect(mockResolveSide).toHaveBeenCalledWith('/repo', 'file.txt', 'theirs');
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(useGitStore.getState().mergeSession).toBeNull();
  });

  it('refuses a sides finalize before a side is selected', async () => {
    await openSidesSession();

    const ok = await useGitStore.getState().mergeFinalizeAndStage();

    expect(ok).toBe(false);
    expect(mockResolveSide).not.toHaveBeenCalled();
    expect(useGitStore.getState().mergeSession).not.toBeNull();
  });

  it('keeps the session open and reports when staging fails', async () => {
    await openTextSession();
    mockGitStage.mockRejectedValue(new Error('index locked'));

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(false);
    expect(useGitStore.getState().mergeSession).not.toBeNull();
    expect(useIDEStore.getState().toast?.message).toContain('index locked');
  });

  it('keeps the session open and reports when the write fails', async () => {
    await openTextSession();
    mockWriteFile.mockRejectedValue(new Error('disk full'));

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(false);
    expect(mockGitStage).not.toHaveBeenCalled();
    expect(useGitStore.getState().mergeSession).not.toBeNull();
    expect(useIDEStore.getState().toast?.message).toContain('disk full');
  });

  it('advances to the next queued conflicted file after a successful finalize', async () => {
    mockStages.mockImplementation((_root, p) =>
      p === 'file.txt'
        ? Promise.resolve(allStages())
        : Promise.resolve(allStages({ path: 'other.txt', binary: true }))
    );
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot());
    await useGitStore.getState().openMergeResolution('file.txt', ['file.txt', 'other.txt']);

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(true);
    const session = useGitStore.getState().mergeSession;
    expect(session?.path).toBe('other.txt');
    expect(session?.kind).toBe('sides');
    expect(session?.fileQueue).toEqual(['other.txt']);
  });

  it('aborts before staging when the workspace switches mid-write', async () => {
    await openTextSession();
    const gate = deferred<void>();
    mockWriteFile.mockReturnValue(gate.promise as never);

    const call = useGitStore.getState().mergeFinalizeAndStage(RESOLVED);
    // Let the finalize reach the actual disk write before switching away.
    for (let i = 0; i < 10 && mockWriteFile.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(mockWriteFile).toHaveBeenCalled();
    useGitStore.getState().resetForWorkspace('/other');
    gate.resolve();
    const ok = await call;

    expect(ok).toBe(false);
    expect(mockGitStage).not.toHaveBeenCalled();
    // The resolved text WAS written but never staged — the user must be told
    // what manual recovery the stranded file needs.
    expect(useIDEStore.getState().toast?.message).toMatch(/written but not staged/i);
  });

  it('is a no-op without a session or without a result on a text session', async () => {
    expect(await useGitStore.getState().mergeFinalizeAndStage(RESOLVED)).toBe(false);

    await openTextSession();
    mockWriteFile.mockClear();
    expect(await useGitStore.getState().mergeFinalizeAndStage()).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(useGitStore.getState().mergeSession).not.toBeNull();
  });

  it('finalizes a CRLF file whose open buffer is LF-normalized by the editor', async () => {
    // CodeMirror joins lines with \n, so an ever-edited CRLF file holds LF
    // content in the store while the snapshot preserves raw CRLF bytes.
    const crlfContent =
      '<<<<<<< HEAD\r\nours line\r\n=======\r\ntheirs line\r\n>>>>>>> feature\r\n';
    useIDEStore.setState({
      openFiles: [
        openFile({
          content: crlfContent.replace(/\r\n/g, '\n'),
          lineEndings: 'crlf',
          isModified: false,
        }),
      ],
    });
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot({ content: crlfContent, lineEndings: 'crlf' }));
    await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith('/repo/file.txt', RESOLVED, 'utf-8', 'crlf', false);
    expect(mockGitStage).toHaveBeenCalledWith('/repo', ['file.txt']);
  });

  it('preserves a keystroke that lands in the open buffer during the write', async () => {
    useIDEStore.setState({
      openFiles: [openFile({ content: snapshot().content, isModified: false })],
    });
    await openTextSession();
    const gate = deferred<void>();
    mockWriteFile.mockReturnValue(gate.promise);

    const call = useGitStore.getState().mergeFinalizeAndStage(RESOLVED);
    await Promise.resolve();
    useIDEStore.getState().updateFileContent('f1', 'newer keystroke');
    gate.resolve();
    const ok = await call;

    expect(ok).toBe(false);
    expect(mockGitStage).not.toHaveBeenCalled();
    const file = useIDEStore.getState().openFiles[0];
    expect(file.content).toBe('newer keystroke');
    expect(file.isModified).toBe(true);
    expect(useIDEStore.getState().toast?.message).toBeTruthy();
  });

  it('allows an immediate retry after a staging failure with the file open', async () => {
    useIDEStore.setState({
      openFiles: [openFile({ content: snapshot().content, isModified: false })],
    });
    await openTextSession();
    mockGitStage.mockRejectedValueOnce(new Error('index locked'));

    expect(await useGitStore.getState().mergeFinalizeAndStage(RESOLVED)).toBe(false);
    expect(useGitStore.getState().mergeSession).not.toBeNull();

    const retry = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(retry).toBe(true);
    expect(mockGitStage).toHaveBeenCalledTimes(2);
    expect(useGitStore.getState().mergeSession).toBeNull();
  });

  it('refuses to finalize while another git operation is in flight', async () => {
    await openTextSession();
    useGitStore.setState({ opInFlight: 'pull' });
    mockWriteFile.mockClear();

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(useIDEStore.getState().toast?.message).toMatch(/operation/i);
    useGitStore.setState({ opInFlight: null });
  });

  it('runs a single write and stage for concurrent finalize calls', async () => {
    await openTextSession();
    const gate = deferred<void>();
    mockWriteFile.mockReturnValue(gate.promise);

    const first = useGitStore.getState().mergeFinalizeAndStage(RESOLVED);
    const second = useGitStore.getState().mergeFinalizeAndStage('other result\n');
    gate.resolve();
    const [firstOk, secondOk] = await Promise.all([first, second]);

    expect(firstOk).toBe(true);
    expect(secondOk).toBe(false);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockGitStage).toHaveBeenCalledTimes(1);
  });

  it('blocks a sides finalize while the open buffer is dirty', async () => {
    useIDEStore.setState({ openFiles: [openFile({ isModified: false })] });
    await openSidesSession();
    useGitStore.getState().selectMergeSide('ours');
    // The edit lands AFTER the session opened (the open itself flushes).
    useIDEStore.getState().updateFileContent('f1', 'edited after open');

    const ok = await useGitStore.getState().mergeFinalizeAndStage();

    expect(ok).toBe(false);
    expect(mockResolveSide).not.toHaveBeenCalled();
    expect(useGitStore.getState().mergeSession).not.toBeNull();
    expect(useIDEStore.getState().toast?.message).toBeTruthy();
  });

  it('closes the open editor tab after a sides finalize applies', async () => {
    useIDEStore.setState({
      openFiles: [openFile({ isModified: false })],
    });
    await openSidesSession();
    useGitStore.getState().selectMergeSide('theirs');

    const ok = await useGitStore.getState().mergeFinalizeAndStage();

    expect(ok).toBe(true);
    expect(useIDEStore.getState().openFiles).toHaveLength(0);
  });

  it('surfaces the unsupported-format reason when finalizing a read-only session', async () => {
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot({ encoding: 'latin-1' }));
    await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(false);
    expect(useIDEStore.getState().toast?.message).toMatch(/encoding|format/i);
  });

  it('aborts before writing when a newer open superseded the session', async () => {
    await openTextSession();
    const gate = deferred<git.ConflictStages>();
    mockStages.mockReturnValue(gate.promise);
    // A newer openMergeResolution is in flight (not yet installed) — the
    // stale session must not write or stage.
    const pendingOpen = useGitStore.getState().openMergeResolution('other.txt', ['other.txt']);
    mockWriteFile.mockClear();

    const ok = await useGitStore.getState().mergeFinalizeAndStage(RESOLVED);

    expect(ok).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockGitStage).not.toHaveBeenCalled();
    gate.resolve(allStages({ path: 'other.txt', binary: true }));
    await pendingOpen;
  });
});

describe('review round 2 hardening', () => {
  const RESOLVED = 'resolved line\n';

  async function openTextSession(queue = ['file.txt']) {
    mockStages.mockResolvedValue(allStages());
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot());
    const ok = await useGitStore.getState().openMergeResolution('file.txt', queue);
    expect(ok).toBe(true);
  }

  beforeEach(() => {
    mockGitStage.mockResolvedValue(undefined);
    mockResolveSide.mockResolvedValue(undefined);
  });

  it('keeps the tab and warns when an edit lands during a sides apply', async () => {
    useIDEStore.setState({ openFiles: [openFile({ isModified: false })] });
    mockStages.mockResolvedValue(allStages({ binary: true }));
    mockHeads.mockResolvedValue(heads());
    await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);
    useGitStore.getState().selectMergeSide('theirs');
    const gate = deferred<void>();
    mockResolveSide.mockReturnValue(gate.promise);

    const call = useGitStore.getState().mergeFinalizeAndStage();
    await Promise.resolve();
    useIDEStore.getState().updateFileContent('f1', 'edit during apply');
    gate.resolve();
    const ok = await call;

    expect(ok).toBe(true);
    const file = useIDEStore.getState().openFiles[0];
    expect(file).toBeDefined();
    expect(file.content).toBe('edit during apply');
    expect(file.isModified).toBe(true);
    expect(useIDEStore.getState().toast?.message).toMatch(/unsaved|preserved/i);
  });

  it('warns when the tab closes during a sides apply (close-save may recreate)', async () => {
    useIDEStore.setState({ openFiles: [openFile({ isModified: false })] });
    mockStages.mockResolvedValue(allStages({ binary: true }));
    mockHeads.mockResolvedValue(heads());
    await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);
    useGitStore.getState().selectMergeSide('theirs');
    const gate = deferred<void>();
    mockResolveSide.mockReturnValue(gate.promise);

    const call = useGitStore.getState().mergeFinalizeAndStage();
    await Promise.resolve();
    // Edit then close mid-apply: the close-save path (useAutosave's
    // subscription) writes the captured content and can recreate a file
    // whose deletion was just staged.
    useIDEStore.getState().updateFileContent('f1', 'edit during apply');
    useIDEStore.getState().closeFile('f1');
    gate.resolve();
    const ok = await call;

    expect(ok).toBe(true);
    expect(useIDEStore.getState().toast?.message).toMatch(/closed|check/i);
  });

  it('blocks staging when the tab closes with edits during the resolved write', async () => {
    useIDEStore.setState({
      openFiles: [openFile({ content: snapshot().content, isModified: false })],
    });
    await openTextSession();
    const gate = deferred<void>();
    mockWriteFile.mockReturnValueOnce(gate.promise);

    const call = useGitStore.getState().mergeFinalizeAndStage(RESOLVED);
    await Promise.resolve();
    // Edit + close mid-write: the close-save queues the marker-bearing edit
    // BEHIND the resolved write in the same per-path queue — disk will not
    // hold the staged resolution.
    useIDEStore.getState().updateFileContent('f1', 'markers still here');
    useIDEStore.getState().closeFile('f1');
    gate.resolve();
    const ok = await call;

    expect(ok).toBe(false);
    expect(mockGitStage).not.toHaveBeenCalled();
    expect(useIDEStore.getState().toast?.message).toMatch(/not staged/i);
    // The session CLOSES on this refusal: its baseline was already rebased to
    // the result, so a blind retry would rewrite the result over the
    // close-saved edit. The user was told to reopen and re-resolve instead.
    expect(useGitStore.getState().mergeSession).toBeNull();
    mockWriteFile.mockClear();
    expect(await useGitStore.getState().mergeFinalizeAndStage(RESOLVED)).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('refuses a same-file re-open while a finalize is mid-write', async () => {
    await openTextSession();
    const gate = deferred<void>();
    mockWriteFile.mockReturnValue(gate.promise);

    const finalize = useGitStore.getState().mergeFinalizeAndStage(RESOLVED);
    await Promise.resolve();
    mockStages.mockClear();
    const reopened = await useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);
    gate.resolve();
    const ok = await finalize;

    expect(reopened).toBe(false);
    expect(mockStages).not.toHaveBeenCalled();
    expect(ok).toBe(true);
    expect(useGitStore.getState().mergeSession).toBeNull();
  });

  it('allows a retry with a corrected result after a staging failure', async () => {
    useIDEStore.setState({
      openFiles: [openFile({ content: snapshot().content, isModified: false })],
    });
    await openTextSession();
    mockGitStage.mockRejectedValueOnce(new Error('index locked'));

    expect(await useGitStore.getState().mergeFinalizeAndStage(RESOLVED)).toBe(false);
    const corrected = 'corrected line\n';
    const retry = await useGitStore.getState().mergeFinalizeAndStage(corrected);

    expect(retry).toBe(true);
    expect(mockWriteFile).toHaveBeenLastCalledWith(
      '/repo/file.txt',
      corrected,
      'utf-8',
      'lf',
      false
    );
    expect(useGitStore.getState().mergeSession).toBeNull();
  });
});

describe('resolveConflict fallback', () => {
  beforeEach(() => {
    (
      jest.requireMock('../../wailsjs/go/main/App') as { ReadFile: jest.Mock }
    ).ReadFile.mockResolvedValue({
      content: 'marker body',
      encoding: 'utf-8',
      lineEndings: 'lf',
      isBinary: false,
    });
  });

  it('falls back to a plain open when no session could be built', async () => {
    mockStages.mockResolvedValue(
      allStages({ base: undefined, ours: undefined, theirs: undefined })
    );

    await useGitStore.getState().resolveConflict('file.txt', ['file.txt'], '/repo/file.txt');

    const { ReadFile } = jest.requireMock('../../wailsjs/go/main/App') as { ReadFile: jest.Mock };
    expect(ReadFile).toHaveBeenCalledWith('/repo/file.txt');
  });

  it('abandons a fallback that goes stale during its own file read', async () => {
    const readGate = deferred<{
      content: string;
      encoding: string;
      lineEndings: string;
      isBinary: boolean;
    }>();
    const { ReadFile } = jest.requireMock('../../wailsjs/go/main/App') as { ReadFile: jest.Mock };
    ReadFile.mockReturnValue(readGate.promise);
    mockStages.mockImplementation((_root, p) =>
      p === 'a.txt'
        ? Promise.resolve(allStages({ base: undefined, ours: undefined, theirs: undefined }))
        : Promise.resolve(allStages({ path: 'b.txt', binary: true }))
    );
    mockHeads.mockResolvedValue(heads());

    // a.txt is not conflicted -> fallback starts and blocks in ReadFile.
    const first = useGitStore.getState().resolveConflict('a.txt', ['a.txt'], '/repo/a.txt');
    for (let i = 0; i < 10 && (ReadFile as jest.Mock).mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(ReadFile).toHaveBeenCalledWith('/repo/a.txt');
    // b.txt wins a merge session while a's read is still pending.
    await useGitStore.getState().resolveConflict('b.txt', ['b.txt'], '/repo/b.txt');
    readGate.resolve({ content: 'markers', encoding: 'utf-8', lineEndings: 'lf', isBinary: false });
    await first;

    expect(useIDEStore.getState().openFiles).toHaveLength(0);
    expect(useGitStore.getState().mergeSession?.path).toBe('b.txt');
  });

  it('lets a failed next-open toast survive a sides warning', async () => {
    useIDEStore.setState({ openFiles: [openFile({ isModified: false })] });
    mockStages.mockImplementation((_root, p) =>
      p === 'file.txt'
        ? Promise.resolve(allStages({ binary: true }))
        : Promise.resolve(
            allStages({ path: 'next.txt', base: undefined, ours: undefined, theirs: undefined })
          )
    );
    mockHeads.mockResolvedValue(heads());
    mockResolveSide.mockReset();
    await useGitStore.getState().openMergeResolution('file.txt', ['file.txt', 'next.txt']);
    useGitStore.getState().selectMergeSide('theirs');
    const gate = deferred<void>();
    mockResolveSide.mockReturnValue(gate.promise);

    const call = useGitStore.getState().mergeFinalizeAndStage();
    await Promise.resolve();
    useIDEStore.getState().updateFileContent('f1', 'edit during apply');
    gate.resolve();
    const ok = await call;

    expect(ok).toBe(true);
    // next.txt failed to open ("not conflicted") — that explanation must be
    // the surviving toast, not the sides warning emitted for file.txt.
    expect(useIDEStore.getState().toast?.message).toMatch(/not conflicted/i);
  });

  it('suppresses the fallback when a newer request superseded the click', async () => {
    const gate = deferred<git.ConflictStages>();
    mockStages.mockImplementation((_root, p) =>
      p === 'a.txt' ? gate.promise : Promise.resolve(allStages({ path: 'b.txt', binary: true }))
    );
    mockHeads.mockResolvedValue(heads());

    const first = useGitStore.getState().resolveConflict('a.txt', ['a.txt'], '/repo/a.txt');
    await useGitStore.getState().resolveConflict('b.txt', ['b.txt'], '/repo/b.txt');
    gate.resolve(allStages({ path: 'a.txt', base: undefined, ours: undefined, theirs: undefined }));
    await first;

    const { ReadFile } = jest.requireMock('../../wailsjs/go/main/App') as { ReadFile: jest.Mock };
    expect(ReadFile).not.toHaveBeenCalled();
    expect(useGitStore.getState().mergeSession?.path).toBe('b.txt');
  });
});

describe('failed open leaves the installed session finalizable', () => {
  it('a not-conflicted Resolve on another file does not dead-end the open session', async () => {
    mockStages.mockImplementation((_root, p) =>
      p === 'file.txt'
        ? Promise.resolve(allStages())
        : Promise.resolve(
            allStages({ path: 'b.txt', base: undefined, ours: undefined, theirs: undefined })
          )
    );
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot());
    mockGitStage.mockResolvedValue(undefined);
    expect(await useGitStore.getState().openMergeResolution('file.txt', ['file.txt'])).toBe(true);

    expect(await useGitStore.getState().openMergeResolution('b.txt', ['b.txt'])).toBe(false);

    const ok = await useGitStore.getState().mergeFinalizeAndStage('resolved line\n');
    expect(ok).toBe(true);
    expect(mockGitStage).toHaveBeenCalledWith('/repo', ['file.txt']);
  });

  it('a failed Resolve on another file does not dead-end the open session', async () => {
    mockStages.mockImplementation((_root, p) =>
      p === 'file.txt' ? Promise.resolve(allStages()) : Promise.reject(new Error('too large'))
    );
    mockHeads.mockResolvedValue(heads());
    mockSnapshot.mockResolvedValue(snapshot());
    mockGitStage.mockResolvedValue(undefined);
    expect(await useGitStore.getState().openMergeResolution('file.txt', ['file.txt'])).toBe(true);

    // A Resolve click on b.txt fails after bumping the request counter.
    expect(await useGitStore.getState().openMergeResolution('b.txt', ['b.txt'])).toBe(false);
    expect(useGitStore.getState().mergeSession?.path).toBe('file.txt');

    // The surviving session must still finalize — not silently dead-end.
    const ok = await useGitStore.getState().mergeFinalizeAndStage('resolved line\n');

    expect(ok).toBe(true);
    expect(mockGitStage).toHaveBeenCalledWith('/repo', ['file.txt']);
  });
});

describe('closeMergeResolution invalidation', () => {
  it('invalidates an in-flight open so a closed surface cannot reappear', async () => {
    const gate = deferred<git.ConflictStages>();
    mockStages.mockReturnValue(gate.promise);
    mockHeads.mockResolvedValue(heads());

    const call = useGitStore.getState().openMergeResolution('file.txt', ['file.txt']);
    useGitStore.getState().closeMergeResolution();
    gate.resolve(allStages({ binary: true }));
    const ok = await call;

    expect(ok).toBe(false);
    expect(useGitStore.getState().mergeSession).toBeNull();
  });
});

import {
  ensurePathLoaded,
  reconcileTreeWithDisk,
  beginRootRead,
  commitRootRead,
  __resetEnsurePathLoaded,
} from '../../hooks/useEnsurePathLoaded';
import { useIDEStore } from '../../stores/ideStore';
import { ReadDirectoryShallow } from '../../wails/bindings';
import type { FileEntry } from '../../stores/ideStore';

jest.mock('../../wails/bindings', () => ({ ReadDirectoryShallow: jest.fn() }));
const mockRead = ReadDirectoryShallow as jest.Mock;

const dir = (path: string, children?: FileEntry[]): FileEntry =>
  ({
    name: path.split('/').pop()!,
    path,
    isDir: true,
    size: 0,
    modTime: '',
    children,
  }) as FileEntry;

beforeEach(() => {
  __resetEnsurePathLoaded();
  mockRead.mockReset();
  useIDEStore.setState({
    workspace: { path: '/r', name: 'r' } as never,
    directoryTree: [dir('/r/a')],
    loadingPaths: new Set(),
    dirtyPaths: new Set(),
    treeError: null,
    toast: null,
  });
});

it('loads an unloaded dir once and merges children', async () => {
  mockRead.mockResolvedValue([dir('/r/a/x')]);
  await ensurePathLoaded('/r/a');
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockRead).toHaveBeenCalledWith('/r/a', '/r');
  expect(useIDEStore.getState().directoryTree[0].children).toHaveLength(1);
  expect(useIDEStore.getState().loadingPaths.has('/r/a')).toBe(false);
});

it('dedupes concurrent calls (one backend call, same promise)', async () => {
  let resolve!: (v: unknown) => void;
  mockRead.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const p1 = ensurePathLoaded('/r/a');
  const p2 = ensurePathLoaded('/r/a');
  expect(p1).toBe(p2);
  resolve([dir('/r/a/x')]);
  await p1;
  expect(mockRead).toHaveBeenCalledTimes(1);
});

it('skips already-loaded dir unless force', async () => {
  useIDEStore.setState({ directoryTree: [dir('/r/a', [])] });
  await ensurePathLoaded('/r/a');
  expect(mockRead).not.toHaveBeenCalled();
  await ensurePathLoaded('/r/a', { force: true });
  expect(mockRead).toHaveBeenCalledTimes(1);
});

it('retries an unreadable loaded-empty node without requiring force', async () => {
  const unreadable = dir('/r/a', []);
  unreadable.unreadable = true;
  useIDEStore.setState({ directoryTree: [unreadable] });
  mockRead.mockResolvedValue([dir('/r/a/real', [])]);

  await ensurePathLoaded('/r/a');

  expect(mockRead).toHaveBeenCalledWith('/r/a', '/r');
  expect(useIDEStore.getState().directoryTree[0].unreadable).toBe(false);
});

it('on failure marks the node unreadable without discarding trustworthy children', async () => {
  const trustworthyChildren = [dir('/r/a/keep', [])];
  useIDEStore.setState({ directoryTree: [dir('/r/a', trustworthyChildren)] });
  mockRead.mockRejectedValue(new Error('boom'));
  await ensurePathLoaded('/r/a', { force: true });
  const s = useIDEStore.getState();
  expect(s.loadingPaths.has('/r/a')).toBe(false);
  expect(s.dirtyPaths.has('/r/a')).toBe(true);
  expect(s.directoryTree[0].unreadable).toBe(true);
  expect(s.directoryTree[0].children).toBe(trustworthyChildren);
  expect(s.treeError).toBeNull();
  expect(s.toast).toEqual({ message: 'Failed to load a', type: 'error' });
});

it('a successful forced retry clears unreadable and installs real children', async () => {
  mockRead
    .mockRejectedValueOnce(new Error('permission denied'))
    .mockResolvedValueOnce([dir('/r/a/real', [])]);

  await ensurePathLoaded('/r/a');
  expect(useIDEStore.getState().directoryTree[0].unreadable).toBe(true);

  await ensurePathLoaded('/r/a', { force: true });
  const node = useIDEStore.getState().directoryTree[0];
  expect(node.unreadable).toBe(false);
  expect(node.children?.map((child) => child.path)).toEqual(['/r/a/real']);
  expect(useIDEStore.getState().dirtyPaths.has('/r/a')).toBe(false);
});

it('does not re-toast a repeated failure of an already-dirty path', async () => {
  mockRead.mockRejectedValue(new Error('permission denied'));

  await ensurePathLoaded('/r/a');
  expect(useIDEStore.getState().toast).toEqual({ message: 'Failed to load a', type: 'error' });

  useIDEStore.setState({ toast: null });
  await ensurePathLoaded('/r/a', { force: true });

  expect(useIDEStore.getState().toast).toBeNull();
  expect(useIDEStore.getState().dirtyPaths.has('/r/a')).toBe(true);
  expect(useIDEStore.getState().directoryTree[0].unreadable).toBe(true);
});

it('skips annotations when the node was removed mid-flight', async () => {
  let reject!: (reason: unknown) => void;
  mockRead.mockReturnValue(
    new Promise((_resolve, rejectPromise) => {
      reject = rejectPromise;
    })
  );

  const p = ensurePathLoaded('/r/a');
  // Watcher reconcile removed /r/a from the tree while its load was in flight.
  useIDEStore.setState({ directoryTree: [] });
  reject(new Error('no such file or directory'));
  await p;

  const state = useIDEStore.getState();
  expect(state.dirtyPaths.size).toBe(0);
  expect(state.toast).toBeNull();
  expect(state.loadingPaths.has('/r/a')).toBe(false);
});

it('drops result if workspace changed during load', async () => {
  let resolve!: (v: unknown) => void;
  mockRead.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const p = ensurePathLoaded('/r/a');
  useIDEStore.setState({ workspace: { path: '/other', name: 'o' } as never });
  resolve([dir('/r/a/x')]);
  await p;
  expect(useIDEStore.getState().directoryTree[0]?.children).toBeUndefined();
});

it('drops failure state if workspace changed during load', async () => {
  let reject!: (reason: unknown) => void;
  mockRead.mockReturnValue(
    new Promise((_resolve, rejectPromise) => {
      reject = rejectPromise;
    })
  );
  const p = ensurePathLoaded('/r/a');
  useIDEStore.setState({
    workspace: { path: '/other', name: 'other' } as never,
    directoryTree: [dir('/other/a')],
    dirtyPaths: new Set(),
    toast: null,
  });
  reject(new Error('permission denied'));
  await p;

  const state = useIDEStore.getState();
  expect(state.directoryTree[0].unreadable).toBeUndefined();
  expect(state.dirtyPaths.size).toBe(0);
  expect(state.toast).toBeNull();
});

it('drops a stale failure after switching away and back to the same workspace path', async () => {
  let reject!: (reason: unknown) => void;
  mockRead.mockReturnValue(
    new Promise((_resolve, rejectPromise) => {
      reject = rejectPromise;
    })
  );
  const originalWorkspace = useIDEStore.getState().workspace;
  const p = ensurePathLoaded('/r/a');

  useIDEStore.setState({
    workspace: { path: '/other', name: 'other' } as never,
    directoryTree: [dir('/other/a')],
    dirtyPaths: new Set(),
    toast: null,
  });
  useIDEStore.setState({
    workspace: { path: '/r', name: 'r reopened' } as never,
    directoryTree: [dir('/r/a')],
    dirtyPaths: new Set(),
    toast: null,
  });
  expect(useIDEStore.getState().workspace).not.toBe(originalWorkspace);

  reject(new Error('permission denied'));
  await p;

  const state = useIDEStore.getState();
  expect(state.directoryTree[0].unreadable).toBeUndefined();
  expect(state.dirtyPaths.size).toBe(0);
  expect(state.toast).toBeNull();
});

it('starts a fresh load after switching away and back to the same workspace path', async () => {
  let resolveStale!: (value: FileEntry[]) => void;
  const stale = new Promise<FileEntry[]>((resolve) => {
    resolveStale = resolve;
  });
  mockRead.mockReturnValueOnce(stale).mockResolvedValueOnce([dir('/r/a/fresh')]);

  const oldLoad = ensurePathLoaded('/r/a');
  useIDEStore.setState({
    workspace: { path: '/other', name: 'other' } as never,
    directoryTree: [dir('/other/a')],
  });
  useIDEStore.setState({
    workspace: { path: '/r', name: 'r reopened' } as never,
    directoryTree: [dir('/r/a')],
  });
  const newLoad = ensurePathLoaded('/r/a');

  expect(newLoad).not.toBe(oldLoad);
  await newLoad;
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(useIDEStore.getState().directoryTree[0].children?.[0].path).toBe('/r/a/fresh');

  resolveStale([dir('/r/a/stale')]);
  await oldLoad;
  expect(useIDEStore.getState().directoryTree[0].children?.[0].path).toBe('/r/a/fresh');
});

it('keeps a failed root refresh explicit without annotating its children', async () => {
  const rootChildren = [dir('/r/a', [])];
  useIDEStore.setState({ directoryTree: rootChildren });
  mockRead.mockRejectedValue(new Error('permission denied'));

  await ensurePathLoaded('/r', { force: true });

  const state = useIDEStore.getState();
  expect(state.directoryTree).toBe(rootChildren);
  expect(state.directoryTree[0].unreadable).toBeUndefined();
  expect(state.loadingPaths.has('/r')).toBe(false);
  expect(state.dirtyPaths.has('/r')).toBe(true);
  expect(state.treeError).toBeNull();
  expect(state.toast).toEqual({ message: 'Failed to load r', type: 'error' });
});

describe('reconcileTreeWithDisk pruning (#256)', () => {
  it('drops an expanded path its freshly read parent no longer lists as a directory', async () => {
    useIDEStore.setState({
      directoryTree: [dir('/r/a'), dir('/r/gone', [])],
      expandedPaths: new Set(['/r/a', '/r/gone', '/r/a/deep']),
    });
    mockRead.mockImplementation((path: string) =>
      Promise.resolve(path === '/r' ? [dir('/r/a')] : path === '/r/a' ? [dir('/r/a/deep')] : [])
    );

    await reconcileTreeWithDisk('/r', useIDEStore.getState().expandedPaths);

    expect([...useIDEStore.getState().expandedPaths].sort()).toEqual(['/r/a', '/r/a/deep']);
  });

  it('keeps every descendant of a parent whose read failed, not just its children', async () => {
    useIDEStore.setState({
      directoryTree: [dir('/r/a')],
      expandedPaths: new Set(['/r/a', '/r/a/b', '/r/a/b/c']),
    });
    mockRead.mockImplementation((path: string) =>
      path === '/r'
        ? Promise.resolve([dir('/r/a')])
        : Promise.reject(new Error(`open ${path}: EIO`))
    );

    await reconcileTreeWithDisk('/r', useIDEStore.getState().expandedPaths);

    // /r/a/b was never read, so /r/a/b/c has no fresh parent listing to be judged by.
    expect([...useIDEStore.getState().expandedPaths].sort()).toEqual([
      '/r/a',
      '/r/a/b',
      '/r/a/b/c',
    ]);
  });

  it('keeps expanded paths when the parent read failed, since its listing is not fresh', async () => {
    useIDEStore.setState({
      directoryTree: [dir('/r/a')],
      expandedPaths: new Set(['/r/a', '/r/maybe']),
    });
    mockRead.mockRejectedValue(new Error('open /r: permission denied'));

    await reconcileTreeWithDisk('/r', useIDEStore.getState().expandedPaths);

    expect([...useIDEStore.getState().expandedPaths].sort()).toEqual(['/r/a', '/r/maybe']);
  });
});

describe('root read ordering (#256)', () => {
  it('drops an older root listing that resolves after a newer one merged', async () => {
    let resolveOld!: (v: unknown) => void;
    mockRead.mockReturnValue(
      new Promise((r) => {
        resolveOld = r;
      })
    );

    const old = ensurePathLoaded('/r', { force: true });
    // The other reader (useDirectoryTree) starts later and lands first: it
    // takes a ticket, commits it and merges its listing.
    const newer = beginRootRead();
    expect(commitRootRead(newer)).toBe(true);
    useIDEStore.getState().mergeChildren('/r', [dir('/r/a'), dir('/r/b')]);
    resolveOld([dir('/r/a')]);
    await old;

    expect(useIDEStore.getState().directoryTree.map((e) => e.path)).toEqual(['/r/a', '/r/b']);
  });
});

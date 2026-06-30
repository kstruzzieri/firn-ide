import { ensurePathLoaded, __resetEnsurePathLoaded } from '../../hooks/useEnsurePathLoaded';
import { useIDEStore } from '../../stores/ideStore';
import { ReadDirectoryShallow } from '../../../wailsjs/go/main/App';
import type { FileEntry } from '../../stores/ideStore';

jest.mock('../../../wailsjs/go/main/App', () => ({ ReadDirectoryShallow: jest.fn() }));
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
  });
});

it('loads an unloaded dir once and merges children', async () => {
  mockRead.mockResolvedValue([dir('/r/a/x')]);
  await ensurePathLoaded('/r/a');
  expect(mockRead).toHaveBeenCalledTimes(1);
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

it('on failure clears loading, marks dirty, does NOT set tree error', async () => {
  mockRead.mockRejectedValue(new Error('boom'));
  await ensurePathLoaded('/r/a');
  const s = useIDEStore.getState();
  expect(s.loadingPaths.has('/r/a')).toBe(false);
  expect(s.dirtyPaths.has('/r/a')).toBe(true);
  expect(s.treeError).toBeNull();
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

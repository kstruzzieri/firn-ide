import { useIDEStore } from '../../stores/ideStore';
import type { FileEntry } from '../../stores/ideStore';

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
  useIDEStore.setState({
    workspace: { path: '/r', name: 'r' } as never,
    directoryTree: [dir('/r/a', [dir('/r/a/x')])],
    loadingPaths: new Set(),
    dirtyPaths: new Set(),
  });
});

it('mergeChildren sets children at a deep path and normalizes empty to []', () => {
  useIDEStore.getState().mergeChildren('/r/a/x', []);
  const x = useIDEStore.getState().directoryTree[0].children![0];
  expect(x.children).toEqual([]);
});

it('mergeChildren on the root path replaces directoryTree', () => {
  useIDEStore.getState().mergeChildren('/r', [dir('/r/new')]);
  expect(useIDEStore.getState().directoryTree.map((e) => e.path)).toEqual(['/r/new']);
});

it('loading + dirty mutators are immutable sets', () => {
  const s = useIDEStore.getState();
  const before = s.loadingPaths;
  s.addLoadingPath('/r/a');
  expect(useIDEStore.getState().loadingPaths.has('/r/a')).toBe(true);
  expect(useIDEStore.getState().loadingPaths).not.toBe(before);
  s.removeLoadingPath('/r/a');
  expect(useIDEStore.getState().loadingPaths.has('/r/a')).toBe(false);
  s.markDirty('/r/a');
  expect(useIDEStore.getState().dirtyPaths.has('/r/a')).toBe(true);
  s.clearDirty('/r/a');
  expect(useIDEStore.getState().dirtyPaths.has('/r/a')).toBe(false);
});

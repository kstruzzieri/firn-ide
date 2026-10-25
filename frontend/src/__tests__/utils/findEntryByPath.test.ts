import { findEntryByPath } from '../../utils/findEntryByPath';
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

it('finds a deep node', () => {
  const tree = [dir('/r/a', [dir('/r/a/b', [dir('/r/a/b/c')])])];
  expect(findEntryByPath(tree, '/r/a/b/c')?.path).toBe('/r/a/b/c');
});
it('finds a deep node with Windows separators', () => {
  const tree = [dir('C:\\repo\\a', [dir('C:\\repo\\a\\b', [dir('C:\\repo\\a\\b\\c')])])];
  expect(findEntryByPath(tree, 'C:\\repo\\a\\b\\c')?.path).toBe('C:\\repo\\a\\b\\c');
});
it('returns null when absent', () => {
  expect(findEntryByPath([dir('/r/a')], '/r/nope')).toBeNull();
});
it('tells a POSIX folder a\\b from its twin a/b (#447)', () => {
  const tree = [dir('/r/a', [dir('/r/a/b', [])]), dir('/r/a\\b')];
  expect(findEntryByPath(tree, '/r/a\\b')).toBe(tree[1]);
  expect(findEntryByPath(tree, '/r/a/b')).toBe(tree[0].children![0]);
});
it('still matches Windows paths across separators and drive-letter case', () => {
  const tree = [dir('C:\\repo\\a', [dir('C:\\repo\\a\\b')])];
  expect(findEntryByPath(tree, 'c:/repo/a/b')?.path).toBe('C:\\repo\\a\\b');
});

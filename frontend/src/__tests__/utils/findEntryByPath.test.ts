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

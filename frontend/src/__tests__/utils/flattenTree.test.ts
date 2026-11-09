import { flattenVisibleTree } from '../../utils/flattenTree';
import type { FileEntry } from '../../stores/ideStore';

const dir = (p: string, children?: FileEntry[]): FileEntry =>
  ({
    name: p.split('/').pop()!,
    path: p,
    isDir: true,
    size: 0,
    modTime: '',
    children,
  }) as FileEntry;

const file = (p: string): FileEntry =>
  ({
    name: p.split('/').pop()!,
    path: p,
    isDir: false,
    size: 0,
    modTime: '',
    children: undefined,
  }) as FileEntry;

describe('flattenVisibleTree', () => {
  it('canExpand: unloaded dir true, loaded-empty false', () => {
    const rows = flattenVisibleTree({
      roots: [dir('/r/a'), dir('/r/b', [])],
      expandedPaths: new Set(),
      selectedPath: null,
      isRootExpanded: true,
      rootLabel: 'r',
      rootPath: '/r',
    });
    const a = rows.find((r) => r.key === '/r/a')!;
    const b = rows.find((r) => r.key === '/r/b')!;
    expect(a.canExpand).toBe(true); // children === undefined
    expect(b.canExpand).toBe(false); // children === []
  });

  it('canExpand: dir with children true', () => {
    const rows = flattenVisibleTree({
      roots: [dir('/r/a', [file('/r/a/f.ts')])],
      expandedPaths: new Set(),
      selectedPath: null,
      isRootExpanded: true,
      rootLabel: 'r',
      rootPath: '/r',
    });
    const a = rows.find((r) => r.key === '/r/a')!;
    expect(a.canExpand).toBe(true);
  });

  it('canExpand: file is always false', () => {
    const rows = flattenVisibleTree({
      roots: [file('/r/f.ts')],
      expandedPaths: new Set(),
      selectedPath: null,
      isRootExpanded: true,
      rootLabel: 'r',
      rootPath: '/r',
    });
    const f = rows.find((r) => r.key === '/r/f.ts')!;
    expect(f.canExpand).toBe(false);
  });

  it('root row always canExpand', () => {
    const rows = flattenVisibleTree({
      roots: [],
      expandedPaths: new Set(),
      selectedPath: null,
      isRootExpanded: true,
      rootLabel: 'r',
      rootPath: '/r',
    });
    expect(rows[0].canExpand).toBe(true);
  });
});

// #450: the Show hidden folders toggle filters dot-folders before anything
// counts or reasons about rows; the stored tree keeps them.
describe('flattenVisibleTree with hidden folders hidden', () => {
  const roots = [
    dir('/r/.github', [file('/r/.github/ci.yml')]),
    dir('/r/src', [dir('/r/src/.cache', []), file('/r/src/a.ts')]),
    dir('/r/only-hidden', [dir('/r/only-hidden/.venv', [])]),
    file('/r/.env'),
  ];
  const flatten = (showHiddenFolders?: boolean) =>
    flattenVisibleTree({
      roots,
      expandedPaths: new Set(['/r/.github', '/r/src', '/r/only-hidden']),
      selectedPath: null,
      isRootExpanded: true,
      rootLabel: 'r',
      rootPath: '/r',
      showHiddenFolders,
    });

  it('shows dot-folders by default', () => {
    const keys = flatten().map((r) => r.key);
    expect(keys).toContain('/r/.github');
    expect(keys).toContain('/r/.github/ci.yml');
    expect(keys).toContain('/r/src/.cache');
  });

  it('leaves out dot-folders and their contents at every depth, keeping dot-files', () => {
    const rows = flatten(false);
    expect(rows.map((r) => r.key)).toEqual([
      '__root__',
      '/r/src',
      '/r/src/a.ts',
      '/r/only-hidden',
      '/r/.env',
    ]);
    const src = rows.find((r) => r.key === '/r/src')!;
    expect([src.posInSet, src.setSize]).toEqual([1, 3]);
    const a = rows.find((r) => r.key === '/r/src/a.ts')!;
    expect([a.posInSet, a.setSize]).toEqual([1, 1]);
    // Loaded, and nothing in it is shown: no chevron.
    expect(rows.find((r) => r.key === '/r/only-hidden')!.canExpand).toBe(false);
    expect(roots[0].children).toHaveLength(1);
  });
});

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

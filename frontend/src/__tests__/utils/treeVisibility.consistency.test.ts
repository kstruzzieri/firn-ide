/**
 * Consistency: isDirVisible(path, state) must return true IFF path appears as
 * a 'entry' dir row in flattenVisibleTree with the same state.
 *
 * Tree under /r:
 *   /r/a
 *   /r/a/b
 *   /r/a/b/c
 *   /r/a/d
 *   /r/e
 *   /r/e/f
 */
import { isDirVisible } from '../../utils/treeVisibility';
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

// Fixed tree (all children loaded so canExpand is accurate)
const roots: FileEntry[] = [
  dir('/r/a', [dir('/r/a/b', [dir('/r/a/b/c', [])]), dir('/r/a/d', [])]),
  dir('/r/e', [dir('/r/e/f', [])]),
];

const ALL_DIR_PATHS = ['/r/a', '/r/a/b', '/r/a/b/c', '/r/a/d', '/r/e', '/r/e/f'];
const ROOT = '/r';

function flatDirPaths(expandedPaths: Set<string>, isRootExpanded: boolean): Set<string> {
  const rows = flattenVisibleTree({
    roots,
    expandedPaths,
    selectedPath: null,
    isRootExpanded,
    rootLabel: 'r',
    rootPath: ROOT,
  });
  return new Set(rows.filter((r) => r.kind === 'entry' && r.isDir).map((r) => r.key));
}

function assertConsistency(
  label: string,
  expandedPaths: Set<string>,
  isRootExpanded: boolean
): void {
  const state = { rootPath: ROOT, isRootExpanded, expandedPaths };
  const flatSet = flatDirPaths(expandedPaths, isRootExpanded);

  for (const p of ALL_DIR_PATHS) {
    const visible = isDirVisible(p, state);
    const inFlat = flatSet.has(p);
    expect({ path: p, scenario: label, isDirVisible: visible }).toEqual({
      path: p,
      scenario: label,
      isDirVisible: inFlat,
    });
  }
}

describe('isDirVisible mirrors flattenVisibleTree — consistency', () => {
  it('scenario: root collapsed — nothing visible', () => {
    assertConsistency('root-collapsed', new Set(['/r/a', '/r/a/b', '/r/e']), false);
  });

  it('scenario: root expanded, nothing else — only top-level dirs', () => {
    assertConsistency('nothing-expanded', new Set(), true);
  });

  it('scenario: root expanded + /r/a expanded — shows /r/a/b and /r/a/d but not deeper', () => {
    assertConsistency('a-expanded', new Set(['/r/a']), true);
  });

  it('scenario: root expanded + /r/a + /r/a/b expanded — shows /r/a/b/c', () => {
    assertConsistency('a-and-b-expanded', new Set(['/r/a', '/r/a/b']), true);
  });

  it('scenario: all expanded', () => {
    assertConsistency(
      'all-expanded',
      new Set(['/r/a', '/r/a/b', '/r/a/b/c', '/r/a/d', '/r/e', '/r/e/f']),
      true
    );
  });

  it('scenario: /r/e expanded without /r/a — only /r/e/f added', () => {
    assertConsistency('e-only-expanded', new Set(['/r/e']), true);
  });
});

// src/utils/flattenTree.ts
import type { FileEntry, WorkspaceAccent } from '../stores/ideStore';

/** Stable key for the synthetic root row (index 0 of every flat list). */
export const ROOT_ROW_KEY = '__root__';

export interface FlatRow {
  kind: 'root' | 'entry';
  /** Stable identity: entry.path for entries, ROOT_ROW_KEY for the root. */
  key: string;
  /** Indentation depth. Root = 0, top-level entries = 1. */
  depth: number;
  /** aria-level (1-based): root = 1, top-level entries = 2. */
  level: number;
  isDir: boolean;
  /** Dir: in expandedPaths (root: isRootExpanded). Files: false. */
  isExpanded: boolean;
  isSelected: boolean;
  /** Precomputed once here, not per render. */
  regionAccent: WorkspaceAccent | null;
  /** Sibling-group size for aria-setsize. */
  setSize: number;
  /** 1-based index within the sibling group for aria-posinset. */
  posInSet: number;
  /** Display label: entry.name, or rootLabel for the root row. */
  name: string;
  /** Present for entries only. */
  entry?: FileEntry;
  /** Present for the root row only (for the dimmed path label). */
  rootPath?: string;
}

export interface FlattenOptions {
  roots: FileEntry[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  getRegionAccent?: (entry: FileEntry) => WorkspaceAccent | null;
  isRootExpanded: boolean;
  rootLabel: string;
  rootPath: string;
}

/**
 * Flattens the *visible* (expanded) tree into a pre-order row array. Walks only
 * expanded branches and precomputes per-row presentation + a11y data so the row
 * component can be memoized on primitives and the region resolver runs once per
 * visible row instead of per node per render.
 */
export function flattenVisibleTree(opts: FlattenOptions): FlatRow[] {
  const {
    roots,
    expandedPaths,
    selectedPath,
    getRegionAccent,
    isRootExpanded,
    rootLabel,
    rootPath,
  } = opts;

  const rows: FlatRow[] = [
    {
      kind: 'root',
      key: ROOT_ROW_KEY,
      depth: 0,
      level: 1,
      isDir: true,
      isExpanded: isRootExpanded,
      isSelected: false,
      regionAccent: null,
      setSize: 1,
      posInSet: 1,
      name: rootLabel,
      rootPath,
    },
  ];

  if (!isRootExpanded) return rows;

  const walk = (entries: FileEntry[], depth: number): void => {
    const setSize = entries.length;
    entries.forEach((entry, index) => {
      const isDir = entry.isDir;
      const isExpanded = isDir && expandedPaths.has(entry.path);
      rows.push({
        kind: 'entry',
        key: entry.path,
        depth,
        level: depth + 1,
        isDir,
        isExpanded,
        isSelected: selectedPath === entry.path,
        regionAccent: getRegionAccent?.(entry) ?? null,
        setSize,
        posInSet: index + 1,
        name: entry.name,
        entry,
      });
      if (isExpanded && entry.children) {
        walk(entry.children, depth + 1);
      }
    });
  };

  walk(roots, 1);
  return rows;
}

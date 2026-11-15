import { pathUnderRoot, relativePathFromRoot } from './workspaceRegions';

export interface VisibilityState {
  rootPath: string;
  isRootExpanded: boolean;
  expandedPaths: Set<string>;
}

/**
 * Whether the directory at `path` would appear as a row in the flattened tree:
 * the root must be expanded, `path` must be under `rootPath`, and every ancestor
 * directory between the root and `path` must be in `expandedPaths`. Mirrors the
 * walk in flattenVisibleTree.
 */
export function isDirVisible(path: string, state: VisibilityState): boolean {
  const { rootPath, isRootExpanded, expandedPaths } = state;
  if (!isRootExpanded) return false;
  const rel = relativePathFromRoot(path, rootPath);
  if (rel === null) return false;
  if (rel === '') return true;

  const segments = rel.split('/');
  // Every ancestor dir (root + intermediate dirs), excluding `path` itself, must be expanded.
  // ponytail: O(depth²) joins; depth is bounded by filesystem nesting, no optimization needed
  for (let i = 1; i < segments.length; i++) {
    if (!expandedPaths.has(pathUnderRoot(rootPath, segments.slice(0, i).join('/')))) return false;
  }
  return true;
}

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
  if (path === rootPath) return true;
  if (!path.startsWith(rootPath + '/')) return false;

  const rel = path.slice(rootPath.length + 1);
  const segments = rel.split('/');
  // Every ancestor dir (root + intermediate dirs), excluding `path` itself, must be expanded.
  // ponytail: O(depth) walk; depth is bounded by filesystem nesting, no optimization needed
  let cursor = rootPath;
  for (let i = 0; i < segments.length - 1; i++) {
    cursor += '/' + segments[i];
    if (!expandedPaths.has(cursor)) return false;
  }
  return true;
}

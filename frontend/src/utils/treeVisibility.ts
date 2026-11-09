import { isHiddenFolderName } from './hiddenFolders';
import { pathUnderRoot, relativePathFromRoot } from './workspaceRegions';

export interface VisibilityState {
  rootPath: string;
  isRootExpanded: boolean;
  expandedPaths: Set<string>;
  /** False hides every dot-folder and what is under it (#450). Default true. */
  showHiddenFolders?: boolean;
}

/**
 * Whether the directory at `path` would appear as a row in the flattened tree:
 * the root must be expanded, `path` must be under `rootPath`, and every ancestor
 * directory between the root and `path` must be in `expandedPaths`, and, with
 * hidden folders hidden, no folder from the root down to `path` may be a
 * dot-folder. Mirrors the walk in flattenVisibleTree.
 */
export function isDirVisible(path: string, state: VisibilityState): boolean {
  const { rootPath, isRootExpanded, expandedPaths } = state;
  if (!isRootExpanded) return false;
  const rel = relativePathFromRoot(path, rootPath);
  if (rel === null) return false;
  if (rel === '') return true;

  const segments = rel.split('/');
  if (state.showHiddenFolders === false && segments.some(isHiddenFolderName)) return false;
  // Every ancestor dir (root + intermediate dirs), excluding `path` itself, must be expanded.
  // ponytail: O(depth²) joins; depth is bounded by filesystem nesting, no optimization needed
  for (let i = 1; i < segments.length; i++) {
    if (!expandedPaths.has(pathUnderRoot(rootPath, segments.slice(0, i).join('/')))) return false;
  }
  return true;
}

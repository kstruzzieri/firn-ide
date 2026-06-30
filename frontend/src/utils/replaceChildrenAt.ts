import type { FileEntry } from '../stores/ideStore';

/**
 * Returns a new tree where the node at `targetPath` has `children` set, with
 * structural sharing: only nodes on the path from a root to the target are
 * recreated; all other subtrees keep their identity (so memoized consumers and
 * the virtualizer skip untouched branches). Returns the input array unchanged
 * if `targetPath` is not present.
 */
export function replaceChildrenAt(
  nodes: FileEntry[],
  targetPath: string,
  children: FileEntry[]
): FileEntry[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.path === targetPath) {
      changed = true;
      return { ...node, children } as FileEntry;
    }
    if (node.isDir && node.children && isAncestorPath(node.path, targetPath)) {
      const newChildren = replaceChildrenAt(node.children, targetPath, children);
      if (newChildren !== node.children) {
        changed = true;
        return { ...node, children: newChildren } as FileEntry;
      }
    }
    return node;
  });
  return changed ? next : nodes;
}

/** True if `ancestor` is a path-prefix segment-boundary parent of `descendant`. */
function isAncestorPath(ancestor: string, descendant: string): boolean {
  return descendant === ancestor || descendant.startsWith(ancestor + '/');
}

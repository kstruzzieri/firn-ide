import type { FileEntry } from '../stores/ideStore';
import { treePathKey } from './workspaceRegions';

/** Returns the FileEntry at absolute `path`, or null. Prunes by path prefix. */
export function findEntryByPath(nodes: FileEntry[], path: string): FileEntry | null {
  for (const node of nodes) {
    if (samePath(node.path, path)) return node;
    if (node.children && isAncestorPath(node.path, path)) {
      const hit = findEntryByPath(node.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

function isAncestorPath(ancestor: string, descendant: string): boolean {
  const normalizedAncestor = treePathKey(ancestor);
  const normalizedDescendant = treePathKey(descendant);
  return (
    normalizedDescendant === normalizedAncestor ||
    normalizedDescendant.startsWith(`${normalizedAncestor}/`)
  );
}

function samePath(a: string, b: string): boolean {
  return treePathKey(a) === treePathKey(b);
}

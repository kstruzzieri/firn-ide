import type { FileEntry } from '../stores/ideStore';
import { normalizePathForComparison } from './lspUri';

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
  const normalizedAncestor = normalizePathForComparison(ancestor);
  const normalizedDescendant = normalizePathForComparison(descendant);
  return (
    normalizedDescendant === normalizedAncestor ||
    normalizedDescendant.startsWith(`${normalizedAncestor}/`)
  );
}

function samePath(a: string, b: string): boolean {
  return normalizePathForComparison(a) === normalizePathForComparison(b);
}

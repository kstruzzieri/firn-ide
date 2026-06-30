import type { FileEntry } from '../stores/ideStore';

/** Returns the FileEntry at absolute `path`, or null. Prunes by path prefix. */
export function findEntryByPath(nodes: FileEntry[], path: string): FileEntry | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children && (path === node.path || path.startsWith(node.path + '/'))) {
      const hit = findEntryByPath(node.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

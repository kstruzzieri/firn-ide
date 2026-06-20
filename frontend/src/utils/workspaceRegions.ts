import { normalizePathForComparison } from './lspUri';

/**
 * Repo-relative, forward-slash path for `absPath` under `repoRoot`.
 * Returns '' for the repo root itself, and null for paths outside the root.
 *
 * Uses normalizePathForComparison (from lspUri) so containment checks share the
 * same cross-platform semantics as the rest of the app: backslashes are
 * converted to forward slashes and Windows drive-letter paths compare
 * case-insensitively. The returned slice preserves the original case.
 */
export function relativePathFromRoot(absPath: string, repoRoot: string): string | null {
  if (!absPath || !repoRoot) return null;

  const toFwd = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const path = toFwd(absPath);
  const root = toFwd(repoRoot);

  const cmpPath = normalizePathForComparison(path);
  const cmpRoot = normalizePathForComparison(root);

  if (cmpPath === cmpRoot) return '';
  if (cmpPath.startsWith(cmpRoot + '/')) {
    // normalizePathForComparison preserves length, so slicing the original
    // forward-slashed path by the root length yields the correct-case suffix.
    return path.slice(root.length + 1);
  }
  return null;
}

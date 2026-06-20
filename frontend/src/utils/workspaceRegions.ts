import { normalizePathForComparison } from './lspUri';
import type { WorkspaceAccent, FileEntry } from '../stores/ideStore';
import type { workspace } from '../../wailsjs/go/models';

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

/**
 * Project-View tinting of LOOSE ROOT FILES only. Workspace *directory*
 * classification stays backend-owned (internal/workspace/detect.go markerRules).
 * Keep this intentionally tiny — it only colors loose/root files, it does not
 * classify workspaces.
 */
const rootFileAccentRules: {
  exact: Record<string, WorkspaceAccent>;
  suffix: ReadonlyArray<{ ext: string; accent: WorkspaceAccent }>;
} = {
  exact: {
    'docker-compose.yml': 'purple',
    'docker-compose.yaml': 'purple',
    Dockerfile: 'purple',
  },
  suffix: [
    { ext: '.tf', accent: 'purple' },
    { ext: '.tfvars', accent: 'purple' },
  ],
};

/**
 * Builds a per-entry accent resolver for Project View region tinting. Call once
 * per (repoRoot, workspaces) identity and reuse across all rows.
 *
 * Rules (in order):
 *  1. Longest segment-safe non-empty relDir prefix wins → that workspace accent.
 *  2. Root workspaces (relDir === "") contribute no ambient region tint.
 *  3. Loose root file (not a dir, no path separator) → rootFileAccentRules.
 *  4. Otherwise null.
 */
export function createRegionAccentResolver(
  repoRoot: string,
  workspaces: workspace.WorkspaceDef[]
): (entry: FileEntry) => WorkspaceAccent | null {
  const regions = workspaces
    .filter((w) => w.id !== 'project' && w.relDir !== '')
    .map((w) => ({ relDir: w.relDir, accent: w.accent as WorkspaceAccent }))
    .sort((a, b) => b.relDir.length - a.relDir.length);

  return (entry: FileEntry): WorkspaceAccent | null => {
    const rel = relativePathFromRoot(entry.path, repoRoot);
    if (rel === null) return null;

    for (const region of regions) {
      if (rel === region.relDir || rel.startsWith(region.relDir + '/')) {
        return region.accent;
      }
    }

    if (!entry.isDir && !rel.includes('/')) {
      const exact = rootFileAccentRules.exact[entry.name];
      if (exact) return exact;
      const suf = rootFileAccentRules.suffix.find((s) => entry.name.endsWith(s.ext));
      if (suf) return suf.accent;
    }
    return null;
  };
}

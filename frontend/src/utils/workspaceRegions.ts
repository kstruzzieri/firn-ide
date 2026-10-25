import { normalizePathForComparison } from './lspUri';
import type { WorkspaceAccent, FileEntry } from '../stores/ideStore';
import type { workspace } from '../wails/bindings';

/**
 * True when `root` is spelled as a Windows path: a drive letter (`C:\`, `c:/`)
 * or a UNC share (`\\server\share`, `//server/share`). Only these read a
 * backslash as a separator; on macOS and Linux it is an ordinary name character.
 */
export function isWindowsPathSyntax(root: string): boolean {
  return /^[a-z]:[\\/]|^\\\\|^\/\//i.test(root);
}

/**
 * The form tree lookups compare `path` in: a Windows path through
 * normalizePathForComparison (either separator, drive-letter case), any other
 * path as it is, so a POSIX folder `a\b` is not its twin `a/b` (#447).
 */
export function treePathKey(path: string): string {
  return isWindowsPathSyntax(path) ? normalizePathForComparison(path) : path;
}

/**
 * Repo-relative, forward-slash path for `absPath` under `repoRoot`.
 * Returns '' for the repo root itself, and null for paths outside the root.
 *
 * Paths are read in the root's syntax (#447). Under a Windows root (a drive
 * letter or UNC share) containment uses normalizePathForComparison, so
 * backslashes are separators and drive-letter case folds; the trailing slash
 * is stripped only after that, so the drive root `C:\` contains `c:\src`.
 * Under a POSIX root a backslash is part of a name and stays in the result.
 * The returned slice preserves the original case.
 */
export function relativePathFromRoot(absPath: string, repoRoot: string): string | null {
  if (!absPath || !repoRoot) return null;

  const windows = isWindowsPathSyntax(repoRoot);
  // Repeated separators count as one; a leading pair (a UNC prefix) stays.
  const trim = (p: string): string => p.replace(/([^/])\/{2,}/g, '$1/').replace(/\/+$/, '');
  const compare = (p: string): string => trim(windows ? normalizePathForComparison(p) : p);
  const cmpPath = compare(absPath);
  const cmpRoot = compare(repoRoot);

  if (cmpPath === cmpRoot) return '';
  if (!cmpPath.startsWith(cmpRoot + '/')) return null;
  // Take the original path's segments past the root, counted rather than
  // measured: lowercasing can lengthen a name (İ) and normalizing drops a
  // URI-form path's leading slash, but neither adds or removes a separator.
  const depth = cmpPath.split('/').length - cmpRoot.split('/').length;
  const path = trim(windows ? absPath.replace(/\\/g, '/') : absPath);
  return path.split('/').slice(-depth).join('/');
}

/**
 * Absolute path of the forward-slash `relPath` under `root`, spelled in the
 * root's syntax: the inverse of relativePathFromRoot. A Windows root written
 * with backslashes joins with backslashes, and a drive root's slash is not
 * doubled (`C:\` and `src` give `C:\src`). An empty `relPath` is the root.
 */
export function pathUnderRoot(root: string, relPath: string): string {
  if (!relPath) return root;
  const windows = isWindowsPathSyntax(root);
  const separator = windows && root.includes('\\') ? '\\' : '/';
  const base = root.replace(windows ? /[\\/]+$/ : /\/+$/, '');
  return `${base}${separator}${relPath.split('/').join(separator)}`;
}

/**
 * The directory levels to (re)load so every path in `paths` is reachable from
 * `root`: the root first, then each path's ancestors under the root and the
 * paths themselves, grouped by depth. Reading one level at a time keeps every
 * parent loaded before its children get merged. Paths outside the root are
 * dropped; duplicates (case-insensitive on drive-letter paths) collapse into
 * the first spelling seen. Ancestors are spelled with the separators of the
 * path they came from, so they match what the backend reports for the tree.
 * Only Windows roots treat backslashes as separators; POSIX names retain them.
 */
export function treeLoadLevels(root: string, paths: Iterable<string>): string[][] {
  const levels: string[][] = [[root]];
  const seen = new Set<string>();
  const windows = isWindowsPathSyntax(root);
  const compare = (path: string) => (windows ? normalizePathForComparison(path) : path);
  const rootKey = compare(root).replace(/\/+$/, '');
  for (const path of paths) {
    const pathKey = compare(path).replace(/\/+$/, '');
    if (!pathKey.startsWith(`${rootKey}/`)) continue;
    const rel = pathKey.slice(rootKey.length + 1);
    const abs = path.replace(windows ? /[\\/]+$/ : /\/+$/, '');
    const separator = windows && abs.includes('\\') ? '\\' : '/';
    const parts = windows ? abs.split(/[\\/]/) : abs.split('/');
    const depth = rel.split('/').length;
    for (let level = 1; level <= depth; level++) {
      const ancestor = parts.slice(0, parts.length - (depth - level)).join(separator);
      const key = compare(ancestor);
      if (seen.has(key)) continue;
      seen.add(key);
      (levels[level] ??= []).push(ancestor);
    }
  }
  // No holes: a path at depth d pushes every level 1..d on its way down.
  return levels;
}

function orderedWorkspaces(workspaces: workspace.WorkspaceDef[]): workspace.WorkspaceDef[] {
  return workspaces
    .filter((candidate) => candidate.id !== 'project')
    .sort((a, b) => b.relDir.length - a.relDir.length);
}

function resolveRelativeWorkspace(
  relPath: string,
  workspaces: workspace.WorkspaceDef[]
): workspace.WorkspaceDef | null {
  return (
    workspaces.find(
      (candidate) =>
        candidate.relDir === '' ||
        relPath === candidate.relDir ||
        relPath.startsWith(candidate.relDir + '/')
    ) ?? null
  );
}

/** Builds a segment-safe, longest-prefix resolver for file workspace ownership. */
export function createWorkspacePathResolver(
  repoRoot: string,
  workspaces: workspace.WorkspaceDef[]
): (absPath: string) => workspace.WorkspaceDef | null {
  const ordered = orderedWorkspaces(workspaces);

  return (absPath: string): workspace.WorkspaceDef | null => {
    const rel = relativePathFromRoot(absPath, repoRoot);
    return rel === null ? null : resolveRelativeWorkspace(rel, ordered);
  };
}

// Exact, case-sensitive Docker filenames. Includes both the legacy
// `docker-compose.*` and the Compose-Spec canonical `compose.*` names.
// ponytail: exact-match only — override/env compose variants
// (docker-compose.prod.yml, compose.override.yaml) are intentionally not
// matched; add pattern matching only if a concrete need appears.
const DOCKER_FILE_NAMES = new Set([
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.dockerignore',
]);

/** Fixed file-type accent for Docker and Terraform files at any tree depth. */
export function getInfraFileAccent(
  entry: Pick<FileEntry, 'name' | 'isDir'>
): WorkspaceAccent | null {
  if (entry.isDir) return null;
  if (DOCKER_FILE_NAMES.has(entry.name)) return 'docker';
  return entry.name.endsWith('.tf') || entry.name.endsWith('.tfvars') ? 'terraform' : null;
}

/**
 * Builds a per-entry accent resolver for Project View region tinting. Call once
 * per (repoRoot, workspaces) identity and reuse across all rows.
 *
 * Rules (in order):
 *  1. Longest segment-safe non-empty relDir prefix wins → that workspace accent.
 *  2. Root workspaces (relDir === "") contribute no ambient region tint.
 *  3. Loose root file (not a dir, no path separator) → getInfraFileAccent.
 *  4. Otherwise null.
 */
export function createRegionAccentResolver(
  repoRoot: string,
  workspaces: workspace.WorkspaceDef[]
): (entry: FileEntry) => WorkspaceAccent | null {
  const ordered = orderedWorkspaces(workspaces);

  return (entry: FileEntry): WorkspaceAccent | null => {
    const rel = relativePathFromRoot(entry.path, repoRoot);
    if (rel === null) return null;

    const owner = resolveRelativeWorkspace(rel, ordered);
    if (owner?.relDir) return owner.accent as WorkspaceAccent;

    if (!entry.isDir && !rel.includes('/')) {
      return getInfraFileAccent(entry);
    }
    return null;
  };
}

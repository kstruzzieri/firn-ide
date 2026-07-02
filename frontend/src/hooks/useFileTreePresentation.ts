import { useMemo } from 'react';
import {
  useWorkspace,
  useWorkspaces,
  useActiveWorkspace,
  useDirectoryTree,
  useTreeViewMode,
  useCanFocusWorkspace,
} from '../stores/ideStore';
import type { FileEntry, WorkspaceAccent } from '../stores/ideStore';
import { createRegionAccentResolver, relativePathFromRoot } from '../utils/workspaceRegions';

export interface FileTreePresentation {
  mode: 'project' | 'workspace';
  canFocusWorkspace: boolean;
  /** Repo name (project) or workspace name (workspace). */
  rootLabel: string;
  /** Repo root (project) or workspace dir absolute path (workspace). */
  rootPath: string;
  /** Top-level entries to render as tree roots. */
  roots: FileEntry[];
  /** True when a workspace's relDir cannot be located in the loaded tree. */
  scopedError: boolean;
  /**
   * Per-entry tint resolver. Project View → per-region multi-color resolver.
   * Workspace View → uniform resolver returning the active workspace accent.
   */
  getRegionAccent?: (entry: FileEntry) => WorkspaceAccent | null;
  /**
   * Active workspace accent, used for the Workspace-View left rail. Undefined in
   * Project View (regions are multi-color) and when the workspace has no accent.
   */
  treeAccent?: WorkspaceAccent;
}

/**
 * Finds the directory node whose normalized repo-relative path equals `relDir`.
 * This uses the same helper as region tinting so Workspace View scoping has the
 * same segment-safe containment and Windows/backslash behavior.
 */
function findScopedNode(tree: FileEntry[], repoRoot: string, relDir: string): FileEntry | null {
  for (const entry of tree) {
    if (entry.isDir && relativePathFromRoot(entry.path, repoRoot) === relDir) {
      return entry;
    }
    const childMatch = entry.children ? findScopedNode(entry.children, repoRoot, relDir) : null;
    if (childMatch) {
      return childMatch;
    }
  }
  return null;
}

export function useFileTreePresentation(): FileTreePresentation {
  const repo = useWorkspace();
  const workspaces = useWorkspaces();
  const active = useActiveWorkspace();
  const tree = useDirectoryTree();
  const mode = useTreeViewMode();
  const canFocusWorkspace = useCanFocusWorkspace();

  const repoRoot = repo?.path ?? '';
  const repoName = repo?.name ?? '';

  const getRegionAccent = useMemo(
    () => (mode === 'project' ? createRegionAccentResolver(repoRoot, workspaces) : undefined),
    [mode, repoRoot, workspaces]
  );

  return useMemo<FileTreePresentation>(() => {
    const base = { mode, canFocusWorkspace };

    if (mode === 'project') {
      return {
        ...base,
        rootLabel: repoName,
        rootPath: repoRoot,
        roots: tree,
        scopedError: false,
        getRegionAccent,
      };
    }

    const relDir = active?.relDir ?? '';
    const workspaceLabel = active?.name ?? repoName;
    // Workspace View washes the whole scoped tree in the active workspace's
    // accent (uniform), reinforcing which workspace the files belong to.
    const treeAccent = (active?.accent as WorkspaceAccent) || undefined;
    const workspaceResolver = treeAccent ? () => treeAccent : undefined;

    if (relDir === '') {
      return {
        ...base,
        rootLabel: workspaceLabel,
        rootPath: repoRoot,
        roots: tree,
        scopedError: false,
        getRegionAccent: workspaceResolver,
        treeAccent,
      };
    }

    const scoped = findScopedNode(tree, repoRoot, relDir);
    const scopedUnloaded = scoped !== null && scoped.children === undefined;
    return {
      ...base,
      rootLabel: workspaceLabel,
      rootPath: scoped?.path ?? `${repoRoot}/${relDir}`,
      roots: scoped?.children ?? [],
      scopedError: scoped === null || scopedUnloaded,
      getRegionAccent: workspaceResolver,
      treeAccent,
    };
  }, [mode, canFocusWorkspace, repoName, repoRoot, tree, active, getRegionAccent]);
}

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
import type { workspace } from '../../wailsjs/go/models';
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
  /** Non-project workspaces, for the Workspace-View tab strip. */
  tabs: workspace.WorkspaceDef[];
  /** Region tint resolver — present only in Project View. */
  getRegionAccent?: (entry: FileEntry) => WorkspaceAccent | null;
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

  const tabs = useMemo(() => workspaces.filter((w) => w.id !== 'project'), [workspaces]);

  const getRegionAccent = useMemo(
    () => (mode === 'project' ? createRegionAccentResolver(repoRoot, workspaces) : undefined),
    [mode, repoRoot, workspaces]
  );

  return useMemo<FileTreePresentation>(() => {
    const base = { mode, canFocusWorkspace, tabs };

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

    if (relDir === '') {
      return {
        ...base,
        rootLabel: workspaceLabel,
        rootPath: repoRoot,
        roots: tree,
        scopedError: false,
        getRegionAccent: undefined,
      };
    }

    const scoped = findScopedNode(tree, repoRoot, relDir);
    return {
      ...base,
      rootLabel: workspaceLabel,
      rootPath: scoped?.path ?? `${repoRoot}/${relDir}`,
      roots: scoped?.children ?? [],
      scopedError: scoped === null,
      getRegionAccent: undefined,
    };
  }, [mode, canFocusWorkspace, tabs, repoName, repoRoot, tree, active, getRegionAccent]);
}

import { useCallback } from 'react';
import { ReadDirectoryShallow } from '../wails/bindings';
import { useIDEStore } from '../stores/ideStore';
import type { WorkspaceInfo, FileEntry } from '../stores/ideStore';
import { pathsReferToSameFile, getFileNameFromPath } from '../utils/lspUri';
import { findEntryByPath } from '../utils/findEntryByPath';
import { treeLoadLevels } from '../utils/workspaceRegions';

interface InFlightLoad {
  workspace: WorkspaceInfo;
  promise: Promise<void>;
}

const inFlight = new Map<string, InFlightLoad>();

/** TEST-ONLY: clear the in-flight cache between tests. */
export function __resetEnsurePathLoaded(): void {
  inFlight.clear();
}

interface EnsureOpts {
  force?: boolean;
}

/**
 * Loads a directory's immediate children if not already loaded. Idempotent and
 * deduped across concurrent callers. `force` re-fetches even if loaded (watcher
 * reconcile uses this for dirty dirs). Failures clear loading + mark the dir
 * dirty and surface a toast — they never replace the whole explorer via setTreeError.
 * Only the first failure of a clean path toasts; automatic retries (watcher,
 * reveal) of an already-dirty path keep the row marker without re-toasting, and
 * a node removed from the tree mid-flight is not annotated at all.
 *
 * ponytail: non-async so callers get the exact same Promise object (referential
 * equality) on concurrent calls — async wrapper would create a fresh Promise each time.
 */
export function ensurePathLoaded(path: string, opts: EnsureOpts = {}): Promise<void> {
  const store = useIDEStore.getState();
  const workspace = store.workspace;
  if (!workspace) return Promise.resolve();
  const root = workspace.path;
  const isRoot = pathsReferToSameFile(path, root);

  if (!opts.force) {
    const node = isRoot
      ? { children: store.directoryTree, unreadable: false }
      : findEntryByPath(store.directoryTree, path);
    const alreadyLoaded =
      node?.children !== undefined && !node.unreadable && !store.dirtyPaths.has(path);
    if (alreadyLoaded) return Promise.resolve();
  }

  const existing = inFlight.get(path);
  // ponytail: a {force:true} call arriving while a non-force load is in flight piggybacks on it — harmless, since the in-flight load fetches the same fresh data.
  if (existing?.workspace === workspace) return existing.promise;

  // Distinguishes "removed from the tree mid-flight" (skip all annotations)
  // from "probed before its parent loaded" (reveal/hydration still need the
  // dirty flag as their abort signal).
  const existedBefore = isRoot || Boolean(findEntryByPath(store.directoryTree, path));

  useIDEStore.getState().addLoadingPath(path);
  const promise = Promise.resolve()
    .then(() => ReadDirectoryShallow(path, root))
    .then((children) => {
      const after = useIDEStore.getState();
      if (after.workspace !== workspace) return; // stale workspace — drop
      after.mergeChildren(path, children);
      after.clearDirty(path);
    })
    .catch(() => {
      const after = useIDEStore.getState();
      if (after.workspace !== workspace) return;
      const node = isRoot ? null : findEntryByPath(after.directoryTree, path);
      if (!isRoot && existedBefore && !node) return; // removed mid-flight — nothing to annotate
      if (node) after.markUnreadable(path);
      const alreadyDirty = after.dirtyPaths.has(path);
      after.markDirty(path);
      if (!alreadyDirty) {
        after.showToast(`Failed to load ${getFileNameFromPath(path)}`, 'error');
      }
    })
    .finally(() => {
      if (inFlight.get(path)?.promise !== promise) return;
      useIDEStore.getState().removeLoadingPath(path);
      inFlight.delete(path);
    });

  inFlight.set(path, { workspace, promise });
  return promise;
}

/**
 * Reconciles the explorer tree of `root` with disk (#256). A persisted snapshot
 * or the in-memory cache is a display hint, not disk truth, so first every
 * loaded directory is marked dirty: the next expand re-reads it instead of
 * short-circuiting as already loaded. Then the root, each expanded path and
 * their ancestors are force-read level by level (parents before children; one
 * level's reads run concurrently). A path a fresh parent no longer lists as a
 * directory is skipped, not read: it is gone or a file now, which is not a
 * load failure to toast about. `stop` ends the walk early (the workspace
 * changed, the restore was aborted). A read that fails leaves its row marked
 * unreadable and dirty through ensurePathLoaded; since the dirs were just
 * marked dirty, that counts as a retry and does not toast.
 */
export async function reconcileTreeWithDisk(
  root: string,
  expandedPaths: Iterable<string>,
  stop: () => boolean = () => false
): Promise<void> {
  const stale = loadedDirectoryPaths(useIDEStore.getState().directoryTree);
  if (stale.length > 0) {
    useIDEStore.setState((s) => ({ dirtyPaths: new Set([...s.dirtyPaths, ...stale]) }));
  }
  for (const level of treeLoadLevels(root, expandedPaths)) {
    if (stop()) return;
    const tree = useIDEStore.getState().directoryTree;
    const present = level.filter(
      (path) => pathsReferToSameFile(path, root) || findEntryByPath(tree, path)?.isDir === true
    );
    await Promise.all(present.map((path) => ensurePathLoaded(path, { force: true })));
    // The root is dirty after its own read (it failed, or a watcher event on a
    // collapsed root arrived mid-walk): nothing beneath it can be checked
    // against a fresh parent, so stop rather than read against stale ones.
    if (useIDEStore.getState().dirtyPaths.has(root)) return;
  }
}

function loadedDirectoryPaths(nodes: FileEntry[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (!node.isDir || node.children === undefined) continue;
    out.push(node.path);
    out.push(...loadedDirectoryPaths(node.children));
  }
  return out;
}

export function useEnsurePathLoaded(): typeof ensurePathLoaded {
  // ponytail: stable ref — ensurePathLoaded is module-level, deps intentionally empty

  return useCallback((path: string, opts?: EnsureOpts) => ensurePathLoaded(path, opts), []);
}

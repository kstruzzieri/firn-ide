import { useCallback } from 'react';
import { ReadDirectoryShallow } from '../../wailsjs/go/main/App';
import { useIDEStore } from '../stores/ideStore';
import { pathsReferToSameFile, getFileNameFromPath } from '../utils/lspUri';
import { findEntryByPath } from '../utils/findEntryByPath';

const inFlight = new Map<string, Promise<void>>();

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
 *
 * ponytail: non-async so callers get the exact same Promise object (referential
 * equality) on concurrent calls — async wrapper would create a fresh Promise each time.
 */
export function ensurePathLoaded(path: string, opts: EnsureOpts = {}): Promise<void> {
  const store = useIDEStore.getState();
  const root = store.workspace?.path;
  const isRoot = root ? pathsReferToSameFile(path, root) : false;

  if (!opts.force) {
    const node = isRoot
      ? { children: store.directoryTree }
      : findEntryByPath(store.directoryTree, path);
    const alreadyLoaded = node?.children !== undefined && !store.dirtyPaths.has(path);
    if (alreadyLoaded) return Promise.resolve();
  }

  const existing = inFlight.get(path);
  // ponytail: a {force:true} call arriving while a non-force load is in flight piggybacks on it — harmless, since the in-flight load fetches the same fresh data.
  if (existing) return existing;

  const generation = root; // workspace identity captured at start

  const promise = (async () => {
    useIDEStore.getState().addLoadingPath(path);
    try {
      const children = await ReadDirectoryShallow(path);
      const after = useIDEStore.getState();
      if (after.workspace?.path !== generation) return; // stale workspace — drop
      after.mergeChildren(path, children);
      after.clearDirty(path);
    } catch {
      const after = useIDEStore.getState();
      if (after.workspace?.path !== generation) return;
      after.markDirty(path);
      after.showToast(`Failed to load ${getFileNameFromPath(path)}`, 'error');
    } finally {
      useIDEStore.getState().removeLoadingPath(path);
      inFlight.delete(path);
    }
  })();

  inFlight.set(path, promise);
  return promise;
}

export function useEnsurePathLoaded(): typeof ensurePathLoaded {
  // ponytail: stable ref — ensurePathLoaded is module-level, deps intentionally empty

  return useCallback((path: string, opts?: EnsureOpts) => ensurePathLoaded(path, opts), []);
}

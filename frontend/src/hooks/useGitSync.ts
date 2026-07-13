import { useEffect } from 'react';
import { useWorkspace } from '../stores/ideStore';
import { useGitStore } from '../stores/gitStore';

/**
 * Keeps gitStore aligned with the active workspace and the outside world:
 * reset + full refresh on workspace switch, and a debounced refresh when the
 * window regains focus — the watcher ignores .git/, so commits or branch
 * switches made in an external terminal only become visible on refocus.
 * Watcher-driven refreshes are wired in App.handleFileChange alongside the
 * tree reconcile.
 */
export function useGitSync() {
  const workspace = useWorkspace();
  const workspacePath = workspace?.path ?? null;

  useEffect(() => {
    const git = useGitStore.getState();
    git.resetForWorkspace(workspacePath);
    if (workspacePath) {
      void (async () => {
        await git.refresh();
        const next = useGitStore.getState();
        if (next.root !== workspacePath || !next.status?.isRepo) return;
        void next.loadBranches();
        void next.probeAiAvailable();
      })();
    }
  }, [workspacePath]);

  useEffect(() => {
    const onFocus = () => {
      const git = useGitStore.getState();
      if (git.root) git.scheduleRefresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
}

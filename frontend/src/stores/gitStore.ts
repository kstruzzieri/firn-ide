import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import {
  GitStatus,
  GitStage,
  GitUnstage,
  GitCommit,
  GitPull,
  GitPush,
  GitBranches,
  GitCheckout,
  GitCommitMessageAvailable,
  GitGenerateCommitMessage,
} from '../../wailsjs/go/main/App';
import type { git } from '../../wailsjs/go/models';
import { buildStatusByPath, type GitRowStatus } from '../types/git';
import { useIDEStore } from './ideStore';

/** Trailing debounce for watcher-driven refreshes; batches event bursts
 * (branch switches, installs) into one `git status` run. */
export const GIT_REFRESH_DEBOUNCE_MS = 300;

export type GitOp = 'stage' | 'unstage' | 'commit' | 'pull' | 'push' | 'checkout' | 'generate';

interface GitState {
  /** Workspace root git commands run from; null = no workspace. */
  root: string | null;
  status: git.RepoStatus | null;
  /** Absolute path → row decoration, for tree lookups. */
  statusByPath: Record<string, GitRowStatus>;
  branches: string[];
  commitMessage: string;
  isRefreshing: boolean;
  opInFlight: GitOp | null;
  /** Last mutating-op output (e.g. "Already up to date.") for the panel. */
  lastOpOutput: string | null;
  /** Last operation error, shown inline in the panel (conflicts etc.). */
  lastError: string | null;
  aiAvailable: boolean;
  /** Monotonic guard: refreshes started before the last workspace switch
   * must not apply their result. */
  epoch: number;
  /** Bumped when a consumer (status bar) wants the branch popup focused;
   * the git panel watches this like SearchPanel watches focusInputRevision. */
  focusBranchRevision: number;
}

interface GitActions {
  resetForWorkspace: (root: string | null) => void;
  refresh: () => Promise<void>;
  scheduleRefresh: () => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  setCommitMessage: (message: string) => void;
  commit: (amend: boolean) => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  loadBranches: () => Promise<void>;
  checkout: (branch: string, create: boolean) => Promise<void>;
  generateMessage: () => Promise<void>;
  probeAiAvailable: () => Promise<void>;
  requestBranchPopupFocus: () => void;
}

type GitStore = GitState & GitActions;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useGitStore = create<GitStore>()(
  devtools(
    (set, get) => ({
      root: null,
      status: null,
      statusByPath: {},
      branches: [],
      commitMessage: '',
      isRefreshing: false,
      opInFlight: null,
      lastOpOutput: null,
      lastError: null,
      aiAvailable: false,
      epoch: 0,
      focusBranchRevision: 0,

      resetForWorkspace: (root) => {
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        set(
          (state) => ({
            root,
            status: null,
            statusByPath: {},
            branches: [],
            commitMessage: '',
            isRefreshing: false,
            opInFlight: null,
            lastOpOutput: null,
            lastError: null,
            epoch: state.epoch + 1,
          }),
          false,
          'git/resetForWorkspace'
        );
      },

      refresh: async () => {
        const { root, epoch } = get();
        if (!root) return;
        set({ isRefreshing: true }, false, 'git/refreshStart');
        try {
          const status = await GitStatus(root);
          if (get().epoch !== epoch) return; // workspace switched mid-flight
          const statusByPath = status.isRepo
            ? buildStatusByPath(status.repoRoot, status.files ?? [])
            : {};
          set({ status, statusByPath, isRefreshing: false }, false, 'git/refreshDone');
        } catch (err) {
          if (get().epoch !== epoch) return;
          set({ isRefreshing: false }, false, 'git/refreshFailed');
          useIDEStore.getState().showToast(`Git status failed: ${toErrorMessage(err)}`, 'error');
        }
      },

      scheduleRefresh: () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          void get().refresh();
        }, GIT_REFRESH_DEBOUNCE_MS);
      },

      stage: async (paths) => {
        await runOp('stage', get, set, async (root) => {
          await GitStage(root, paths);
          return null;
        });
      },

      unstage: async (paths) => {
        await runOp('unstage', get, set, async (root) => {
          await GitUnstage(root, paths);
          return null;
        });
      },

      setCommitMessage: (commitMessage) => set({ commitMessage }, false, 'git/setCommitMessage'),

      commit: async (amend) => {
        const message = get().commitMessage;
        const ok = await runOp('commit', get, set, (root) => GitCommit(root, message, amend));
        if (ok) set({ commitMessage: '' }, false, 'git/commitClearMessage');
      },

      pull: async () => {
        await runOp('pull', get, set, (root) => GitPull(root));
      },

      push: async () => {
        await runOp('push', get, set, (root) => GitPush(root));
      },

      loadBranches: async () => {
        const { root } = get();
        if (!root) return;
        try {
          const branches = await GitBranches(root);
          set({ branches: branches ?? [] }, false, 'git/loadBranches');
        } catch (err) {
          useIDEStore.getState().showToast(`Git branches failed: ${toErrorMessage(err)}`, 'error');
        }
      },

      checkout: async (branch, create) => {
        const ok = await runOp('checkout', get, set, async (root) => {
          await GitCheckout(root, branch, create);
          return null;
        });
        if (ok) await get().loadBranches();
      },

      generateMessage: async () => {
        await runOp('generate', get, set, async (root) => {
          const message = await GitGenerateCommitMessage(root);
          set({ commitMessage: message }, false, 'git/generatedMessage');
          return null;
        });
      },

      probeAiAvailable: async () => {
        try {
          const aiAvailable = await GitCommitMessageAvailable();
          set({ aiAvailable }, false, 'git/probeAiAvailable');
        } catch {
          set({ aiAvailable: false }, false, 'git/probeAiAvailable');
        }
      },

      requestBranchPopupFocus: () =>
        set(
          (state) => ({ focusBranchRevision: state.focusBranchRevision + 1 }),
          false,
          'git/requestBranchPopupFocus'
        ),
    }),
    { name: 'git-store' }
  )
);

/**
 * Shared mutating-op wrapper: single-flight via opInFlight, error → lastError
 * + toast, success output → lastOpOutput, always refresh afterwards so the
 * panel reflects reality even after a failed op (a conflicted pull DID change
 * the worktree). Returns whether the op succeeded.
 */
async function runOp(
  op: GitOp,
  get: () => GitStore,
  set: (partial: Partial<GitState>, replace: false, name: string) => void,
  fn: (root: string) => Promise<string | null>
): Promise<boolean> {
  const { root, opInFlight } = get();
  if (!root || opInFlight) return false;
  set({ opInFlight: op, lastError: null, lastOpOutput: null }, false, `git/${op}Start`);
  try {
    const output = await fn(root);
    set({ opInFlight: null, lastOpOutput: output }, false, `git/${op}Done`);
    return true;
  } catch (err) {
    const message = toErrorMessage(err);
    set({ opInFlight: null, lastError: message }, false, `git/${op}Failed`);
    useIDEStore.getState().showToast(`Git ${op} failed: ${message}`, 'error');
    return false;
  } finally {
    void get().refresh();
  }
}

export const useGitStatusSnapshot = () =>
  useGitStore(
    useShallow((state) => ({
      status: state.status,
      isRefreshing: state.isRefreshing,
      opInFlight: state.opInFlight,
      lastError: state.lastError,
      lastOpOutput: state.lastOpOutput,
    }))
  );

export const useGitStatusByPath = () => useGitStore((state) => state.statusByPath);
export const useGitBranchInfo = () =>
  useGitStore(
    useShallow((state) => ({
      branch: state.status?.isRepo ? state.status.branch : '',
      ahead: state.status?.ahead ?? 0,
      behind: state.status?.behind ?? 0,
      changedCount: state.status?.files?.length ?? 0,
    }))
  );

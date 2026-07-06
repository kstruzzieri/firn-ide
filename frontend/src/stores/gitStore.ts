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
  GitFileAtRev,
  ReadFile,
} from '../../wailsjs/go/main/App';
import type { git } from '../../wailsjs/go/models';
import {
  buildStatusByPath,
  classifyChange,
  type GitFileChange,
  type GitRowStatus,
} from '../types/git';
import { joinRepoPath } from '../utils/paths';
import { pathsReferToSameFile } from '../utils/lspUri';
import { useIDEStore } from './ideStore';

/** Which pair of revisions a diff shows. Staged rows compare HEAD to the
 * index; unstaged (and untracked) rows compare the index to the worktree. */
export type DiffContext = 'staged' | 'unstaged';

export interface DiffSide {
  label: string;
  content: string;
}

/** One open diff, rendered as a reused preview tab in the editor area. */
export interface DiffSession {
  /** Repo-relative path, used as the tab title. */
  path: string;
  /** Absolute worktree path, for opening the real file from the diff. */
  absPath: string;
  context: DiffContext;
  left: DiffSide;
  right: DiffSide;
  /** Either side is binary → no merge view, show a binary state instead. */
  binary: boolean;
  /** Either side exceeded the diffable size cap. */
  truncated: boolean;
}

/** Friendly post-commit summary shown in the panel instead of raw git output. */
export interface CommitReceipt {
  branch: string;
  hash: string;
  subject: string;
  /** Repo-relative paths that were staged when the commit ran. */
  files: string[];
  /** Raw git output (stats, hook messages) for the collapsible detail. */
  output: string;
}

/** Deep-equality for a diff session, so an unchanged live refresh can keep the
 * same object reference and avoid rebuilding the merge view. */
function sameSession(a: DiffSession | null, b: DiffSession): boolean {
  return (
    a !== null &&
    a.path === b.path &&
    a.context === b.context &&
    a.binary === b.binary &&
    a.truncated === b.truncated &&
    a.left.label === b.left.label &&
    a.left.content === b.left.content &&
    a.right.label === b.right.label &&
    a.right.content === b.right.content
  );
}

/** Parses git's "[branch hash] subject" commit summary line. */
function parseCommitSummary(output: string): Pick<CommitReceipt, 'branch' | 'hash' | 'subject'> {
  const match = /^\[(.+?) (?:\(root-commit\) )?([0-9a-f]+)\] (.*)$/m.exec(output);
  if (!match) return { branch: '', hash: '', subject: '' };
  return { branch: match[1], hash: match[2], subject: match[3] };
}

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
  /** Set on successful commit; cleared by the next mutating op or reset. */
  lastCommitReceipt: CommitReceipt | null;
  aiAvailable: boolean;
  /** Monotonic guard: refreshes started before the last workspace switch
   * must not apply their result. */
  epoch: number;
  /** Bumped on each accepted status snapshot so HEAD-backed consumers refetch. */
  statusRevision: number;
  /** Bumped when a consumer (status bar) wants the branch popup focused;
   * the git panel watches this like SearchPanel watches focusInputRevision. */
  focusBranchRevision: number;
  /** The open diff preview tab; a new openDiff reuses it in place. */
  diffSession: DiffSession | null;
  /** The change the open diff was built from, so a refresh can re-run it even
   * after an unsaved edit drops the file out of git status. */
  diffSource: GitFileChange | null;
  /** True when the diff tab is the visible editor surface. */
  diffFocused: boolean;
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
  openDiff: (
    change: GitFileChange,
    context: DiffContext,
    opts?: { focus?: boolean }
  ) => Promise<void>;
  refreshOpenDiff: () => Promise<void>;
  closeDiff: () => void;
  setDiffFocused: (focused: boolean) => void;
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
      lastCommitReceipt: null,
      aiAvailable: false,
      epoch: 0,
      statusRevision: 0,
      focusBranchRevision: 0,
      diffSession: null,
      diffSource: null,
      diffFocused: false,

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
            lastCommitReceipt: null,
            diffSession: null,
            diffSource: null,
            diffFocused: false,
            epoch: state.epoch + 1,
            statusRevision: 0,
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
          set(
            (state) => ({
              status,
              statusByPath,
              isRefreshing: false,
              statusRevision: state.statusRevision + 1,
            }),
            false,
            'git/refreshDone'
          );
          // Keep an open diff in sync with the just-loaded status (live edits).
          // Awaited so callers see a consistent snapshot; it early-returns when
          // no diff is open, so the common path stays cheap.
          await get().refreshOpenDiff();
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
        // Snapshot the staged set before the commit consumes it.
        const stagedFiles = (get().status?.files ?? [])
          .filter((f) => classifyChange(f).staged)
          .map((f) => f.path);
        const ok = await runOp('commit', get, set, (root) => GitCommit(root, message, amend));
        if (ok) {
          const output = get().lastOpOutput ?? '';
          set(
            {
              commitMessage: '',
              lastCommitReceipt: { ...parseCommitSummary(output), files: stagedFiles, output },
            },
            false,
            'git/commitReceipt'
          );
        }
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

      openDiff: async (change, context, opts) => {
        const { root, status, epoch } = get();
        const repoRoot = status?.isRepo ? status.repoRoot : root;
        if (!repoRoot) return;
        const untracked = classifyChange(change).untracked;
        const focus = opts?.focus ?? true;

        try {
          let left: DiffSide;
          let right: DiffSide;
          let binary = false;
          let truncated = false;

          const fetchRev = async (
            rev: 'HEAD' | ':0',
            label: string,
            path = change.path
          ): Promise<DiffSide> => {
            const fc = await GitFileAtRev(repoRoot, rev, path);
            binary = binary || fc.binary;
            truncated = truncated || fc.truncated;
            return { label, content: fc.content };
          };

          const abs = joinRepoPath(repoRoot, change.path);
          if (context === 'staged') {
            left = await fetchRev('HEAD', 'HEAD', change.origPath ?? change.path);
            right = await fetchRev(':0', 'Index');
          } else {
            // Untracked files have no index version; diff against empty.
            left = untracked ? { label: 'Index', content: '' } : await fetchRev(':0', 'Index');
            // Prefer the live editor buffer if the file is open, so the diff
            // reflects unsaved edits; otherwise read from disk. Match with the
            // app's canonical path comparison — the open file's path (native,
            // possibly URI-decoded) may differ in representation from abs.
            const openFile = useIDEStore
              .getState()
              .openFiles.find((f) => pathsReferToSameFile(f.path, abs));
            let worktree = '';
            if (openFile) {
              worktree = openFile.content ?? '';
            } else {
              try {
                const result = await ReadFile(abs);
                worktree = result.content ?? '';
              } catch {
                // Deleted from the worktree → empty right side is the truth.
              }
            }
            right = { label: 'Working Tree', content: worktree };
          }

          if (get().epoch !== epoch) return; // workspace switched mid-fetch
          const next: DiffSession = {
            path: change.path,
            absPath: abs,
            context,
            left,
            right,
            binary,
            truncated,
          };
          set(
            (state) => ({
              // Reuse the existing object when nothing changed so a live refresh
              // doesn't rebuild the merge view (and reset scroll) on every save.
              diffSession: sameSession(state.diffSession, next) ? state.diffSession! : next,
              // Remember the originating change so a refresh can re-run even
              // after an unsaved edit drops the file out of git status.
              diffSource: change,
              // A refresh (focus:false) keeps whatever the user was looking at.
              diffFocused: focus ? true : state.diffFocused,
            }),
            false,
            'git/openDiff'
          );
        } catch (err) {
          useIDEStore.getState().showToast(`Diff failed: ${toErrorMessage(err)}`, 'error');
        }
      },

      // Re-run the open diff against the latest status so ongoing edits show up
      // live. Keeps the same file+context and preserves focus; if the file no
      // longer has changes, the diff simply re-fetches to matching content.
      refreshOpenDiff: async () => {
        const { diffSession, diffSource, status } = get();
        if (!diffSession || !status?.isRepo) return;
        // Prefer the current status entry (updated XY letters). Fall back to the
        // originating change so an unsaved edit — which leaves disk unchanged
        // and drops the file from git status — still re-reads the live buffer.
        const change = (status.files ?? []).find((f) => f.path === diffSession.path) ?? diffSource;
        if (!change) return;
        await get().openDiff(change, diffSession.context, { focus: false });
      },

      closeDiff: () =>
        set({ diffSession: null, diffSource: null, diffFocused: false }, false, 'git/closeDiff'),

      setDiffFocused: (diffFocused) => set({ diffFocused }, false, 'git/setDiffFocused'),
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
  set(
    { opInFlight: op, lastError: null, lastOpOutput: null, lastCommitReceipt: null },
    false,
    `git/${op}Start`
  );
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

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import {
  GitStatus,
  GitStage,
  GitUnstage,
  GitIntentToAdd,
  GitCommit,
  GitPull,
  GitPush,
  GitBranches,
  GitCheckout,
  GitCommitMessageAvailable,
  GitGenerateCommitMessage,
  GitFileAtRev,
  GitFileHunks,
  GitApplyHunk,
  GitConflictStages,
  GitMergeHeads,
  GitConflictSnapshot,
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
import { isWritableFormat, saveOpenFileToDisk } from '../utils/fileWrites';
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
  /** Per-hunk staging affordances, from `git diff` of this file. Empty for
   * untracked/binary/too-large diffs (whole-file staging only). In an
   * 'unstaged' diff these stage; in a 'staged' diff they unstage. */
  hunks: git.Hunk[];
  /** True when hunks were skipped only because the working-tree side is an
   * unsaved editor buffer git hasn't diffed yet. The diff view keeps its
   * previous hunk gutter through such a refresh (dimmed where edits touched)
   * instead of collapsing the column for the sub-second save window. */
  hunksSuppressed?: boolean;
  /** Monotonic id of the openDiff request that produced this session. The diff
   * view compares it against the id current when the user last typed, so a
   * refresh that STARTED before a local edit can never reconcile the pane
   * backward, while one that started after (and so read the post-edit
   * buffer/disk) is authoritative. Not part of sameSession equality. */
  requestRevision?: number;
  /** The working-tree file's detected encoding and line endings, captured when
   * an editable (unstaged) diff is built so an edit written straight to disk
   * (file not open in the editor) round-trips them instead of silently
   * rewriting to UTF-8/LF. Undefined when there is no writable worktree file
   * (staged, deleted, binary, or too-large sessions stay read-only). */
  worktreeEncoding?: string;
  worktreeLineEndings?: string;
}

/** How one conflict region was resolved: Current, Incoming, Both, or Manual. */
export type MergeDecision = 'C' | 'I' | 'B' | 'M';

interface MergeSessionBase {
  /** Repo-relative path of the conflicted file. */
  path: string;
  /** Absolute worktree path. */
  absPath: string;
  /** Repo root captured at open; finalize revalidates against the live root
   * so a workspace switch mid-session can never stage into the wrong repo. */
  repoRoot: string;
  /** Card/header labels for the two sides of the active operation. */
  labels: git.MergeHeads;
  /** Workspace-scoped conflicted paths still to resolve, in panel order. */
  fileQueue: string[];
  /** Monotonic id of the openMergeResolution request that built this session. */
  requestRevision: number;
  /** Store epoch captured at open; async work checks it after every await. */
  epoch: number;
}

/** Three-way textual conflict with marker blocks: the Result-spine editor. */
export interface TextMergeSession extends MergeSessionBase {
  kind: 'text';
  /** Full working-tree document, markers included — the exact bytes the
   * regions were parsed from (single atomic backend read). */
  content: string;
  encoding: string;
  lineEndings: string;
  regions: git.ConflictRegion[];
  /** Region index → how it was resolved. Absent = still unresolved. */
  decisions: Record<number, MergeDecision>;
  /** True when the file's format can't be written back losslessly — the
   * session renders read-only and finalize stays disabled. */
  readOnly: boolean;
}

/** Whole-file side choice: binary conflicts and textual delete/modify, which
 * have no marker block to edit. */
export interface SidesMergeSession extends MergeSessionBase {
  kind: 'sides';
  /** Per-stage presence (absent side = deleted on that side) + binary flags. */
  stages: git.ConflictStages;
  selectedSide?: 'ours' | 'theirs';
}

export type MergeSession = TextMergeSession | SidesMergeSession;

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
    a.absPath === b.absPath &&
    a.context === b.context &&
    a.binary === b.binary &&
    a.truncated === b.truncated &&
    a.left.label === b.left.label &&
    a.left.content === b.left.content &&
    a.right.label === b.right.label &&
    a.right.content === b.right.content &&
    a.worktreeEncoding === b.worktreeEncoding &&
    a.worktreeLineEndings === b.worktreeLineEndings &&
    a.hunksSuppressed === b.hunksSuppressed &&
    sameHunks(a.hunks, b.hunks)
  );
}

function sameHunks(a: git.Hunk[], b: git.Hunk[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (h, i) =>
        h.patch === b[i].patch && h.newStart === b[i].newStart && h.newLines === b[i].newLines
    )
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

export type GitOp =
  | 'stage'
  | 'unstage'
  | 'intent-to-add'
  | 'commit'
  | 'pull'
  | 'push'
  | 'checkout'
  | 'generate';

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
  /** The open merge-resolution session; null when none. */
  mergeSession: MergeSession | null;
}

interface GitActions {
  resetForWorkspace: (root: string | null) => void;
  refresh: () => Promise<void>;
  scheduleRefresh: () => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  /** Track untracked paths without staging content (git add -N): the files
   * gain an empty index blob so they diff normally and can be staged
   * hunk-by-hunk. */
  intentToAdd: (paths: string[]) => Promise<void>;
  /** Stage (reverse=false) or unstage (reverse=true) a single diff hunk by
   * applying its patch to the index. Refreshes status + the open diff after. */
  applyHunk: (patch: string, reverse: boolean) => Promise<void>;
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
  /** Open the merge-resolution surface for a conflicted file. Flushes the
   * file's dirty editor buffer to disk first so markers are parsed from the
   * bytes the session will display. Resolves false (with a user-facing toast
   * where actionable) when no session could be built — the caller falls back
   * to opening the file plainly. */
  openMergeResolution: (path: string, fileQueue: string[]) => Promise<boolean>;
}

type GitStore = GitState & GitActions;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let diffRequestRevision = 0;
/** Monotonic id for openMergeResolution requests, so a superseded open (or
 * one predating a workspace switch) drops its result instead of clobbering
 * the newer session. */
let mergeRequestRevision = 0;
/** User-initiated openDiff calls currently in flight. Background refreshes
 * yield to these: a refresh that bumped the request revision mid-click would
 * get the user's completion discarded and their click would appear dead. */
let userDiffRequestsInFlight = 0;

/** Current openDiff request id, read by the diff view when the user types so
 * it can tell refreshes that predate the edit from ones that supersede it. */
export const getDiffRequestRevision = () => diffRequestRevision;

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
      mergeSession: null,

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
            mergeSession: null,
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

      intentToAdd: async (paths) => {
        await runOp('intent-to-add', get, set, async (root) => {
          await GitIntentToAdd(root, paths);
          return null;
        });
      },

      // Applying a hunk IS a stage/unstage op, so it reuses runOp: single-flight
      // against other git ops and an automatic status + open-diff refresh, which
      // repaints the diff with the now-reduced hunk set.
      applyHunk: async (patch, reverse) => {
        await runOp(reverse ? 'unstage' : 'stage', get, set, async (root) => {
          await GitApplyHunk(root, patch, reverse);
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
        await runOp(
          'generate',
          get,
          set,
          (root) => GitGenerateCommitMessage(root),
          (message) => ({ commitMessage: message ?? '', lastOpOutput: null })
        );
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
        const requestRevision = ++diffRequestRevision;
        const untracked = classifyChange(change).untracked;
        const focus = opts?.focus ?? true;
        if (focus) userDiffRequestsInFlight++;

        try {
          let left: DiffSide;
          let right: DiffSide;
          let binary = false;
          let truncated = false;
          // The working-tree file's encoding/line endings, for round-tripping a
          // disk-write edit. Only unstaged sessions have a live worktree side.
          let worktreeEncoding: string | undefined;
          let worktreeLineEndings: string | undefined;
          // The working-tree side is showing an unsaved editor buffer, which
          // git hasn't diffed — its disk-based hunks wouldn't line up with (or
          // stage) what's on screen, so per-hunk staging is suppressed until save.
          let dirtyBufferWorktree = false;

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
              worktreeEncoding = openFile.encoding;
              worktreeLineEndings = openFile.lineEndings;
              dirtyBufferWorktree = openFile.isModified === true;
            } else if (change.worktree === 'D') {
              // A deleted file has no metadata to preserve, so its empty
              // worktree snapshot remains read-only.
            } else {
              const result = await ReadFile(abs);
              worktree = result.content ?? '';
              binary = binary || result.isBinary === true;
              worktreeEncoding = result.encoding;
              worktreeLineEndings = result.lineEndings;
            }
            right = { label: 'Working Tree', content: worktree };
          }

          // Per-hunk staging data for tracked, textual, in-size diffs.
          // Untracked/staged-rename/binary/too-large diffs stage whole-file only,
          // so skip the extra git call and leave hunks empty (no gutter button).
          let hunks: git.Hunk[] = [];
          const stagedRename = context === 'staged' && change.origPath;
          const hunkable = !untracked && !stagedRename && !binary && !truncated;
          if (hunkable && !dirtyBufferWorktree) {
            const fh = await GitFileHunks(repoRoot, change.path, context === 'staged');
            hunks = fh.hunks ?? [];
          }

          if (get().epoch !== epoch || requestRevision !== diffRequestRevision) return;
          const next: DiffSession = {
            path: change.path,
            absPath: abs,
            context,
            left,
            right,
            binary,
            truncated,
            hunks,
            // Skipped only because the buffer hasn't been saved yet — the next
            // post-save refresh will deliver real hunks for the same diff.
            hunksSuppressed: hunkable && dirtyBufferWorktree,
            requestRevision,
            worktreeEncoding,
            worktreeLineEndings,
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
          if (get().epoch === epoch && requestRevision === diffRequestRevision) {
            useIDEStore.getState().showToast(`Diff failed: ${toErrorMessage(err)}`, 'error');
          }
        } finally {
          if (focus) userDiffRequestsInFlight--;
        }
      },

      // Re-run the open diff against the latest status so ongoing edits show up
      // live. Keeps the same file+context and preserves focus; if the file no
      // longer has changes, the diff simply re-fetches to matching content.
      refreshOpenDiff: async () => {
        const { diffSession, diffSource, status } = get();
        if (!diffSession || !status?.isRepo) return;
        // Yield to a click in flight: refreshing here would supersede the
        // user's request revision and their newly opened diff would be
        // discarded on completion. The user's own openDiff refreshes anyway.
        if (userDiffRequestsInFlight > 0) return;
        // Prefer the current status entry (updated XY letters). Fall back to the
        // originating change so an unsaved edit — which leaves disk unchanged
        // and drops the file from git status — still re-reads the live buffer.
        const change = (status.files ?? []).find((f) => f.path === diffSession.path) ?? diffSource;
        if (!change) return;
        // Follow a whole-file stage/unstage (the panel checkbox): when the open
        // context no longer has changes but the other one does, retarget so the
        // diff keeps showing the change the user is tracking — and lands back
        // in the editable working-tree view when they unstage. A partially
        // staged file has content in both contexts and stays put.
        let context = diffSession.context;
        const cls = classifyChange(change);
        if (context === 'unstaged' && !cls.unstaged && !cls.untracked && cls.staged) {
          context = 'staged';
        } else if (context === 'staged' && !cls.staged && (cls.unstaged || cls.untracked)) {
          context = 'unstaged';
        }
        await get().openDiff(change, context, { focus: false });
      },

      closeDiff: () =>
        set({ diffSession: null, diffSource: null, diffFocused: false }, false, 'git/closeDiff'),

      setDiffFocused: (diffFocused) => set({ diffFocused }, false, 'git/setDiffFocused'),

      openMergeResolution: async (path, fileQueue) => {
        const { root, status, epoch } = get();
        const repoRoot = status?.isRepo ? status.repoRoot : root;
        if (!repoRoot) return false;
        const requestRevision = ++mergeRequestRevision;
        const isCurrent = () => get().epoch === epoch && requestRevision === mergeRequestRevision;
        const abs = joinRepoPath(repoRoot, path);

        // Flush any unsaved editor buffer first: the snapshot must be parsed
        // from the same bytes the session displays, and git only sees disk.
        try {
          await saveOpenFileToDisk(abs);
        } catch (err) {
          if (isCurrent()) {
            useIDEStore
              .getState()
              .showToast(`Could not save ${path}: ${toErrorMessage(err)}`, 'error');
          }
          return false;
        }
        if (!isCurrent()) return false;

        try {
          // Stage presence decides the session kind: a missing side or a
          // binary file has no marker block to edit, so it gets a whole-file
          // side choice instead of the Result-spine editor.
          const stages = await GitConflictStages(repoRoot, path);
          if (!isCurrent()) return false;
          if (!stages.base && !stages.ours && !stages.theirs) {
            useIDEStore.getState().showToast(`${path} is not conflicted`, 'info');
            return false;
          }

          const labels = await GitMergeHeads(repoRoot);
          if (!isCurrent()) return false;

          const base = { path, absPath: abs, repoRoot, labels, fileQueue, requestRevision, epoch };
          if (stages.binary || !stages.ours || !stages.theirs) {
            set(
              { mergeSession: { kind: 'sides', ...base, stages } },
              false,
              'git/openMergeResolution'
            );
            return true;
          }

          const snap = await GitConflictSnapshot(repoRoot, path);
          if (!isCurrent()) return false;
          if (!snap.regions || snap.regions.length === 0) {
            useIDEStore.getState().showToast(`No conflict markers found in ${path}`, 'info');
            return false;
          }
          set(
            {
              mergeSession: {
                kind: 'text',
                ...base,
                content: snap.content,
                encoding: snap.encoding,
                lineEndings: snap.lineEndings,
                regions: snap.regions,
                decisions: {},
                readOnly: !isWritableFormat(snap.encoding, snap.lineEndings),
              },
            },
            false,
            'git/openMergeResolution'
          );
          return true;
        } catch (err) {
          if (isCurrent()) {
            useIDEStore
              .getState()
              .showToast(`Merge resolution failed: ${toErrorMessage(err)}`, 'error');
          }
          return false;
        }
      },
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
  fn: (root: string) => Promise<string | null>,
  onSuccess?: (output: string | null) => Partial<GitState>
): Promise<boolean> {
  const { root, opInFlight, epoch } = get();
  if (!root || opInFlight) return false;
  const isCurrent = () => get().root === root && get().epoch === epoch;
  set(
    { opInFlight: op, lastError: null, lastOpOutput: null, lastCommitReceipt: null },
    false,
    `git/${op}Start`
  );
  try {
    const output = await fn(root);
    if (!isCurrent()) return false;
    set(
      { opInFlight: null, lastOpOutput: output, ...(onSuccess?.(output) ?? {}) },
      false,
      `git/${op}Done`
    );
    return true;
  } catch (err) {
    if (!isCurrent()) return false;
    const message = toErrorMessage(err);
    set({ opInFlight: null, lastError: message }, false, `git/${op}Failed`);
    useIDEStore.getState().showToast(`Git ${op} failed: ${message}`, 'error');
    return false;
  } finally {
    if (isCurrent()) void get().refresh();
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

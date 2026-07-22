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
  GitResolveConflictSide,
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
import {
  flushWorkingTreeEdit,
  getFileWriteRevision,
  isWritableFormat,
  markFileWriteAttempt,
  saveOpenFileToDisk,
  withFileWriteLock,
} from '../utils/fileWrites';
import { useIDEStore } from './ideStore';

/** Which pair of revisions a diff shows. Staged rows compare HEAD to the
 * index; unstaged (and untracked) rows compare the index to the worktree. */
export type DiffContext = 'staged' | 'unstaged';
export type EditorFocus = 'file' | 'diff' | 'merge';

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

export interface MergeFinalizeOptions {
  /** Close a successful session without opening another queued conflict. */
  suppressQueueAdvance?: boolean;
}

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
  /** Per-path write generation captured with the conflict snapshot. Any later
   * editor/diff write invalidates the session before it can overwrite data. */
  fileWriteRevision: number;
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

/** Editor buffers are LF-joined by CodeMirror while git snapshots preserve
 * raw file bytes; any comparison between the two must run in one line-ending
 * domain. */
function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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
  /** True when the merge-resolution tab is the visible editor surface. */
  mergeFocused: boolean;
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
  setEditorFocus: (focus: EditorFocus) => void;
  /** Open the merge-resolution surface for a conflicted file. Flushes the
   * file's dirty editor buffer to disk first so markers are parsed from the
   * bytes the session will display. Resolves false (with a user-facing toast
   * where actionable) when no session could be built. */
  openMergeResolution: (path: string, fileQueue: string[]) => Promise<boolean>;
  /** Record how a region was resolved (text sessions only). */
  recordDecision: (index: number, choice: MergeDecision) => void;
  /** Reopen a resolved region: forget its decision (text sessions only). */
  reopenDecision: (index: number) => void;
  /** Choose which whole-file side wins (sides sessions only). */
  selectMergeSide: (side: 'ours' | 'theirs') => void;
  /** Discard the session. Never writes — worktree and markers stay intact.
   * Also invalidates any in-flight open so a closed surface cannot reappear. */
  closeMergeResolution: () => void;
  /** Write the resolved file and stage it. By default, advance to the next
   * queued conflicted file; callers may suppress that advance. Text sessions
   * require the resolved Result document;
   * sides sessions apply the previously selected side via the backend
   * finalize op. Resolves true when the stage succeeded (a supersession
   * after that point only skips the queue advance); false means the file was
   * not staged — before the write that is always a clean no-op, after it the
   * error toast says what still needs doing. */
  mergeFinalizeAndStage: (result?: string, options?: MergeFinalizeOptions) => Promise<boolean>;
}

type GitStore = GitState & GitActions;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let diffRequestRevision = 0;
/** Monotonic id for openMergeResolution requests, so a superseded open (or
 * one predating a workspace switch) drops its result instead of clobbering
 * the newer session. */
let mergeRequestRevision = 0;
/** True while a merge finalize is running — a second click must not start a
 * concurrent write/stage pair against the same session. */
let mergeFinalizeInFlight = false;
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
      mergeFocused: false,
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
            mergeFocused: false,
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
              mergeFocused: focus ? false : state.mergeFocused,
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

      setDiffFocused: (diffFocused) => get().setEditorFocus(diffFocused ? 'diff' : 'file'),

      setEditorFocus: (focus) =>
        set(
          { diffFocused: focus === 'diff', mergeFocused: focus === 'merge' },
          false,
          'git/setEditorFocus'
        ),

      openMergeResolution: async (path, fileQueue) => {
        // A finalize is mid-write: snapshotting now would capture pre-write
        // markers and install a stale session over the completed resolution.
        // (Refused BEFORE the counter bump so the running finalize's own
        // guards are unaffected; the post-finalize advance re-opens freely.)
        // Toasted so a refused open is never a silent dead click.
        if (mergeFinalizeInFlight) {
          useIDEStore
            .getState()
            .showToast('Finishing the previous resolution — try again in a moment', 'info');
          return false;
        }
        const installedSession = get().mergeSession;
        if (installedSession?.path === path) {
          get().setEditorFocus('merge');
          return true;
        }
        if (installedSession) {
          useIDEStore.getState().showToast('Close the current merge resolution first', 'info');
          return false;
        }
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
        const fileWriteRevision = getFileWriteRevision(abs);
        const fileStayedStable = () => {
          if (getFileWriteRevision(abs) === fileWriteRevision) return true;
          if (isCurrent()) {
            useIDEStore
              .getState()
              .showToast(`${path} changed while opening its merge session — try again`, 'error');
          }
          return false;
        };

        try {
          // Stage presence decides the session kind: a missing side or a
          // binary file has no marker block to edit, so it gets a whole-file
          // side choice instead of the Result-spine editor.
          const stages = await GitConflictStages(repoRoot, path);
          if (!isCurrent()) return false;
          if (!fileStayedStable()) return false;
          if (!stages.base && !stages.ours && !stages.theirs) {
            useIDEStore.getState().showToast(`${path} is not conflicted`, 'info');
            return false;
          }

          const labels = await GitMergeHeads(repoRoot);
          if (!isCurrent()) return false;
          if (!fileStayedStable()) return false;

          const base = {
            path,
            absPath: abs,
            repoRoot,
            labels,
            fileQueue,
            requestRevision,
            epoch,
            fileWriteRevision,
          };
          if (stages.binary || !stages.ours || !stages.theirs) {
            set(
              {
                mergeSession: { kind: 'sides', ...base, stages },
                diffFocused: false,
                mergeFocused: true,
              },
              false,
              'git/openMergeResolution'
            );
            return true;
          }

          const snap = await GitConflictSnapshot(repoRoot, path);
          if (!isCurrent()) return false;
          if (!fileStayedStable()) return false;
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
              diffFocused: false,
              mergeFocused: true,
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

      recordDecision: (index, choice) => {
        const session = get().mergeSession;
        if (session?.kind !== 'text') return;
        // A phantom decision outside the region space would corrupt
        // completion accounting ("all regions decided" gates) silently.
        if (index < 0 || index >= session.regions.length) return;
        set(
          { mergeSession: { ...session, decisions: { ...session.decisions, [index]: choice } } },
          false,
          'git/recordDecision'
        );
      },

      reopenDecision: (index) => {
        const session = get().mergeSession;
        if (session?.kind !== 'text') return;
        const decisions = { ...session.decisions };
        delete decisions[index];
        set({ mergeSession: { ...session, decisions } }, false, 'git/reopenDecision');
      },

      selectMergeSide: (side) => {
        const session = get().mergeSession;
        if (session?.kind !== 'sides') return;
        set({ mergeSession: { ...session, selectedSide: side } }, false, 'git/selectMergeSide');
      },

      closeMergeResolution: () => {
        // Invalidate any in-flight open too — a session installing after the
        // user closed the surface would make it reappear.
        mergeRequestRevision++;
        set({ mergeSession: null, mergeFocused: false }, false, 'git/closeMergeResolution');
      },

      mergeFinalizeAndStage: async (result, options) => {
        const session = get().mergeSession;
        if (!session) return false;
        // Single-flight: a second click while a finalize runs must not start
        // a concurrent write/stage pair against the same session.
        if (mergeFinalizeInFlight) return false;

        // Before the destructive write, ANY newer open (even one still in
        // flight) or a workspace switch makes this finalize stale.
        const isCurrent = () =>
          get().epoch === session.epoch && session.requestRevision === mergeRequestRevision;
        // After the write, only a workspace switch aborts — the stage against
        // the captured root must still complete so disk and index agree; a
        // same-workspace supersession merely skips the advance.
        const isSameWorkspace = () => get().epoch === session.epoch;
        const showError = (message: string) => useIDEStore.getState().showToast(message, 'error');
        const findOpenFile = () =>
          useIDEStore
            .getState()
            .openFiles.find((f) => pathsReferToSameFile(f.path, session.absPath));
        const clearCapturedSession = () => {
          if (
            isSameWorkspace() &&
            get().mergeSession?.requestRevision === session.requestRevision
          ) {
            mergeRequestRevision++;
            set({ mergeSession: null, mergeFocused: false }, false, 'git/mergeInvalidated');
          }
        };
        const invalidateChangedSession = (message: string) => {
          showError(message);
          clearCapturedSession();
          return false;
        };
        const fileStayedStable = () =>
          getFileWriteRevision(session.absPath) === session.fileWriteRevision;

        // Set when the stage succeeded while the session was still current.
        // The advance itself runs AFTER the in-flight guard drops, because it
        // opens the next session and openMergeResolution refuses to run
        // during a finalize (a mid-write open would snapshot stale markers).
        let advanceAfter = false;
        // A warning raised on a SUCCESSFUL finalize, emitted after the
        // advance so its toast is not overwritten by the completion toast.
        let warningAfter: string | null = null;

        // Staging runs through runOp for single-flight + status refresh, but
        // against the session's CAPTURED repo root — never the live one.
        const stageResolved = async (fn: () => Promise<void>): Promise<boolean> => {
          const ok = await runOp('stage', get, set, async () => {
            await fn();
            return null;
          });
          if (!ok) {
            // runOp toasts its own failures; its silent branch is the
            // opInFlight gate — surface it so finalize is never a dead click
            // after the write already happened.
            if (isSameWorkspace() && !get().lastError) {
              showError(
                `Could not stage ${session.path}: another git operation is running — retry when it finishes.`
              );
            }
            return false;
          }
          advanceAfter = isCurrent();
          return true;
        };

        const runFinalize = async (): Promise<boolean> => {
          if (!isCurrent()) return false;
          if (!fileStayedStable()) {
            return invalidateChangedSession(
              `Cannot finalize ${session.path}: the file changed after this merge session opened. Reopen it and re-resolve.`
            );
          }
          // Fail BEFORE the write when staging would be refused anyway —
          // runOp's opInFlight gate is silent and by then markers are gone.
          if (get().opInFlight) {
            showError(
              `Cannot finalize ${session.path}: another git operation is running — retry when it finishes.`
            );
            return false;
          }

          if (session.kind === 'sides') {
            const side = session.selectedSide;
            if (!side) return false;
            try {
              return await withFileWriteLock(session.absPath, async (_write, hasQueuedWrites) => {
                if (!isCurrent()) return false;
                if (get().opInFlight) {
                  showError(
                    `Cannot finalize ${session.path}: another git operation is running — retry when it finishes.`
                  );
                  return false;
                }
                if (!fileStayedStable() || hasQueuedWrites()) {
                  return invalidateChangedSession(
                    `Cannot finalize ${session.path}: the file acquired another save after this merge session opened. Reopen it and choose a side again.`
                  );
                }

                // The plain tab bypasses this surface entirely: unsaved
                // edits would be discarded or resurrected by autosave.
                const before = findOpenFile();
                if (before?.isModified) {
                  showError(
                    `Cannot finalize ${session.path}: the file has unsaved edits. Save or revert them first.`
                  );
                  return false;
                }

                // ResolveConflictSide may change the worktree before a
                // later git-add failure, so the attempt itself invalidates
                // this snapshot unless it succeeds and closes the session.
                markFileWriteAttempt(session.absPath);
                const ok = await stageResolved(() =>
                  GitResolveConflictSide(session.repoRoot, session.path, side)
                );
                if (!ok) {
                  clearCapturedSession();
                  return false;
                }
                if (isSameWorkspace()) {
                  const after = findOpenFile();
                  if (after) {
                    if (after.isModified) {
                      warningAfter = `${session.path}: the chosen side was applied and staged, but the open tab has unsaved edits from during the apply. They were kept — review the tab before saving.`;
                    } else {
                      useIDEStore.getState().closeFile(after.id);
                    }
                  } else if (before) {
                    warningAfter = `${session.path}: the editor tab closed while the side was being applied. If it had unsaved edits they were auto-saved and may conflict with the staged resolution — check the file's git status before committing.`;
                  } else if (hasQueuedWrites()) {
                    warningAfter = `${session.path}: another save queued while the side was being applied. The side was staged, but the worktree may change — check git status before committing.`;
                  }
                }
                return true;
              });
            } catch (err) {
              return invalidateChangedSession(
                `Could not finalize ${session.path}: a pending file save failed (${toErrorMessage(err)}). Reopen it and choose a side again.`
              );
            }
          }

          if (result == null) return false;
          if (session.readOnly) {
            showError(
              `Cannot finalize ${session.path}: its encoding or line endings cannot be written back losslessly.`
            );
            return false;
          }
          if (session.regions.some((_, index) => session.decisions[index] === undefined)) {
            showError(`Cannot finalize ${session.path}: unresolved conflicts remain.`);
            return false;
          }

          // Settle any queued diff edit for this path so the resolved write
          // is ordered after it in the per-path queue.
          try {
            await flushWorkingTreeEdit(session.absPath);
          } catch (err) {
            if (isSameWorkspace())
              showError(`Could not save ${session.path}: ${toErrorMessage(err)}`);
            return false;
          }
          if (!isCurrent()) return false;

          const baseline = normalizeEol(session.content);
          try {
            return await withFileWriteLock(session.absPath, async (write, hasQueuedWrites) => {
              if (!isCurrent()) return false;
              if (get().opInFlight) {
                showError(
                  `Cannot finalize ${session.path}: another git operation is running — retry when it finishes.`
                );
                return false;
              }
              if (!fileStayedStable() || hasQueuedWrites()) {
                return invalidateChangedSession(
                  `Cannot finalize ${session.path}: the file acquired another save after this merge session opened. Reopen it and re-resolve.`
                );
              }

              // The buffer matched the session content when the session
              // opened. A dirty flag is divergence even when the text was
              // edited back to the baseline: an autosave may still own an
              // intermediate revision of the same path.
              const openFile = findOpenFile();
              if (openFile?.isModified) {
                showError(
                  `Cannot finalize ${session.path}: the file has unsaved edits. Save or revert them first.`
                );
                return false;
              }
              if (
                openFile &&
                normalizeEol(openFile.content) !== baseline &&
                openFile.content !== result
              ) {
                showError(
                  `Cannot finalize ${session.path}: the editor buffer changed after this merge session started. Close the merge tab and re-resolve, or undo the buffer edit.`
                );
                return false;
              }

              await write(result, session.encoding, session.lineEndings, false);
              const resolvedWriteRevision = getFileWriteRevision(session.absPath);
              if (!isSameWorkspace()) {
                showError(
                  `Workspace switched while finalizing ${session.path}: the resolved file was written but NOT staged. Stage it manually in its original repository.`
                );
                return false;
              }

              const after = findOpenFile();
              if (hasQueuedWrites()) {
                return invalidateChangedSession(
                  `${session.path} acquired another pending save while the resolution was being written. The file was NOT staged — reopen it and re-resolve.`
                );
              }
              if (after?.isModified) {
                return invalidateChangedSession(
                  `${session.path} changed while the resolved file was being written. Your edit is preserved and the file was NOT staged — review it, then stage manually.`
                );
              }
              if (after && after.content !== result && normalizeEol(after.content) !== baseline) {
                return invalidateChangedSession(
                  `${session.path} changed while the resolved file was being written. Your edit is preserved and the file was NOT staged — review it, then stage manually.`
                );
              }

              // A clean tab may close during the write without queueing
              // anything. In that case the resolution is still durably last
              // and can be staged. Reconcile only a tab that remains open.
              if (after) {
                const ide = useIDEStore.getState();
                ide.updateFileContent(after.id, result);
                ide.setFileModified(after.id, false);
              }

              // Rebase the live session so a retry after a failed stage can
              // submit a corrected result without comparing to old markers.
              const live = get().mergeSession;
              if (live?.kind === 'text' && live.requestRevision === session.requestRevision) {
                set(
                  {
                    mergeSession: {
                      ...live,
                      content: result,
                      fileWriteRevision: resolvedWriteRevision,
                    },
                  },
                  false,
                  'git/mergeWriteBaseline'
                );
              }

              // Holding the path queue through GitStage prevents an
              // autosave queued during the write from racing the index.
              const staged = await stageResolved(() => GitStage(session.repoRoot, [session.path]));
              if (!staged && hasQueuedWrites()) {
                return invalidateChangedSession(
                  `${session.path} acquired another save while staging failed. Reopen it and re-resolve before retrying.`
                );
              }
              return staged;
            });
          } catch (err) {
            if (isSameWorkspace()) {
              showError(`Could not write ${session.path}: ${toErrorMessage(err)}`);
              clearCapturedSession();
            }
            return false;
          }
        };

        mergeFinalizeInFlight = true;
        let ok = false;
        try {
          ok = await runFinalize();
        } finally {
          mergeFinalizeInFlight = false;
        }
        // The warning goes out BEFORE the advance: a failed next-open raises
        // its own explanatory toast, which must be the one that survives
        // (single-toast UI). The completion toast is suppressed instead so a
        // warning on an exhausted queue is not buried either.
        if (ok && warningAfter) showError(warningAfter);
        if (ok && advanceAfter) {
          // Close the finalized session, then open the next queued conflicted
          // file, or report completion when the queue is exhausted.
          const remaining = session.fileQueue.filter((p) => p !== session.path);
          set({ mergeSession: null, mergeFocused: false }, false, 'git/mergeFinalized');
          if (remaining.length === 0) {
            // Completion feedback is not an advance — the exhausted queue is
            // reported even when the caller suppressed auto-advance.
            if (!warningAfter) {
              useIDEStore.getState().showToast('Conflict queue resolved', 'info');
            }
          } else if (!options?.suppressQueueAdvance) {
            await get().openMergeResolution(remaining[0], remaining);
          }
        }
        return ok;
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

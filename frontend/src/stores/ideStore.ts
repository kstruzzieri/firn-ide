import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { filesystem, workspace } from '../../wailsjs/go/models';
import type { RunProfile } from '../types/runProfile';
import { LineAssembler } from '../utils/lineAssembler';
import type {
  CompoundRun,
  CompoundRunEvent,
  OutputChunk,
  OutputEntry,
  RunHistoryEntry,
  RunOutput,
  RunState,
  RunOutputViewMode,
} from '../types/runOutput';
import { MAX_OUTPUT_ENTRIES, ALL_PROFILES_ID } from '../types/runOutput';
import { parseCompoundStepKey } from '../utils/compoundRunKeys';
import { estimateDuration, estimateRemaining } from '../utils/estimateCompletion';
import { parseFileReferences } from '../utils/parseFileReferences';
import {
  type SyntaxThemeId,
  DEFAULT_SYNTAX_THEME_ID,
  isSyntaxThemeId,
} from '../components/Editor/codemirror/palettes';

const SYNTAX_THEME_STORAGE_KEY = 'firn.editorSyntaxTheme';

export function loadInitialSyntaxTheme(): SyntaxThemeId {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(SYNTAX_THEME_STORAGE_KEY) : null;
    return isSyntaxThemeId(raw) ? raw : DEFAULT_SYNTAX_THEME_ID;
  } catch {
    return DEFAULT_SYNTAX_THEME_ID;
  }
}

// Types
export type SidebarView = 'explorer' | 'search' | 'git' | 'run';
export type TerminalTab = 'terminal' | 'output' | 'problems';
export type WorkspaceAccent =
  | 'project'
  | 'blue'
  | 'cyan'
  | 'green'
  | 'purple'
  | 'orange'
  | 'amber'
  | 'general';

// Re-export FileEntry for convenience
export type FileEntry = filesystem.FileEntry;

export interface WorkspaceInfo {
  name: string;
  path: string;
}

export interface EditorFile {
  id: string;
  name: string;
  path: string;
  language: string;
  encoding: string;
  lineEndings: string;
  content: string;
  isModified: boolean;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface TerminalSession {
  id: string;
  title: string;
}

export interface EditorNavigationRequest {
  fileId: string;
  line: number;
  column: number;
  revision: number;
}

export interface NavigationLocation {
  fileId: string;
  line: number;
  column: number;
}

const MAX_NAVIGATION_HISTORY = 50;

const defaultPanelSizes = { left: 260, right: 280, bottom: 200 };

function createDefaultWorkspaceSessionState() {
  return {
    activeSidebarView: 'explorer' as SidebarView,
    isLeftPanelCollapsed: false,
    isRightPanelCollapsed: false,
    isBottomPanelCollapsed: false,
    panelSizes: { ...defaultPanelSizes },
    openFiles: [] as EditorFile[],
    activeFileId: null as string | null,
    cursorPosition: { line: 1, column: 1 },
    scrollPositions: {} as Record<string, number>,
    cursorPositions: {} as Record<string, CursorPosition>,
    expandedPaths: new Set<string>(),
    selectedPath: null as string | null,
    isRootExpanded: true,
    pendingEditorNavigation: null as EditorNavigationRequest | null,
    navigationHistory: [] as NavigationLocation[],
    navigationForward: [] as NavigationLocation[],
  };
}

interface IDEState {
  // Workspace
  workspace: WorkspaceInfo | null;
  isLoading: boolean;

  // Workspace identity (#53)
  workspaces: workspace.WorkspaceDef[];
  activeWorkspaceId: string;
  lastFocusedWorkspaceId: string | null;

  // File Explorer
  directoryTree: filesystem.FileEntry[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  isRootExpanded: boolean;
  isLoadingTree: boolean;
  treeError: string | null;

  // Sidebar
  activeSidebarView: SidebarView;

  // Panel visibility and sizes
  isLeftPanelCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  isBottomPanelCollapsed: boolean;
  panelSizes: { left: number; right: number; bottom: number };

  // Editor
  openFiles: EditorFile[];
  activeFileId: string | null;
  cursorPosition: CursorPosition;

  // Toast
  toast: { message: string; type: 'error' | 'info' } | null;

  // Terminal
  activeTerminalTab: TerminalTab;
  terminalSessions: TerminalSession[];
  activeTerminalSessionId: string | null;
  hasAutoCreatedInitialTerminalSession: boolean;
  workingDirectory: string;

  // Run Profiles
  runProfiles: RunProfile[];
  isLoadingProfiles: boolean;
  profilesError: string | null;

  // Run Output
  runOutputs: Record<string, RunOutput>;
  runCompounds: Record<string, CompoundRun>;
  activeRunOutputId: string | null;
  runOutputViewMode: RunOutputViewMode;
  runOutputAutoScroll: boolean;

  // Process lifecycle UI
  stoppingProfileIds: string[];
  restartingProfileIds: string[];
  runHistory: Record<string, RunHistoryEntry[]>;
  waveformData: Record<string, number[]>;
  hiddenProfileIds: string[];
  runStartTimestamps: Record<string, number>;
  stopRequestTimestamps: Record<string, number>;

  // Per-file view state (for persistence)
  scrollPositions: Record<string, number>; // fileId -> scrollTop
  cursorPositions: Record<string, CursorPosition>; // fileId -> cursor

  // Workspace persistence
  isRestoringWorkspace: boolean;

  // Recent workspaces
  recentWorkspaces: workspace.Summary[];
  recentWorkspacesVersion: number;

  // Status
  gitBranch: string;
  editorSyntaxTheme: SyntaxThemeId;

  // Editor navigation
  pendingEditorNavigation: EditorNavigationRequest | null;

  // Navigation history (back/forward)
  navigationHistory: NavigationLocation[];
  navigationForward: NavigationLocation[];
}

interface IDEActions {
  // Workspace actions
  setWorkspace: (workspace: WorkspaceInfo | null) => void;
  setWorkspaces: (defs: workspace.WorkspaceDef[]) => void;
  setActiveWorkspace: (id: string) => void;
  setTreeViewMode: (mode: 'project' | 'workspace') => void;
  setLoading: (isLoading: boolean) => void;

  // File Explorer actions
  setDirectoryTree: (tree: filesystem.FileEntry[]) => void;
  toggleExpanded: (path: string) => void;
  setSelectedPath: (path: string | null) => void;
  toggleRootExpanded: () => void;
  setTreeLoading: (loading: boolean) => void;
  setTreeError: (error: string | null) => void;

  // Sidebar actions
  setSidebarView: (view: SidebarView) => void;

  // Panel actions
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleBottomPanel: () => void;
  setPanelSize: (panel: 'left' | 'right' | 'bottom', size: number) => void;

  // Editor actions
  openFile: (file: EditorFile) => void;
  closeFile: (fileId: string) => void;
  setActiveFile: (fileId: string | null) => void;
  setCursorPosition: (position: CursorPosition) => void;
  setFileModified: (fileId: string, isModified: boolean) => void;
  updateFileContent: (fileId: string, content: string) => void;

  // Toast actions
  showToast: (message: string, type: 'error' | 'info') => void;
  clearToast: () => void;

  // Terminal actions
  setTerminalTab: (tab: TerminalTab) => void;
  addTerminalSession: (session: TerminalSession) => void;
  removeTerminalSession: (sessionId: string) => void;
  setActiveTerminalSession: (sessionId: string) => void;
  renameTerminalSession: (sessionId: string, title: string) => void;
  reorderTerminalSessions: (fromIndex: number, toIndex: number) => void;
  markInitialTerminalSessionCreated: () => void;
  setWorkingDirectory: (path: string) => void;

  // Run Profile actions
  setRunProfiles: (profiles: RunProfile[]) => void;
  setProfilesLoading: (loading: boolean) => void;
  setProfilesError: (error: string | null) => void;
  addOrUpdateProfile: (profile: RunProfile) => void;
  removeProfile: (id: string) => void;

  // Run Output actions
  appendRunOutput: (chunk: OutputChunk) => void;
  setRunState: (profileId: string, state: RunState, exitCode: number) => void;
  handleRunStatus: (
    profileId: string,
    state: RunState,
    exitCode: number,
    timestamp: number
  ) => void;
  clearRunOutput: (profileId: string) => void;
  clearAllRunOutputs: () => void;
  handleCompoundRun: (event: CompoundRunEvent) => void;
  appendCompoundRunOutput: (compoundId: string, stepIdx: number, chunk: OutputChunk) => void;
  clearCompoundRunOutput: (compoundId: string) => void;
  setActiveRunOutput: (id: string | null) => void;
  setRunOutputViewMode: (mode: RunOutputViewMode) => void;
  toggleAutoScroll: () => void;

  // Process lifecycle actions
  setProfileStopping: (profileId: string) => void;
  clearProfileStopping: (profileId: string) => void;
  setProfileRestarting: (profileId: string) => void;
  clearProfileRestarting: (profileId: string) => void;
  appendRunHistory: (profileId: string, entry: RunHistoryEntry) => void;
  updateWaveform: (profileId: string, entryCount: number) => void;
  hideProfile: (id: string) => void;
  unhideProfile: (id: string) => void;
  focusProfileOutput: (profileId: string) => void;
  resetWorkspaceRunState: () => void;

  // Per-file view state actions
  setScrollPosition: (fileId: string, scrollTop: number) => void;
  setFileCursorPosition: (fileId: string, position: CursorPosition) => void;

  // Workspace persistence actions
  setRestoringWorkspace: (restoring: boolean) => void;
  resetWorkspaceSession: () => void;

  // Recent workspaces actions
  setRecentWorkspaces: (workspaces: workspace.Summary[]) => void;

  // Status actions
  setGitBranch: (branch: string) => void;
  setEditorSyntaxTheme: (id: SyntaxThemeId) => void;

  // Editor navigation actions
  requestEditorNavigation: (fileId: string, line: number, column: number) => void;
  clearPendingEditorNavigation: (fileId: string, revision: number) => void;

  // Navigation history actions
  pushNavigationHistory: (entry: NavigationLocation) => void;
  goBack: (current: NavigationLocation) => NavigationLocation | undefined;
  goForward: (current: NavigationLocation) => NavigationLocation | undefined;
}

type IDEStore = IDEState & IDEActions;

// Line assemblers are per-profile, stored outside Zustand (mutable, not serializable)
// Line assemblers are per-profile, stored outside Zustand (mutable, not serializable).
// Each assembler's emit callback is swappable so appendRunOutput can collect lines
// into a local array per chunk, then commit once to the store.
const lineAssemblers = new Map<string, LineAssembler>();
const assemblerCallbacks = new Map<string, (entry: OutputEntry) => void>();

function getOrCreateAssembler(
  profileId: string,
  emitFn: (entry: OutputEntry) => void
): LineAssembler {
  assemblerCallbacks.set(profileId, emitFn);
  let assembler = lineAssemblers.get(profileId);
  if (!assembler) {
    assembler = new LineAssembler((entry) => {
      const cb = assemblerCallbacks.get(profileId);
      if (cb) cb(entry);
    });
    lineAssemblers.set(profileId, assembler);
  }
  return assembler;
}

// Canonical key for a compound step's line assembler. Used for BOTH routing
// step output into an assembler and flushing it on terminal, so the two always
// agree without depending on Go's base64url encoding of the composite key.
function compoundStepAssemblerKey(compoundId: string, stepIdx: number): string {
  return JSON.stringify([compoundId, stepIdx]);
}

// Push a chunk through the assembler for `key` and return the complete lines it
// emitted. Shared by ordinary and compound output paths.
function collectChunkEntries(key: string, chunk: OutputChunk): OutputEntry[] {
  const pending: OutputEntry[] = [];
  const assembler = getOrCreateAssembler(key, (entry) => pending.push(entry));
  assembler.push(chunk.stream, chunk.data, chunk.timestamp);
  return pending;
}

// Flush any carry-over from the assembler for `key`, returning the flushed
// entries, then drop the assembler and its callback. No-op (empty) if absent.
function flushAssembler(key: string): OutputEntry[] {
  const flushed: OutputEntry[] = [];
  const assembler = lineAssemblers.get(key);
  if (!assembler) return flushed;
  assemblerCallbacks.set(key, (entry) => flushed.push(entry));
  assembler.flush();
  lineAssemblers.delete(key);
  assemblerCallbacks.delete(key);
  return flushed;
}

function getProfileWorkingDirSnapshot(
  state: Pick<IDEState, 'runProfiles'>,
  profileId: string
): string | undefined {
  return state.runProfiles.find((profile) => profile.id === profileId)?.workingDir;
}

function createRunOutput(profileId: string, workingDir?: string): RunOutput {
  return {
    profileId,
    workingDir,
    state: 'idle',
    exitCode: 0,
    runCount: 0,
    entries: [],
    previousEntries: [],
  };
}

export const useIDEStore = create<IDEStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      workspace: null,
      isLoading: false,
      workspaces: [],
      activeWorkspaceId: 'project',
      lastFocusedWorkspaceId: null,
      directoryTree: [],
      isLoadingTree: false,
      treeError: null,
      ...createDefaultWorkspaceSessionState(),
      toast: null,
      activeTerminalTab: 'terminal',
      terminalSessions: [],
      activeTerminalSessionId: null,
      hasAutoCreatedInitialTerminalSession: false,
      workingDirectory: '',
      runProfiles: [],
      isLoadingProfiles: false,
      profilesError: null,
      runOutputs: {},
      runCompounds: {},
      activeRunOutputId: null,
      runOutputViewMode: 'merged' as RunOutputViewMode,
      runOutputAutoScroll: true,
      stoppingProfileIds: [],
      restartingProfileIds: [],
      runHistory: {},
      waveformData: {},
      hiddenProfileIds: [],
      runStartTimestamps: {},
      stopRequestTimestamps: {},
      isRestoringWorkspace: false,
      recentWorkspaces: [],
      recentWorkspacesVersion: 0,
      gitBranch: '',
      editorSyntaxTheme: loadInitialSyntaxTheme(),
      pendingEditorNavigation: null,

      // Workspace actions
      setWorkspace: (workspace) =>
        set({ workspace, workingDirectory: workspace?.path ?? '' }, false, 'setWorkspace'),

      setWorkspaces: (defs) =>
        set(
          (state) => {
            const activeValid = defs.some((d) => d.id === state.activeWorkspaceId);
            const nextActive = activeValid ? state.activeWorkspaceId : 'project';

            const lastStillValid =
              state.lastFocusedWorkspaceId !== null &&
              defs.some((d) => d.id === state.lastFocusedWorkspaceId);
            let nextLast = lastStillValid ? state.lastFocusedWorkspaceId : null;

            // If the active workspace is a real (non-project) workspace, lastFocused follows it.
            if (nextActive !== 'project') {
              nextLast = nextActive;
            }

            return {
              workspaces: defs,
              activeWorkspaceId: nextActive,
              lastFocusedWorkspaceId: nextLast,
            };
          },
          false,
          'setWorkspaces'
        ),

      setActiveWorkspace: (id) =>
        set(
          (state) => {
            const valid = state.workspaces.some((d) => d.id === id);
            const nextId = valid ? id : 'project';
            return {
              activeWorkspaceId: nextId,
              lastFocusedWorkspaceId: nextId !== 'project' ? nextId : state.lastFocusedWorkspaceId,
            };
          },
          false,
          'setActiveWorkspace'
        ),

      setTreeViewMode: (mode) =>
        set(
          (state) => {
            if (mode === 'project') {
              return { activeWorkspaceId: 'project' };
            }
            const candidates = state.workspaces.filter((w) => w.id !== 'project');
            const lastValid =
              state.lastFocusedWorkspaceId &&
              candidates.some((w) => w.id === state.lastFocusedWorkspaceId)
                ? state.lastFocusedWorkspaceId
                : null;
            const firstNonRoot = candidates.find((w) => w.relDir !== '');
            const firstRoot = candidates.find((w) => w.relDir === '');
            const target = lastValid ?? firstNonRoot?.id ?? firstRoot?.id ?? 'project';
            return {
              activeWorkspaceId: target,
              lastFocusedWorkspaceId: target !== 'project' ? target : state.lastFocusedWorkspaceId,
            };
          },
          false,
          'setTreeViewMode'
        ),

      setLoading: (isLoading) => set({ isLoading }, false, 'setLoading'),

      // File Explorer actions
      setDirectoryTree: (directoryTree) =>
        set({ directoryTree, treeError: null, isLoadingTree: false }, false, 'setDirectoryTree'),

      toggleExpanded: (path) =>
        set(
          (state) => {
            const newExpanded = new Set(state.expandedPaths);
            if (newExpanded.has(path)) {
              newExpanded.delete(path);
            } else {
              newExpanded.add(path);
            }
            return { expandedPaths: newExpanded };
          },
          false,
          'toggleExpanded'
        ),

      setSelectedPath: (selectedPath) => set({ selectedPath }, false, 'setSelectedPath'),

      toggleRootExpanded: () =>
        set((state) => ({ isRootExpanded: !state.isRootExpanded }), false, 'toggleRootExpanded'),

      setTreeLoading: (isLoadingTree) => set({ isLoadingTree }, false, 'setTreeLoading'),

      setTreeError: (treeError) => set({ treeError, isLoadingTree: false }, false, 'setTreeError'),

      // Sidebar actions
      setSidebarView: (activeSidebarView) => set({ activeSidebarView }, false, 'setSidebarView'),

      // Panel actions
      toggleLeftPanel: () =>
        set(
          (state) => ({ isLeftPanelCollapsed: !state.isLeftPanelCollapsed }),
          false,
          'toggleLeftPanel'
        ),

      toggleRightPanel: () =>
        set(
          (state) => ({ isRightPanelCollapsed: !state.isRightPanelCollapsed }),
          false,
          'toggleRightPanel'
        ),

      toggleBottomPanel: () =>
        set(
          (state) => ({ isBottomPanelCollapsed: !state.isBottomPanelCollapsed }),
          false,
          'toggleBottomPanel'
        ),

      setPanelSize: (panel, size) => {
        const clamped = Math.max(0, Math.round(size));
        if (!Number.isFinite(clamped)) return;
        set(
          (state) => ({
            panelSizes: { ...state.panelSizes, [panel]: clamped },
          }),
          false,
          'setPanelSize'
        );
      },

      // Editor actions
      openFile: (file) =>
        set(
          (state) => {
            const exists = state.openFiles.some((f) => f.id === file.id);
            if (exists) {
              return { activeFileId: file.id };
            }
            return {
              openFiles: [...state.openFiles, file],
              activeFileId: file.id,
            };
          },
          false,
          'openFile'
        ),

      closeFile: (fileId) =>
        set(
          (state) => {
            const newFiles = state.openFiles.filter((f) => f.id !== fileId);
            const newActiveId =
              state.activeFileId === fileId
                ? (newFiles[newFiles.length - 1]?.id ?? null)
                : state.activeFileId;
            return { openFiles: newFiles, activeFileId: newActiveId };
          },
          false,
          'closeFile'
        ),

      setActiveFile: (activeFileId) => set({ activeFileId }, false, 'setActiveFile'),

      setCursorPosition: (cursorPosition) => set({ cursorPosition }, false, 'setCursorPosition'),

      setFileModified: (fileId, isModified) =>
        set(
          (state) => ({
            openFiles: state.openFiles.map((f) => (f.id === fileId ? { ...f, isModified } : f)),
          }),
          false,
          'setFileModified'
        ),

      updateFileContent: (fileId, content) =>
        set(
          (state) => ({
            openFiles: state.openFiles.map((f) => {
              if (f.id !== fileId) return f;
              if (f.content === content) return f;
              return { ...f, content, isModified: true };
            }),
          }),
          false,
          'updateFileContent'
        ),

      // Toast actions
      showToast: (message, type) => set({ toast: { message, type } }, false, 'showToast'),

      clearToast: () => set({ toast: null }, false, 'clearToast'),

      // Terminal actions
      setTerminalTab: (activeTerminalTab) => set({ activeTerminalTab }, false, 'setTerminalTab'),

      addTerminalSession: (session) =>
        set(
          (state) => ({
            terminalSessions: [...state.terminalSessions, session],
            activeTerminalSessionId: session.id,
          }),
          false,
          'addTerminalSession'
        ),

      removeTerminalSession: (sessionId) =>
        set(
          (state) => {
            const oldIndex = state.terminalSessions.findIndex((s) => s.id === sessionId);
            const newSessions = state.terminalSessions.filter((s) => s.id !== sessionId);
            let newActiveId = state.activeTerminalSessionId;
            if (state.activeTerminalSessionId === sessionId) {
              // Fall back to adjacent session: prefer left neighbor, then right, then null
              const fallbackIndex = Math.min(oldIndex, newSessions.length - 1);
              newActiveId = fallbackIndex >= 0 ? newSessions[fallbackIndex].id : null;
            }
            return { terminalSessions: newSessions, activeTerminalSessionId: newActiveId };
          },
          false,
          'removeTerminalSession'
        ),

      setActiveTerminalSession: (sessionId) =>
        set({ activeTerminalSessionId: sessionId }, false, 'setActiveTerminalSession'),

      renameTerminalSession: (sessionId, title) =>
        set(
          (state) => ({
            terminalSessions: state.terminalSessions.map((s) =>
              s.id === sessionId ? { ...s, title } : s
            ),
          }),
          false,
          'renameTerminalSession'
        ),

      reorderTerminalSessions: (fromIndex, toIndex) =>
        set(
          (state) => {
            if (
              fromIndex === toIndex ||
              fromIndex < 0 ||
              toIndex < 0 ||
              fromIndex >= state.terminalSessions.length ||
              toIndex >= state.terminalSessions.length
            ) {
              return state;
            }
            const sessions = [...state.terminalSessions];
            const [moved] = sessions.splice(fromIndex, 1);
            sessions.splice(toIndex, 0, moved);
            return { terminalSessions: sessions };
          },
          false,
          'reorderTerminalSessions'
        ),

      markInitialTerminalSessionCreated: () =>
        set(
          { hasAutoCreatedInitialTerminalSession: true },
          false,
          'markInitialTerminalSessionCreated'
        ),

      setWorkingDirectory: (workingDirectory) =>
        set({ workingDirectory }, false, 'setWorkingDirectory'),

      // Run Profile actions
      setRunProfiles: (runProfiles) =>
        set(
          { runProfiles, profilesError: null, isLoadingProfiles: false },
          false,
          'setRunProfiles'
        ),

      setProfilesLoading: (isLoadingProfiles) =>
        set({ isLoadingProfiles }, false, 'setProfilesLoading'),

      setProfilesError: (profilesError) =>
        set({ profilesError, isLoadingProfiles: false }, false, 'setProfilesError'),

      addOrUpdateProfile: (profile) =>
        set(
          (state) => {
            const exists = state.runProfiles.some((p) => p.id === profile.id);
            if (exists) {
              return {
                runProfiles: state.runProfiles.map((p) => (p.id === profile.id ? profile : p)),
              };
            }
            return { runProfiles: [...state.runProfiles, profile] };
          },
          false,
          'addOrUpdateProfile'
        ),

      removeProfile: (id) =>
        set(
          (state) => ({
            runProfiles: state.runProfiles.filter((p) => p.id !== id),
          }),
          false,
          'removeProfile'
        ),

      // Run Output actions
      appendRunOutput: (chunk) => {
        // Composite (compound step) output is routed into runCompounds and must
        // never create an ordinary RunOutput tab, waveform, or lifecycle flag.
        const compoundKey = parseCompoundStepKey(chunk.profileId);
        if (compoundKey) {
          const { compoundId, stepIdx } = compoundKey;
          if (useIDEStore.getState().runCompounds[compoundId]) {
            useIDEStore.getState().appendCompoundRunOutput(compoundId, stepIdx, chunk);
          }
          // Drop orphan (no compound) or return after routing — never fall
          // through to ordinary handling.
          return;
        }

        const currentState = useIDEStore.getState();

        if (!currentState.runOutputs[chunk.profileId]) {
          // Profile-specific stale event check: only drop if THIS profile is stopping/restarting
          const isStale =
            currentState.stoppingProfileIds.includes(chunk.profileId) ||
            currentState.restartingProfileIds.includes(chunk.profileId);
          if (isStale) return;

          // Create provisional RunOutput record — setRunState will upgrade it
          // when run:status arrives. This handles the race where run:output
          // arrives before run:status.
          set(
            (state) => ({
              runOutputs: {
                ...state.runOutputs,
                [chunk.profileId]: createRunOutput(
                  chunk.profileId,
                  getProfileWorkingDirSnapshot(state, chunk.profileId)
                ),
              },
            }),
            false,
            'appendRunOutput:provision'
          );
        }

        // Collect all lines from this chunk into a local array, then commit
        // to the store in a single set() call. This avoids store thrashing
        // when a chunk contains many newlines (e.g. npm install burst).
        const pendingEntries: OutputEntry[] = [];
        const collector = (entry: OutputEntry) => {
          pendingEntries.push(entry);
        };

        const assembler = getOrCreateAssembler(chunk.profileId, collector);
        assembler.push(chunk.stream, chunk.data, chunk.timestamp);

        if (pendingEntries.length === 0) return;

        set(
          (state) => {
            const existing = state.runOutputs[chunk.profileId];
            if (!existing) return state; // profile was cleared between check and set
            let entries = [...existing.entries, ...pendingEntries];
            if (entries.length > MAX_OUTPUT_ENTRIES) {
              entries = entries.slice(entries.length - MAX_OUTPUT_ENTRIES + 1);
              entries.unshift({
                stream: 'stdout',
                text: '[truncated — oldest output removed]',
                timestamp: entries[0]?.timestamp ?? Date.now(),
              });
            }
            return {
              runOutputs: {
                ...state.runOutputs,
                [chunk.profileId]: { ...existing, entries },
              },
            };
          },
          false,
          'appendRunOutput'
        );
      },

      setRunState: (profileId, newState, exitCode) => {
        // On terminal states, flush the line assembler's carry-over into a local
        // array so we can merge it into the store in a single set() call.
        // We can't reuse the appendRunOutput collector because it references a
        // dead pendingEntries array from a previous call.
        const flushedEntries: OutputEntry[] = [];
        if (newState === 'stopped' || newState === 'failed' || newState === 'success') {
          const assembler = lineAssemblers.get(profileId);
          if (assembler) {
            assemblerCallbacks.set(profileId, (entry) => flushedEntries.push(entry));
            assembler.flush();
            lineAssemblers.delete(profileId);
            assemblerCallbacks.delete(profileId);
          }
        }

        set(
          (state) => {
            const runWorkingDir = getProfileWorkingDirSnapshot(state, profileId);
            const existing =
              state.runOutputs[profileId] ?? createRunOutput(profileId, runWorkingDir);

            // Merge any flushed carry-over entries
            const mergedEntries =
              flushedEntries.length > 0
                ? [...existing.entries, ...flushedEntries]
                : existing.entries;

            const updated = { ...existing, state: newState, exitCode, entries: mergedEntries };

            if (newState === 'running') {
              const previousWorkingDir = existing.workingDir;
              updated.workingDir = runWorkingDir;
              updated.previousWorkingDir = undefined;
              updated.runCount = existing.runCount + 1;
              if (updated.runCount > 1) {
                let prev = existing.entries;
                if (prev.length > MAX_OUTPUT_ENTRIES) {
                  prev = prev.slice(prev.length - MAX_OUTPUT_ENTRIES);
                }
                updated.previousEntries = prev;
                updated.previousWorkingDir = previousWorkingDir;
                updated.entries = [];
                lineAssemblers.delete(profileId);
                assemblerCallbacks.delete(profileId);
              }
            }

            return {
              runOutputs: { ...state.runOutputs, [profileId]: updated },
            };
          },
          false,
          'setRunState'
        );
      },

      handleRunStatus: (profileId, newState, exitCode, timestamp) => {
        // Flush line assembler on terminal states (same as setRunState)
        const flushedEntries: OutputEntry[] = [];
        if (newState === 'stopped' || newState === 'failed' || newState === 'success') {
          const assembler = lineAssemblers.get(profileId);
          if (assembler) {
            assemblerCallbacks.set(profileId, (entry) => flushedEntries.push(entry));
            assembler.flush();
            lineAssemblers.delete(profileId);
            assemblerCallbacks.delete(profileId);
          }
        }

        set(
          (state) => {
            // --- RunOutput update (same logic as setRunState) ---
            const runWorkingDir = getProfileWorkingDirSnapshot(state, profileId);
            const existing =
              state.runOutputs[profileId] ?? createRunOutput(profileId, runWorkingDir);

            const mergedEntries =
              flushedEntries.length > 0
                ? [...existing.entries, ...flushedEntries]
                : existing.entries;

            const updated = { ...existing, state: newState, exitCode, entries: mergedEntries };

            if (newState === 'running') {
              const previousWorkingDir = existing.workingDir;
              updated.workingDir = runWorkingDir;
              updated.previousWorkingDir = undefined;
              updated.runCount = existing.runCount + 1;
              if (updated.runCount > 1) {
                let prev = existing.entries;
                if (prev.length > MAX_OUTPUT_ENTRIES) {
                  prev = prev.slice(prev.length - MAX_OUTPUT_ENTRIES);
                }
                updated.previousEntries = prev;
                updated.previousWorkingDir = previousWorkingDir;
                updated.entries = [];
                lineAssemblers.delete(profileId);
                assemblerCallbacks.delete(profileId);
              }
            }

            // --- Lifecycle flags ---
            let { stoppingProfileIds, restartingProfileIds } = state;

            if (newState === 'stopped' || newState === 'failed' || newState === 'success') {
              stoppingProfileIds = stoppingProfileIds.filter((id) => id !== profileId);
              restartingProfileIds = restartingProfileIds.filter((id) => id !== profileId);
            } else if (newState === 'running') {
              restartingProfileIds = restartingProfileIds.filter((id) => id !== profileId);
            }

            // --- Stop request timestamp ---
            let { stopRequestTimestamps } = state;
            if (
              newState === 'stopped' ||
              newState === 'failed' ||
              newState === 'success' ||
              newState === 'running'
            ) {
              if (stopRequestTimestamps[profileId] != null) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { [profileId]: _removed, ...rest } = stopRequestTimestamps;
                stopRequestTimestamps = rest;
              }
            }

            // --- Start timestamp ---
            let { runStartTimestamps } = state;
            if (newState === 'running') {
              runStartTimestamps = { ...runStartTimestamps, [profileId]: timestamp };
            }

            // --- Run history ---
            let { runHistory } = state;
            if (
              (newState === 'stopped' || newState === 'failed' || newState === 'success') &&
              state.runStartTimestamps[profileId]
            ) {
              const existingHistory = runHistory[profileId] ?? [];
              const entry: RunHistoryEntry = {
                state: newState as RunHistoryEntry['state'],
                duration: timestamp - state.runStartTimestamps[profileId],
                timestamp,
              };
              const updatedHistory = [...existingHistory, entry];
              const capped =
                updatedHistory.length > 50
                  ? updatedHistory.slice(updatedHistory.length - 50)
                  : updatedHistory;
              runHistory = { ...runHistory, [profileId]: capped };
            }

            // --- Auto-select first running profile ---
            let { activeRunOutputId } = state;
            if (
              newState === 'running' &&
              (!activeRunOutputId || activeRunOutputId === ALL_PROFILES_ID)
            ) {
              activeRunOutputId = profileId;
            }

            return {
              runOutputs: { ...state.runOutputs, [profileId]: updated },
              stoppingProfileIds,
              restartingProfileIds,
              stopRequestTimestamps,
              runStartTimestamps,
              runHistory,
              activeRunOutputId,
            };
          },
          false,
          'handleRunStatus'
        );
      },

      clearRunOutput: (profileId) => {
        // If this id refers to a compound run, clear its step outputs/assemblers
        // and keep the run record (mirrors clearCompoundRunOutput).
        if (useIDEStore.getState().runCompounds[profileId]) {
          useIDEStore.getState().clearCompoundRunOutput(profileId);
          return;
        }
        set(
          (state) => {
            const existing = state.runOutputs[profileId];
            if (!existing) return state;

            // If the profile is still running, only clear entries — preserve
            // the RunOutput record so state/runCount stay correct for the
            // active process. Otherwise remove the record entirely.
            if (existing.state === 'running') {
              // Reset assembler so partial carry-over doesn't leak into fresh output
              lineAssemblers.delete(profileId);
              assemblerCallbacks.delete(profileId);
              return {
                runOutputs: {
                  ...state.runOutputs,
                  [profileId]: {
                    ...existing,
                    entries: [],
                    previousEntries: [],
                    previousWorkingDir: undefined,
                  },
                },
              };
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [profileId]: _discarded, ...rest } = state.runOutputs;
            lineAssemblers.delete(profileId);
            assemblerCallbacks.delete(profileId);
            // If the cleared profile was active, select the first remaining or null
            let activeRunOutputId = state.activeRunOutputId;
            if (activeRunOutputId === profileId) {
              const remaining = Object.keys(rest);
              activeRunOutputId = remaining.length > 0 ? remaining[0] : null;
            }
            return { runOutputs: rest, activeRunOutputId };
          },
          false,
          'clearRunOutput'
        );
      },

      clearAllRunOutputs: () => {
        lineAssemblers.clear();
        assemblerCallbacks.clear();
        set(
          (state) => {
            // Preserve RunOutput records for still-running profiles so their
            // state/runCount stays correct. Only clear their entries.
            const preserved: Record<string, RunOutput> = {};
            for (const [id, output] of Object.entries(state.runOutputs)) {
              if (output.state === 'running') {
                preserved[id] = {
                  ...output,
                  entries: [],
                  previousEntries: [],
                  previousWorkingDir: undefined,
                };
              }
            }
            // Preserve still-running compounds (entries cleared). Dropping them
            // would orphan composite output chunks for the active step — they
            // would be ignored by appendRunOutput until the next snapshot.
            const preservedCompounds: Record<string, CompoundRun> = {};
            for (const [id, compound] of Object.entries(state.runCompounds)) {
              if (compound.state === 'running') {
                preservedCompounds[id] = { ...compound, stepOutputs: {} };
              }
            }
            const firstId = Object.keys(preserved)[0] ?? Object.keys(preservedCompounds)[0] ?? null;
            const activeStillValid =
              state.activeRunOutputId != null &&
              (preserved[state.activeRunOutputId] != null ||
                preservedCompounds[state.activeRunOutputId] != null);
            return {
              runOutputs: preserved,
              runCompounds: preservedCompounds,
              activeRunOutputId: activeStillValid ? state.activeRunOutputId : firstId,
            };
          },
          false,
          'clearAllRunOutputs'
        );
      },

      // Compound run actions
      handleCompoundRun: (event) => {
        const { compoundId, name, state: aggregateState, currentStep, steps } = event;

        // Snapshot the previous run so we can preserve outputs and detect
        // step transitions that became terminal this event.
        const prevRun = useIDEStore.getState().runCompounds[compoundId];
        const prevStepStates = new Map<number, string>();
        if (prevRun) {
          for (const step of prevRun.steps) {
            prevStepStates.set(step.idx, step.state);
          }
        }

        const isStepTerminal = (s: string) => s === 'success' || s === 'failed' || s === 'stopped';

        // Flush assemblers for steps that BECAME terminal this event, collecting
        // their carry-over before we touch the store (mirrors handleRunStatus).
        const flushedByStep = new Map<number, OutputEntry[]>();
        // Steps that transitioned into a terminal state this event (for history).
        const newlyTerminal: typeof steps = [];
        for (const step of steps) {
          const prevState = prevStepStates.get(step.idx);
          const becameTerminal = isStepTerminal(step.state) && !isStepTerminal(prevState ?? '');
          if (becameTerminal) {
            newlyTerminal.push(step);
            const flushed = flushAssembler(compoundStepAssemblerKey(compoundId, step.idx));
            if (flushed.length > 0) {
              flushedByStep.set(step.idx, flushed);
            }
          }
        }

        set(
          (state) => {
            const existing = state.runCompounds[compoundId];
            // A terminal compound transitioning back to running is a NEW run of
            // the same profile: start its step outputs fresh instead of carrying
            // the previous execution's output into the new run.
            const isNewRun =
              existing != null && isStepTerminal(existing.state) && aggregateState === 'running';
            const preservedOutputs: Record<number, OutputEntry[]> = isNewRun
              ? {}
              : { ...(existing?.stepOutputs ?? {}) };

            // Merge flushed carry-over into the corresponding step outputs.
            for (const [stepIdx, flushed] of flushedByStep) {
              const current = preservedOutputs[stepIdx] ?? [];
              let merged = [...current, ...flushed];
              if (merged.length > MAX_OUTPUT_ENTRIES) {
                merged = merged.slice(merged.length - MAX_OUTPUT_ENTRIES);
              }
              preservedOutputs[stepIdx] = merged;
            }

            // --- Selected step ---
            let selectedStepIdx: number | undefined;
            const runningStep = steps.find((s) => s.state === 'running');
            if (runningStep) {
              selectedStepIdx = runningStep.idx;
            } else if (aggregateState === 'failed') {
              selectedStepIdx = steps.find((s) => s.state === 'failed')?.idx;
            }
            if (selectedStepIdx == null) {
              selectedStepIdx = existing?.selectedStepIdx ?? currentStep ?? 0;
            }

            // --- Run history (only for steps that became terminal this event) ---
            let runHistory = state.runHistory;
            for (const step of newlyTerminal) {
              if (step.startedAt == null || step.endedAt == null) continue;
              if (step.state !== 'success' && step.state !== 'failed' && step.state !== 'stopped') {
                continue;
              }
              const existingHistory = runHistory[step.profileId] ?? [];
              const entry: RunHistoryEntry = {
                state: step.state,
                duration: step.endedAt - step.startedAt,
                timestamp: step.endedAt,
              };
              const updatedHistory = [...existingHistory, entry];
              const capped =
                updatedHistory.length > 50
                  ? updatedHistory.slice(updatedHistory.length - 50)
                  : updatedHistory;
              runHistory = { ...runHistory, [step.profileId]: capped };
            }

            // --- Failed reference ---
            let failedReference: CompoundRun['failedReference'];
            if (aggregateState === 'failed') {
              const failedStep = steps.find((s) => s.state === 'failed');
              if (failedStep) {
                const text = (preservedOutputs[failedStep.idx] ?? [])
                  .map((entry) => entry.text)
                  .join('\n');
                const refs = parseFileReferences(text);
                if (refs.length > 0) {
                  const ref = refs[0];
                  failedReference = {
                    stepIdx: failedStep.idx,
                    path: ref.path,
                    line: ref.line,
                    column: ref.column,
                  };
                }
              }
            }

            // --- ETA (best-effort sum of running remaining + pending estimates) ---
            let etaMs: number | undefined;
            let etaTotal = 0;
            let etaHasValue = false;
            for (const step of steps) {
              const history = runHistory[step.profileId] ?? [];
              if (step.state === 'running') {
                const elapsed = step.startedAt != null ? Date.now() - step.startedAt : 0;
                const remaining = estimateRemaining(history, Math.max(0, elapsed));
                if (remaining != null) {
                  etaTotal += remaining;
                  etaHasValue = true;
                }
              } else if (step.state === 'pending') {
                const estimate = estimateDuration(history);
                if (estimate != null) {
                  etaTotal += estimate;
                  etaHasValue = true;
                }
              }
            }
            if (etaHasValue) {
              etaMs = etaTotal;
            }

            const newRun: CompoundRun = {
              compoundId,
              name,
              state: aggregateState,
              currentStep,
              etaMs,
              steps,
              stepOutputs: preservedOutputs,
              selectedStepIdx,
              failedReference,
            };

            return {
              runCompounds: { ...state.runCompounds, [compoundId]: newRun },
              runHistory,
            };
          },
          false,
          'handleCompoundRun'
        );
      },

      appendCompoundRunOutput: (compoundId, stepIdx, chunk) => {
        const pendingEntries = collectChunkEntries(
          compoundStepAssemblerKey(compoundId, stepIdx),
          chunk
        );
        if (pendingEntries.length === 0) return;

        set(
          (state) => {
            const existing = state.runCompounds[compoundId];
            if (!existing) return state; // compound disappeared between calls

            const current = existing.stepOutputs[stepIdx] ?? [];
            let entries = [...current, ...pendingEntries];
            if (entries.length > MAX_OUTPUT_ENTRIES) {
              entries = entries.slice(entries.length - MAX_OUTPUT_ENTRIES + 1);
              entries.unshift({
                stream: 'stdout',
                text: '[truncated — oldest output removed]',
                timestamp: entries[0]?.timestamp ?? Date.now(),
              });
            }

            return {
              runCompounds: {
                ...state.runCompounds,
                [compoundId]: {
                  ...existing,
                  stepOutputs: { ...existing.stepOutputs, [stepIdx]: entries },
                },
              },
            };
          },
          false,
          'appendCompoundRunOutput'
        );
      },

      clearCompoundRunOutput: (compoundId) => {
        const existing = useIDEStore.getState().runCompounds[compoundId];
        if (existing) {
          for (const step of existing.steps) {
            const key = compoundStepAssemblerKey(compoundId, step.idx);
            lineAssemblers.delete(key);
            assemblerCallbacks.delete(key);
          }
        }
        set(
          (state) => {
            const run = state.runCompounds[compoundId];
            if (!run) return state;
            return {
              runCompounds: {
                ...state.runCompounds,
                [compoundId]: { ...run, stepOutputs: {} },
              },
            };
          },
          false,
          'clearCompoundRunOutput'
        );
      },

      setActiveRunOutput: (id) => set({ activeRunOutputId: id }, false, 'setActiveRunOutput'),

      setRunOutputViewMode: (mode) =>
        set({ runOutputViewMode: mode }, false, 'setRunOutputViewMode'),

      toggleAutoScroll: () =>
        set(
          (state) => ({ runOutputAutoScroll: !state.runOutputAutoScroll }),
          false,
          'toggleAutoScroll'
        ),

      // Process lifecycle actions
      setProfileStopping: (profileId) =>
        set(
          (state) => ({
            stoppingProfileIds: state.stoppingProfileIds.includes(profileId)
              ? state.stoppingProfileIds
              : [...state.stoppingProfileIds, profileId],
            stopRequestTimestamps:
              state.stopRequestTimestamps[profileId] != null
                ? state.stopRequestTimestamps
                : { ...state.stopRequestTimestamps, [profileId]: Date.now() },
          }),
          false,
          'setProfileStopping'
        ),

      clearProfileStopping: (profileId) =>
        set(
          (state) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [profileId]: _removed, ...restTimestamps } = state.stopRequestTimestamps;
            return {
              stoppingProfileIds: state.stoppingProfileIds.filter((id) => id !== profileId),
              stopRequestTimestamps: restTimestamps,
            };
          },
          false,
          'clearProfileStopping'
        ),

      setProfileRestarting: (profileId) =>
        set(
          (state) => ({
            restartingProfileIds: state.restartingProfileIds.includes(profileId)
              ? state.restartingProfileIds
              : [...state.restartingProfileIds, profileId],
            stopRequestTimestamps:
              state.stopRequestTimestamps[profileId] != null
                ? state.stopRequestTimestamps
                : { ...state.stopRequestTimestamps, [profileId]: Date.now() },
          }),
          false,
          'setProfileRestarting'
        ),

      clearProfileRestarting: (profileId) =>
        set(
          (state) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [profileId]: _removed, ...restTimestamps } = state.stopRequestTimestamps;
            return {
              restartingProfileIds: state.restartingProfileIds.filter((id) => id !== profileId),
              stopRequestTimestamps: restTimestamps,
            };
          },
          false,
          'clearProfileRestarting'
        ),

      appendRunHistory: (profileId, entry) =>
        set(
          (state) => {
            const existing = state.runHistory[profileId] ?? [];
            const updated = [...existing, entry];
            const capped = updated.length > 50 ? updated.slice(updated.length - 50) : updated;
            return { runHistory: { ...state.runHistory, [profileId]: capped } };
          },
          false,
          'appendRunHistory'
        ),

      updateWaveform: (profileId, entryCount) =>
        set(
          (state) => {
            const existing = state.waveformData[profileId] ?? new Array(12).fill(0);
            const shifted = [...existing.slice(1), entryCount];
            return { waveformData: { ...state.waveformData, [profileId]: shifted } };
          },
          false,
          'updateWaveform'
        ),

      hideProfile: (id) =>
        set(
          (state) => ({
            hiddenProfileIds: state.hiddenProfileIds.includes(id)
              ? state.hiddenProfileIds
              : [...state.hiddenProfileIds, id],
          }),
          false,
          'hideProfile'
        ),

      unhideProfile: (id) =>
        set(
          (state) => ({
            hiddenProfileIds: state.hiddenProfileIds.filter((hid) => hid !== id),
          }),
          false,
          'unhideProfile'
        ),

      focusProfileOutput: (profileId) =>
        set(
          () => ({
            activeRunOutputId: profileId,
            activeTerminalTab: 'output' as TerminalTab,
            isBottomPanelCollapsed: false,
          }),
          false,
          'focusProfileOutput'
        ),

      resetWorkspaceRunState: () => {
        // Clear line assemblers (same as clearAllRunOutputs does)
        lineAssemblers.clear();
        assemblerCallbacks.clear();
        // Atomic single set: clear output entries + lifecycle state together
        set(
          (state) => {
            // Preserve RunOutput records for still-running profiles (same logic as clearAllRunOutputs)
            const preserved: Record<string, RunOutput> = {};
            for (const [id, output] of Object.entries(state.runOutputs)) {
              if (output.state === 'running') {
                preserved[id] = {
                  ...output,
                  entries: [],
                  previousEntries: [],
                  previousWorkingDir: undefined,
                };
              }
            }
            const firstId = Object.keys(preserved)[0] ?? null;
            return {
              runOutputs: preserved,
              runCompounds: {},
              activeRunOutputId: firstId,
              stoppingProfileIds: [],
              restartingProfileIds: [],
              runHistory: {},
              waveformData: {},
              hiddenProfileIds: [],
              runStartTimestamps: {},
              stopRequestTimestamps: {},
            };
          },
          false,
          'resetWorkspaceRunState'
        );
      },

      // Per-file view state actions
      setScrollPosition: (fileId, scrollTop) =>
        set(
          (state) => ({
            scrollPositions: { ...state.scrollPositions, [fileId]: scrollTop },
          }),
          false,
          'setScrollPosition'
        ),

      setFileCursorPosition: (fileId, position) =>
        set(
          (state) => ({
            cursorPositions: { ...state.cursorPositions, [fileId]: position },
          }),
          false,
          'setFileCursorPosition'
        ),

      // Workspace persistence actions
      setRestoringWorkspace: (isRestoringWorkspace) =>
        set({ isRestoringWorkspace }, false, 'setRestoringWorkspace'),

      resetWorkspaceSession: () =>
        set(createDefaultWorkspaceSessionState(), false, 'resetWorkspaceSession'),

      // Recent workspaces actions
      setRecentWorkspaces: (recentWorkspaces) =>
        set({ recentWorkspaces }, false, 'setRecentWorkspaces'),

      // Status actions
      setGitBranch: (gitBranch) => set({ gitBranch }, false, 'setGitBranch'),

      setEditorSyntaxTheme: (id) => {
        if (!isSyntaxThemeId(id)) return;
        set({ editorSyntaxTheme: id }, false, 'setEditorSyntaxTheme');
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SYNTAX_THEME_STORAGE_KEY, id);
          }
        } catch {
          // localStorage may be unavailable (private mode / WebView quirks); state still updates.
        }
      },

      // Editor navigation actions
      requestEditorNavigation: (fileId, line, column) =>
        set(
          (state) => ({
            pendingEditorNavigation: {
              fileId,
              line,
              column,
              revision: (state.pendingEditorNavigation?.revision ?? 0) + 1,
            },
          }),
          false,
          'requestEditorNavigation'
        ),

      clearPendingEditorNavigation: (fileId, revision) =>
        set(
          (state) => {
            const nav = state.pendingEditorNavigation;
            if (nav && nav.fileId === fileId && nav.revision === revision) {
              return { pendingEditorNavigation: null };
            }
            return {};
          },
          false,
          'clearPendingEditorNavigation'
        ),

      // Navigation history actions
      pushNavigationHistory: (entry) =>
        set(
          (state) => {
            const history = [...state.navigationHistory, entry];
            if (history.length > MAX_NAVIGATION_HISTORY) {
              history.splice(0, history.length - MAX_NAVIGATION_HISTORY);
            }
            return { navigationHistory: history, navigationForward: [] };
          },
          false,
          'pushNavigationHistory'
        ),

      goBack: (current: NavigationLocation) => {
        const state = get();
        if (state.navigationHistory.length === 0) return undefined;
        const entry = state.navigationHistory[state.navigationHistory.length - 1];
        set(
          {
            navigationHistory: state.navigationHistory.slice(0, -1),
            navigationForward: [...state.navigationForward, current],
          },
          false,
          'goBack'
        );
        return entry;
      },

      goForward: (current: NavigationLocation) => {
        const state = get();
        if (state.navigationForward.length === 0) return undefined;
        const entry = state.navigationForward[state.navigationForward.length - 1];
        set(
          {
            navigationHistory: [...state.navigationHistory, current],
            navigationForward: state.navigationForward.slice(0, -1),
          },
          false,
          'goForward'
        );
        return entry;
      },
    }),
    { name: 'ide-store' }
  )
);

// Selector hooks for common use cases
// These use stable selectors to prevent unnecessary re-renders
export const useWorkspace = () => useIDEStore((state) => state.workspace);
export const useWorkspaces = () => useIDEStore((state) => state.workspaces);
export const useActiveWorkspaceId = () => useIDEStore((state) => state.activeWorkspaceId);
export const useActiveWorkspace = () =>
  useIDEStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null);
export const useTreeViewMode = (): 'project' | 'workspace' =>
  useIDEStore((state) => (state.activeWorkspaceId === 'project' ? 'project' : 'workspace'));
export const useCanFocusWorkspace = (): boolean =>
  useIDEStore((state) => state.workspaces.some((w) => w.id !== 'project'));
export const useActiveAccent = (): WorkspaceAccent =>
  useIDEStore(
    (state) =>
      (state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.accent as WorkspaceAccent) ??
      'project'
  );
export const useIsLoading = () => useIDEStore((state) => state.isLoading);
export const useSidebarView = () => useIDEStore((state) => state.activeSidebarView);
export const useIsLeftPanelCollapsed = () => useIDEStore((state) => state.isLeftPanelCollapsed);
export const useIsRightPanelCollapsed = () => useIDEStore((state) => state.isRightPanelCollapsed);
export const useIsBottomPanelCollapsed = () => useIDEStore((state) => state.isBottomPanelCollapsed);
export const useOpenFiles = () => useIDEStore((state) => state.openFiles);
export const useActiveFileId = () => useIDEStore((state) => state.activeFileId);
export const useActiveFile = () =>
  useIDEStore((state) => {
    const activeFileId = state.activeFileId;
    return activeFileId ? (state.openFiles.find((f) => f.id === activeFileId) ?? null) : null;
  });
export const useCursorPosition = () => useIDEStore((state) => state.cursorPosition);
export const useTerminalTab = () => useIDEStore((state) => state.activeTerminalTab);
export const useTerminalSessions = () => useIDEStore((state) => state.terminalSessions);
export const useActiveTerminalSessionId = () =>
  useIDEStore((state) => state.activeTerminalSessionId);
export const useActiveTerminalSession = () =>
  useIDEStore((state) => {
    const id = state.activeTerminalSessionId;
    return id ? (state.terminalSessions.find((s) => s.id === id) ?? null) : null;
  });
export const useGitBranch = () => useIDEStore((state) => state.gitBranch);
export const useEditorSyntaxTheme = (): SyntaxThemeId =>
  useIDEStore((state) => state.editorSyntaxTheme);
export const useDirectoryTree = () => useIDEStore((state) => state.directoryTree);
export const useExpandedPaths = () => useIDEStore((state) => state.expandedPaths);
export const useSelectedPath = () => useIDEStore((state) => state.selectedPath);
export const useIsRootExpanded = () => useIDEStore((state) => state.isRootExpanded);
export const useIsLoadingTree = () => useIDEStore((state) => state.isLoadingTree);
export const useTreeError = () => useIDEStore((state) => state.treeError);
export const useToast = () => useIDEStore((state) => state.toast);
export const useRunProfiles = () => useIDEStore((state) => state.runProfiles);
export const useDetectedProfiles = () =>
  useIDEStore(useShallow((state) => state.runProfiles.filter((p) => p.source === 'detected')));
export const useSavedProfiles = () =>
  useIDEStore(useShallow((state) => state.runProfiles.filter((p) => p.source === 'user')));
export const useIsLoadingProfiles = () => useIDEStore((state) => state.isLoadingProfiles);
export const useProfilesError = () => useIDEStore((state) => state.profilesError);
export const useRecentWorkspaces = () => useIDEStore((state) => state.recentWorkspaces);
export const useRunOutputs = () => useIDEStore((state) => state.runOutputs);
export const useRunCompounds = () => useIDEStore((state) => state.runCompounds);
export const useActiveRunOutputId = () => useIDEStore((state) => state.activeRunOutputId);
export const useActiveRunOutput = () =>
  useIDEStore((state) => {
    const id = state.activeRunOutputId;
    return id && id !== '__all__' ? (state.runOutputs[id] ?? null) : null;
  });
export const useActiveCompoundRun = () =>
  useIDEStore((state) => {
    const id = state.activeRunOutputId;
    return id ? (state.runCompounds[id] ?? null) : null;
  });
export const useRunOutputViewMode = () => useIDEStore((state) => state.runOutputViewMode);
export const useRunOutputAutoScroll = () => useIDEStore((state) => state.runOutputAutoScroll);

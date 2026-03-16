import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { filesystem, workspace } from '../../wailsjs/go/models';
import type { RunProfile } from '../types/runProfile';
import { LineAssembler } from '../utils/lineAssembler';
import type {
  OutputChunk,
  OutputEntry,
  RunHistoryEntry,
  RunOutput,
  RunState,
  RunOutputViewMode,
} from '../types/runOutput';
import { MAX_OUTPUT_ENTRIES } from '../types/runOutput';

// Types
export type SidebarView = 'explorer' | 'search' | 'git' | 'run';
export type TerminalTab = 'terminal' | 'output' | 'problems';

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
  };
}

interface IDEState {
  // Workspace
  workspace: WorkspaceInfo | null;
  isLoading: boolean;

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
  workingDirectory: string;

  // Run Profiles
  runProfiles: RunProfile[];
  isLoadingProfiles: boolean;
  profilesError: string | null;

  // Run Output
  runOutputs: Record<string, RunOutput>;
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
  errorCount: number;
  warningCount: number;
}

interface IDEActions {
  // Workspace actions
  setWorkspace: (workspace: WorkspaceInfo | null) => void;
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
  clearRunOutput: (profileId: string) => void;
  clearAllRunOutputs: () => void;
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
  setDiagnostics: (errors: number, warnings: number) => void;
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

export const useIDEStore = create<IDEStore>()(
  devtools(
    (set) => ({
      // Initial state
      workspace: null,
      isLoading: false,
      directoryTree: [],
      isLoadingTree: false,
      treeError: null,
      ...createDefaultWorkspaceSessionState(),
      toast: null,
      activeTerminalTab: 'terminal',
      terminalSessions: [],
      activeTerminalSessionId: null,
      workingDirectory: '',
      runProfiles: [],
      isLoadingProfiles: false,
      profilesError: null,
      runOutputs: {},
      activeRunOutputId: null,
      runOutputViewMode: 'merged' as RunOutputViewMode,
      runOutputAutoScroll: true,
      stoppingProfileIds: [],
      restartingProfileIds: [],
      runHistory: {},
      waveformData: {},
      hiddenProfileIds: [],
      runStartTimestamps: {},
      isRestoringWorkspace: false,
      recentWorkspaces: [],
      recentWorkspacesVersion: 0,
      gitBranch: '',
      errorCount: 0,
      warningCount: 0,

      // Workspace actions
      setWorkspace: (workspace) =>
        set({ workspace, workingDirectory: workspace?.path ?? '' }, false, 'setWorkspace'),

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
                [chunk.profileId]: {
                  profileId: chunk.profileId,
                  state: 'idle' as RunState,
                  exitCode: 0,
                  runCount: 0,
                  entries: [],
                  previousEntries: [],
                },
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
            const existing = state.runOutputs[profileId] ?? {
              profileId,
              state: 'idle' as RunState,
              exitCode: 0,
              runCount: 0,
              entries: [],
              previousEntries: [],
            };

            // Merge any flushed carry-over entries
            const mergedEntries =
              flushedEntries.length > 0
                ? [...existing.entries, ...flushedEntries]
                : existing.entries;

            const updated = { ...existing, state: newState, exitCode, entries: mergedEntries };

            if (newState === 'running') {
              updated.runCount = existing.runCount + 1;
              if (updated.runCount > 1) {
                let prev = existing.entries;
                if (prev.length > MAX_OUTPUT_ENTRIES) {
                  prev = prev.slice(prev.length - MAX_OUTPUT_ENTRIES);
                }
                updated.previousEntries = prev;
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

      clearRunOutput: (profileId) =>
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
                  [profileId]: { ...existing, entries: [], previousEntries: [] },
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
        ),

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
                preserved[id] = { ...output, entries: [], previousEntries: [] };
              }
            }
            const firstId = Object.keys(preserved)[0] ?? null;
            return { runOutputs: preserved, activeRunOutputId: firstId };
          },
          false,
          'clearAllRunOutputs'
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
            stoppingProfileIds: [...state.stoppingProfileIds, profileId],
          }),
          false,
          'setProfileStopping'
        ),

      clearProfileStopping: (profileId) =>
        set(
          (state) => ({
            stoppingProfileIds: state.stoppingProfileIds.filter((id) => id !== profileId),
          }),
          false,
          'clearProfileStopping'
        ),

      setProfileRestarting: (profileId) =>
        set(
          (state) => ({
            restartingProfileIds: [...state.restartingProfileIds, profileId],
          }),
          false,
          'setProfileRestarting'
        ),

      clearProfileRestarting: (profileId) =>
        set(
          (state) => ({
            restartingProfileIds: state.restartingProfileIds.filter((id) => id !== profileId),
          }),
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
        // First clear output entries via existing action
        useIDEStore.getState().clearAllRunOutputs();
        // Then clear lifecycle state
        set(
          () => ({
            stoppingProfileIds: [],
            restartingProfileIds: [],
            runHistory: {},
            waveformData: {},
            hiddenProfileIds: [],
            runStartTimestamps: {},
          }),
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

      setDiagnostics: (errorCount, warningCount) =>
        set({ errorCount, warningCount }, false, 'setDiagnostics'),
    }),
    { name: 'ide-store' }
  )
);

// Selector hooks for common use cases
// These use stable selectors to prevent unnecessary re-renders
export const useWorkspace = () => useIDEStore((state) => state.workspace);
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
export const useErrorCount = () => useIDEStore((state) => state.errorCount);
export const useWarningCount = () => useIDEStore((state) => state.warningCount);
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
export const useActiveRunOutputId = () => useIDEStore((state) => state.activeRunOutputId);
export const useActiveRunOutput = () =>
  useIDEStore((state) => {
    const id = state.activeRunOutputId;
    return id && id !== '__all__' ? (state.runOutputs[id] ?? null) : null;
  });
export const useRunOutputViewMode = () => useIDEStore((state) => state.runOutputViewMode);
export const useRunOutputAutoScroll = () => useIDEStore((state) => state.runOutputAutoScroll);

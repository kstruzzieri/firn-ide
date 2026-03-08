import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { filesystem } from '../../wailsjs/go/models';
import type { RunProfile } from '../types/runProfile';

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

  // Status actions
  setGitBranch: (branch: string) => void;
  setDiagnostics: (errors: number, warnings: number) => void;
}

type IDEStore = IDEState & IDEActions;

export const useIDEStore = create<IDEStore>()(
  devtools(
    (set) => ({
      // Initial state
      workspace: null,
      isLoading: false,
      directoryTree: [],
      expandedPaths: new Set<string>(),
      selectedPath: null,
      isRootExpanded: true,
      isLoadingTree: false,
      treeError: null,
      activeSidebarView: 'explorer',
      isLeftPanelCollapsed: false,
      isRightPanelCollapsed: false,
      isBottomPanelCollapsed: false,
      panelSizes: { left: 260, right: 280, bottom: 200 },
      openFiles: [],
      activeFileId: null,
      cursorPosition: { line: 1, column: 1 },
      toast: null,
      activeTerminalTab: 'terminal',
      terminalSessions: [],
      activeTerminalSessionId: null,
      workingDirectory: '',
      runProfiles: [],
      isLoadingProfiles: false,
      profilesError: null,
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

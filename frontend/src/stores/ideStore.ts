import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { filesystem } from '../../wailsjs/go/models';

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
  content: string;
  isModified: boolean;
}

export interface CursorPosition {
  line: number;
  column: number;
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

  // Panel visibility
  isLeftPanelCollapsed: boolean;

  // Editor
  openFiles: EditorFile[];
  activeFileId: string | null;
  cursorPosition: CursorPosition;

  // Terminal
  activeTerminalTab: TerminalTab;
  workingDirectory: string;

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

  // Editor actions
  openFile: (file: EditorFile) => void;
  closeFile: (fileId: string) => void;
  setActiveFile: (fileId: string | null) => void;
  setCursorPosition: (position: CursorPosition) => void;
  setFileModified: (fileId: string, isModified: boolean) => void;

  // Terminal actions
  setTerminalTab: (tab: TerminalTab) => void;
  setWorkingDirectory: (path: string) => void;

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
      openFiles: [],
      activeFileId: null,
      cursorPosition: { line: 1, column: 1 },
      activeTerminalTab: 'terminal',
      workingDirectory: '',
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

      // Terminal actions
      setTerminalTab: (activeTerminalTab) => set({ activeTerminalTab }, false, 'setTerminalTab'),

      setWorkingDirectory: (workingDirectory) =>
        set({ workingDirectory }, false, 'setWorkingDirectory'),

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
export const useOpenFiles = () => useIDEStore((state) => state.openFiles);
export const useActiveFileId = () => useIDEStore((state) => state.activeFileId);
export const useActiveFile = () =>
  useIDEStore((state) => {
    const activeFileId = state.activeFileId;
    return activeFileId ? (state.openFiles.find((f) => f.id === activeFileId) ?? null) : null;
  });
export const useCursorPosition = () => useIDEStore((state) => state.cursorPosition);
export const useTerminalTab = () => useIDEStore((state) => state.activeTerminalTab);
export const useGitBranch = () => useIDEStore((state) => state.gitBranch);
export const useErrorCount = () => useIDEStore((state) => state.errorCount);
export const useWarningCount = () => useIDEStore((state) => state.warningCount);
export const useDirectoryTree = () => useIDEStore((state) => state.directoryTree);
export const useExpandedPaths = () => useIDEStore((state) => state.expandedPaths);
export const useSelectedPath = () => useIDEStore((state) => state.selectedPath);
export const useIsRootExpanded = () => useIDEStore((state) => state.isRootExpanded);
export const useIsLoadingTree = () => useIDEStore((state) => state.isLoadingTree);
export const useTreeError = () => useIDEStore((state) => state.treeError);

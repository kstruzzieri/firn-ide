import { act, renderHook, waitFor } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';
import { filesystem } from '../../../wailsjs/go/models';
import { clearWorkspaceTreeCache, getCachedWorkspaceTree } from '../../utils/workspaceTreeCache';

const mockConfirmBeforeCloseReady = jest.fn(() => Promise.resolve());
let lastSavedWorkspaceState: unknown = null;
const mockSaveWorkspaceState = jest.fn((state: unknown) => {
  lastSavedWorkspaceState = state;
  return Promise.resolve();
});
const mockLoadWorkspaceState = jest.fn<Promise<unknown>, []>(() => Promise.resolve(null));
const mockReadFile = jest.fn();

let beforeCloseHandler: (() => void) | null = null;

jest.mock('../../../wailsjs/go/main/App', () => ({
  ConfirmBeforeCloseReady: mockConfirmBeforeCloseReady,
  SaveWorkspaceState: mockSaveWorkspaceState,
  LoadWorkspaceState: mockLoadWorkspaceState,
  ReadFile: mockReadFile,
}));

jest.mock('../../../wailsjs/runtime/runtime', () => ({
  EventsOn: jest.fn((event: string, callback: () => void) => {
    if (event === 'app:beforeclose') {
      beforeCloseHandler = callback;
    }
    return jest.fn();
  }),
}));

const mockEnsurePathLoaded = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

jest.mock('../../hooks/useEnsurePathLoaded', () => ({
  ensurePathLoaded: (...args: [string]) => mockEnsurePathLoaded(...args),
  __resetEnsurePathLoaded: jest.fn(),
  useEnsurePathLoaded: jest.fn(() => mockEnsurePathLoaded),
}));

import { useWorkspacePersistence } from '../../hooks/useWorkspacePersistence';

beforeEach(() => {
  jest.clearAllMocks();
  mockEnsurePathLoaded.mockResolvedValue(undefined);
  beforeCloseHandler = null;
  lastSavedWorkspaceState = null;
  clearWorkspaceTreeCache();

  useIDEStore.getState().resetWorkspaceSession();
  useIDEStore.setState({
    workspace: null,
    directoryTree: [],
    isLoadingTree: false,
    treeError: null,
    toast: null,
    isRestoringWorkspace: false,
  });
});

describe('useWorkspacePersistence', () => {
  it('resets workspace-scoped UI state to defaults when no saved session exists', async () => {
    useIDEStore.setState({
      workspace: { name: 'new-workspace', path: '/workspace/new-workspace' },
      activeSidebarView: 'git',
      isLeftPanelCollapsed: true,
      isRightPanelCollapsed: true,
      isBottomPanelCollapsed: true,
      panelSizes: { left: 320, right: 360, bottom: 140 },
      expandedPaths: new Set(['/workspace/new-workspace/src']),
      selectedPath: '/workspace/new-workspace/src',
      isRootExpanded: false,
      openFiles: [
        {
          id: '/workspace/new-workspace/main.ts',
          name: 'main.ts',
          path: '/workspace/new-workspace/main.ts',
          language: 'typescript',
          encoding: 'utf-8',
          lineEndings: 'LF',
          content: 'console.log("stale");',
          isModified: false,
        },
      ],
      activeFileId: '/workspace/new-workspace/main.ts',
      cursorPosition: { line: 9, column: 4 },
      scrollPositions: { '/workspace/new-workspace/main.ts': 48 },
      cursorPositions: { '/workspace/new-workspace/main.ts': { line: 9, column: 4 } },
    });

    renderHook(() => useWorkspacePersistence());

    await waitFor(() =>
      expect(mockLoadWorkspaceState).toHaveBeenCalledWith('/workspace/new-workspace')
    );
    await waitFor(() => expect(useIDEStore.getState().isRestoringWorkspace).toBe(false));

    const state = useIDEStore.getState();
    expect(state.activeSidebarView).toBe('explorer');
    expect(state.isLeftPanelCollapsed).toBe(false);
    expect(state.isRightPanelCollapsed).toBe(false);
    expect(state.isBottomPanelCollapsed).toBe(false);
    expect(state.panelSizes).toEqual({ left: 260, right: 280, bottom: 200 });
    expect(state.expandedPaths.size).toBe(0);
    expect(state.selectedPath).toBeNull();
    expect(state.isRootExpanded).toBe(true);
    expect(state.openFiles).toEqual([]);
    expect(state.activeFileId).toBeNull();
    expect(state.cursorPosition).toEqual({ line: 1, column: 1 });
    expect(state.scrollPositions).toEqual({});
    expect(state.cursorPositions).toEqual({});
  });

  it('acknowledges app close even when there is no workspace state to save', async () => {
    renderHook(() => useWorkspacePersistence());

    await waitFor(() => expect(beforeCloseHandler).not.toBeNull());

    act(() => {
      beforeCloseHandler?.();
    });

    await waitFor(() => expect(mockConfirmBeforeCloseReady).toHaveBeenCalledTimes(1));
    expect(mockSaveWorkspaceState).not.toHaveBeenCalled();
  });

  it('restores a cached explorer tree immediately from saved workspace state', async () => {
    mockLoadWorkspaceState.mockResolvedValueOnce({
      workspacePath: '/workspace/cached',
      workspaceName: 'cached',
      layout: null,
      editor: { activeFilePath: '', openFiles: [] },
      explorer: {
        expandedPaths: ['/workspace/cached/src'],
        rootExpanded: true,
        treeSnapshot: [
          filesystem.FileEntry.createFrom({
            name: 'src',
            path: '/workspace/cached/src',
            isDir: true,
            size: 0,
            modTime: new Date().toISOString(),
            children: [
              {
                name: 'App.tsx',
                path: '/workspace/cached/src/App.tsx',
                isDir: false,
                size: 123,
                modTime: new Date().toISOString(),
              },
            ],
          }),
        ],
      },
      activeSidebar: 'explorer',
      hiddenProfileIds: [],
    });

    useIDEStore.setState({
      workspace: { name: 'cached', path: '/workspace/cached' },
      directoryTree: [],
      isLoadingTree: true,
    });

    renderHook(() => useWorkspacePersistence());

    await waitFor(() => expect(mockLoadWorkspaceState).toHaveBeenCalledWith('/workspace/cached'));
    await waitFor(() =>
      expect(useIDEStore.getState().directoryTree[0]?.path).toBe('/workspace/cached/src')
    );

    expect(useIDEStore.getState().isLoadingTree).toBe(false);
  });

  it('hydrates expanded paths in ancestor-first order on restore', async () => {
    mockLoadWorkspaceState.mockResolvedValueOnce({
      workspacePath: '/r',
      workspaceName: 'r',
      layout: null,
      editor: { activeFilePath: '', openFiles: [] },
      explorer: {
        // deliberately deep-first to verify sorting
        expandedPaths: ['/r/a/b', '/r/a'],
        rootExpanded: true,
      },
      activeSidebar: 'explorer',
      hiddenProfileIds: [],
    });

    useIDEStore.setState({
      workspace: { name: 'r', path: '/r' },
      directoryTree: [],
      isLoadingTree: false,
    });

    renderHook(() => useWorkspacePersistence());

    await waitFor(() => expect(mockLoadWorkspaceState).toHaveBeenCalledWith('/r'));
    await waitFor(() => expect(useIDEStore.getState().isRestoringWorkspace).toBe(false));

    const calls = mockEnsurePathLoaded.mock.calls.map((c) => c[0]);
    expect(calls).toContain('/r/a');
    expect(calls).toContain('/r/a/b');
    // /r/a (depth 2) must be called before /r/a/b (depth 3)
    expect(calls.indexOf('/r/a')).toBeLessThan(calls.indexOf('/r/a/b'));
  });

  it('does not hydrate expanded paths outside the current workspace root', async () => {
    mockLoadWorkspaceState.mockResolvedValueOnce({
      workspacePath: '/r',
      workspaceName: 'r',
      layout: null,
      editor: { activeFilePath: '', openFiles: [] },
      explorer: {
        expandedPaths: ['/r/a', '/other/x'],
        rootExpanded: true,
      },
      activeSidebar: 'explorer',
      hiddenProfileIds: [],
    });

    useIDEStore.setState({
      workspace: { name: 'r', path: '/r' },
      directoryTree: [],
      isLoadingTree: false,
    });

    renderHook(() => useWorkspacePersistence());

    await waitFor(() => expect(mockLoadWorkspaceState).toHaveBeenCalledWith('/r'));
    await waitFor(() => expect(useIDEStore.getState().isRestoringWorkspace).toBe(false));

    const calls = mockEnsurePathLoaded.mock.calls.map((c) => c[0]);
    expect(calls).toContain('/r/a');
    expect(calls).not.toContain('/other/x');
  });

  it('hydrates Windows expanded paths under the current workspace root', async () => {
    mockLoadWorkspaceState.mockResolvedValueOnce({
      workspacePath: 'C:\\repo',
      workspaceName: 'repo',
      layout: null,
      editor: { activeFilePath: '', openFiles: [] },
      explorer: {
        expandedPaths: ['C:\\repo\\a\\b', 'C:\\repo\\a', 'D:\\other\\x'],
        rootExpanded: true,
      },
      activeSidebar: 'explorer',
      hiddenProfileIds: [],
    });

    useIDEStore.setState({
      workspace: { name: 'repo', path: 'C:\\repo' },
      directoryTree: [],
      isLoadingTree: false,
    });

    renderHook(() => useWorkspacePersistence());

    await waitFor(() => expect(mockLoadWorkspaceState).toHaveBeenCalledWith('C:\\repo'));
    await waitFor(() => expect(useIDEStore.getState().isRestoringWorkspace).toBe(false));

    const calls = mockEnsurePathLoaded.mock.calls.map((c) => c[0]);
    expect(calls).toContain('C:\\repo\\a');
    expect(calls).toContain('C:\\repo\\a\\b');
    expect(calls).not.toContain('D:\\other\\x');
    expect(calls.indexOf('C:\\repo\\a')).toBeLessThan(calls.indexOf('C:\\repo\\a\\b'));
  });

  it('persists tree snapshots when the directory tree changes', async () => {
    jest.useFakeTimers();

    try {
      useIDEStore.setState({
        workspace: { name: 'tree-save', path: '/workspace/tree-save' },
        directoryTree: [],
        isLoadingTree: false,
      });

      renderHook(() => useWorkspacePersistence());

      await waitFor(() =>
        expect(mockLoadWorkspaceState).toHaveBeenCalledWith('/workspace/tree-save')
      );
      await waitFor(() => expect(useIDEStore.getState().isRestoringWorkspace).toBe(false));

      const treeEntry = filesystem.FileEntry.createFrom({
        name: 'src',
        path: '/workspace/tree-save/src',
        isDir: true,
        size: 0,
        modTime: new Date().toISOString(),
      });

      act(() => {
        useIDEStore.getState().setDirectoryTree([treeEntry]);
      });

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      await waitFor(() => expect(mockSaveWorkspaceState).toHaveBeenCalled());

      const savedState = lastSavedWorkspaceState as {
        explorer: { treeSnapshot: filesystem.FileEntry[] };
      };
      expect(savedState.explorer.treeSnapshot).toEqual([treeEntry]);
      expect(getCachedWorkspaceTree('/workspace/tree-save')).toEqual([treeEntry]);
    } finally {
      jest.useRealTimers();
    }
  });
});

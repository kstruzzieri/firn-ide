import { act, renderHook, waitFor } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';

const mockConfirmBeforeCloseReady = jest.fn(() => Promise.resolve());
const mockSaveWorkspaceState = jest.fn(() => Promise.resolve());
const mockLoadWorkspaceState = jest.fn(() => Promise.resolve(null));
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

import { useWorkspacePersistence } from '../../hooks/useWorkspacePersistence';

beforeEach(() => {
  jest.clearAllMocks();
  beforeCloseHandler = null;

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
});

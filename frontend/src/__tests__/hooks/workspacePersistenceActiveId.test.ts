import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkspacePersistence } from '../../hooks/useWorkspacePersistence';
import { useIDEStore } from '../../stores/ideStore';
import { LoadWorkspaceState, SaveWorkspaceState } from '../../../wailsjs/go/main/App';

jest.mock('../../../wailsjs/go/main/App', () => ({
  SaveWorkspaceState: jest.fn(() => Promise.resolve()),
  LoadWorkspaceState: jest.fn(),
  DetectWorkspaces: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
  EventsOn: jest.fn(() => jest.fn()),
}));

const mockLoad = LoadWorkspaceState as jest.Mock;
const defs = [
  { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
  { id: 'frontend', name: 'Frontend', relDir: 'frontend', type: 'frontend', accent: 'blue' },
];

function savedState(activeWorkspaceId?: string) {
  return {
    workspacePath: '/repo',
    workspaceName: 'repo',
    activeWorkspaceId,
    layout: null,
    editor: { openFiles: [] },
    explorer: { expandedPaths: [] },
  };
}

beforeEach(() => {
  mockLoad.mockReset();
  useIDEStore.setState({ workspace: null, workspaces: [], activeWorkspaceId: 'project' });
});

it('restores a saved id even when detection has not populated workspaces yet (order-independent)', async () => {
  mockLoad.mockResolvedValue(savedState('frontend'));
  renderHook(() => useWorkspacePersistence());
  act(() => {
    useIDEStore.setState({ workspace: { name: 'repo', path: '/repo' } });
  });
  // restore applies the raw id while workspaces is still empty
  await waitFor(() => expect(useIDEStore.getState().activeWorkspaceId).toBe('frontend'));
  // detection completes later and re-validates: id is kept because it exists
  act(() => {
    useIDEStore.getState().setWorkspaces(defs as never);
  });
  expect(useIDEStore.getState().activeWorkspaceId).toBe('frontend');
});

it('an unknown saved id is corrected to project once detection populates the list', async () => {
  mockLoad.mockResolvedValue(savedState('ghost'));
  renderHook(() => useWorkspacePersistence());
  act(() => {
    useIDEStore.setState({ workspace: { name: 'repo', path: '/repo' } });
  });
  await waitFor(() => expect(mockLoad).toHaveBeenCalled());
  act(() => {
    useIDEStore.getState().setWorkspaces(defs as never); // 'ghost' not in list
  });
  expect(useIDEStore.getState().activeWorkspaceId).toBe('project');
});

it('no saved id leaves the active workspace at project', async () => {
  mockLoad.mockResolvedValue(savedState(undefined));
  renderHook(() => useWorkspacePersistence());
  act(() => {
    useIDEStore.setState({ workspace: { name: 'repo', path: '/repo' } });
  });
  await waitFor(() => expect(mockLoad).toHaveBeenCalled());
  expect(useIDEStore.getState().activeWorkspaceId).toBe('project');
});

it('schedules a save when the active workspace changes', async () => {
  (SaveWorkspaceState as jest.Mock).mockClear();
  mockLoad.mockResolvedValue(null);
  useIDEStore.setState({
    workspaces: defs as never,
    activeWorkspaceId: 'project',
  });
  renderHook(() => useWorkspacePersistence());

  // Set workspace after mount so the hook subscribes first, then restore runs.
  act(() => {
    useIDEStore.setState({ workspace: { name: 'repo', path: '/repo' } });
  });

  // Wait for the restore (mockLoad resolves null) to complete before
  // switching the active workspace, so isRestoringWorkspace is cleared.
  await waitFor(() => expect(mockLoad).toHaveBeenCalled());

  // Clear any saves triggered by the restore/initial sequence.
  (SaveWorkspaceState as jest.Mock).mockClear();

  act(() => {
    useIDEStore.getState().setActiveWorkspace('frontend');
  });

  await waitFor(() => expect(SaveWorkspaceState).toHaveBeenCalled(), {
    timeout: 2000 + 500,
  });
  const saved = (SaveWorkspaceState as jest.Mock).mock.calls.at(-1)![0];
  expect(saved.activeWorkspaceId).toBe('frontend');
});

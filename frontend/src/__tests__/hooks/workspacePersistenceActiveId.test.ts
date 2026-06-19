import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkspacePersistence } from '../../hooks/useWorkspacePersistence';
import { useIDEStore } from '../../stores/ideStore';
import { LoadWorkspaceState } from '../../../wailsjs/go/main/App';

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

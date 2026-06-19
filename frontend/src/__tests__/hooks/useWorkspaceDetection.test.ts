import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkspaceDetection } from '../../hooks/useWorkspaceDetection';
import { useIDEStore } from '../../stores/ideStore';
import { DetectWorkspaces } from '../../../wailsjs/go/main/App';

jest.mock('../../../wailsjs/go/main/App', () => ({
  DetectWorkspaces: jest.fn(),
}));

const mockDetect = DetectWorkspaces as jest.Mock;

beforeEach(() => {
  mockDetect.mockReset();
  useIDEStore.setState({ workspace: null, workspaces: [], activeWorkspaceId: 'project' });
});

it('detects workspaces when a repo is open', async () => {
  mockDetect.mockResolvedValue([
    { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
    { id: 'frontend', name: 'Frontend', relDir: 'frontend', type: 'frontend', accent: 'blue' },
  ]);

  renderHook(() => useWorkspaceDetection());
  act(() => {
    useIDEStore.setState({ workspace: { name: 'repo', path: '/repo' } });
  });

  await waitFor(() => expect(mockDetect).toHaveBeenCalledWith('/repo'));
  await waitFor(() => expect(useIDEStore.getState().workspaces).toHaveLength(2));
});

it('clears workspaces when no repo is open', async () => {
  useIDEStore.setState({
    workspaces: [
      { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
    ] as never,
  });
  renderHook(() => useWorkspaceDetection());
  act(() => {
    useIDEStore.setState({ workspace: null });
  });
  await waitFor(() => expect(useIDEStore.getState().workspaces).toHaveLength(0));
  expect(mockDetect).not.toHaveBeenCalled();
});

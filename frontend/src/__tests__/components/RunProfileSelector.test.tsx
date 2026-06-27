import { render, screen, fireEvent } from '@testing-library/react';
import { RunProfileSelector } from '../../components/Header/RunProfileSelector';
import { useIDEStore } from '../../stores/ideStore';

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockRestart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../wailsjs/go/main/App', () => ({
  StartRunProfile: (...a: unknown[]) => mockStart(...a),
  StopRunProfile: (...a: unknown[]) => mockStop(...a),
  RestartRunProfile: (...a: unknown[]) => mockRestart(...a),
  SetActiveVariant: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    runProfiles: [{ id: 'p1', name: 'dev', type: 'single', source: 'user', workspaceId: 'ws1' }],
    runProfileState: {},
    runOutputs: {},
    hiddenProfileIds: [],
    stoppingProfileIds: [],
    restartingProfileIds: [],
    activeWorkspaceId: 'ws1', // drives workspace view (NOT a treeViewMode field)
    workspaces: [{ id: 'ws1', name: 'frontend', path: '/x', accent: 'blue' }] as never,
    selectedProfileId: null,
  });
});

test('shows the effective target name and a Run action', () => {
  render(<RunProfileSelector />);
  expect(screen.getByText('dev')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Run selected profile: dev/i })).toBeEnabled();
});

test('clicking the action segment starts the target', () => {
  render(<RunProfileSelector />);
  fireEvent.click(screen.getByRole('button', { name: /Run selected profile: dev/i }));
  expect(mockStart).toHaveBeenCalledWith('p1');
});

test('with no profiles, shows disabled No profile state', () => {
  useIDEStore.setState({ runProfiles: [] });
  render(<RunProfileSelector />);
  expect(screen.getByText(/No profile/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /No run profile selected/i })).toBeDisabled();
});

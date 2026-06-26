import { render, screen, fireEvent, within } from '@testing-library/react';
import { RunProfileSelector } from '../../components/Header/RunProfileSelector';
import { useIDEStore } from '../../stores/ideStore';

const mockStart = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../wailsjs/go/main/App', () => ({
  StartRunProfile: (...a: unknown[]) => mockStart(...a),
  StopRunProfile: jest.fn().mockResolvedValue(undefined),
  RestartRunProfile: jest.fn().mockResolvedValue(undefined),
  SetActiveVariant: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    runProfiles: [
      { id: 'p1', name: 'dev', type: 'single', source: 'user', workspaceId: 'ws1' },
      { id: 'p2', name: 'test', type: 'single', source: 'user', workspaceId: 'ws1' },
    ],
    runProfileState: {},
    runOutputs: {},
    hiddenProfileIds: [],
    stoppingProfileIds: [],
    restartingProfileIds: [],
    activeWorkspaceId: 'ws1', // workspace view (NOT a treeViewMode field)
    workspaces: [{ id: 'ws1', name: 'frontend', path: '/x', accent: 'blue' }] as never,
    selectedProfileId: 'p1',
  });
});

function open() {
  render(<RunProfileSelector />);
  fireEvent.click(screen.getByRole('button', { name: /No profile|dev|test/i, expanded: false }));
}

test('opens popover and lists profiles as rows', () => {
  open();
  const pop = screen.getByRole('dialog', { name: /run profiles/i });
  expect(within(pop).getByText('dev')).toBeInTheDocument();
  expect(within(pop).getByText('test')).toBeInTheDocument();
});

test('row click selects the profile without running it', () => {
  open();
  const pop = screen.getByRole('dialog');
  fireEvent.click(within(pop).getByText('test'));
  expect(useIDEStore.getState().selectedProfileId).toBe('p2');
  expect(mockStart).not.toHaveBeenCalled();
});

test('inline run button runs that row immediately', () => {
  open();
  const pop = screen.getByRole('dialog');
  fireEvent.click(within(pop).getByRole('button', { name: /Run test/i }));
  expect(mockStart).toHaveBeenCalledWith('p2');
});

test('Escape closes the popover', () => {
  open();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

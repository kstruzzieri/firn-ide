import { render, screen, fireEvent, within } from '@testing-library/react';
import { RunProfileSelector } from '../../components/Header/RunProfileSelector';
import { useIDEStore } from '../../stores/ideStore';

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockSetVariant = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../wailsjs/go/main/App', () => ({
  StartRunProfile: (...a: unknown[]) => mockStart(...a),
  StopRunProfile: jest.fn().mockResolvedValue(undefined),
  RestartRunProfile: jest.fn().mockResolvedValue(undefined),
  SetActiveVariant: (...a: unknown[]) => mockSetVariant(...a),
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
  fireEvent.click(
    screen.getByRole('button', { name: /No profile|dev|test|api/i, expanded: false })
  );
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

test('project view groups rows by workspace', () => {
  useIDEStore.setState({
    runProfiles: [
      {
        id: 'p1',
        name: 'dev',
        type: 'single',
        source: 'user',
        workspaceId: 'ws1',
        workspaceName: 'frontend',
      },
      {
        id: 'p2',
        name: 'api',
        type: 'single',
        source: 'user',
        workspaceId: 'ws2',
        workspaceName: 'backend',
      },
    ],
    workspaces: [
      { id: 'ws1', name: 'frontend', path: '/x', accent: 'blue' },
      { id: 'ws2', name: 'backend', path: '/y', accent: 'green' },
    ] as never,
    activeWorkspaceId: 'project', // project view
    selectedProfileId: null,
  });
  open();
  const pop = screen.getByRole('dialog');
  expect(within(pop).getByText('frontend')).toBeInTheDocument();
  expect(within(pop).getByText('backend')).toBeInTheDocument();
  expect(within(pop).getByText('dev')).toBeInTheDocument();
  expect(within(pop).getByText('api')).toBeInTheDocument();
});

test('changing the env variant calls SetActiveVariant', () => {
  useIDEStore.setState({
    runProfiles: [
      {
        id: 'p1',
        name: 'dev',
        type: 'single',
        source: 'user',
        workspaceId: 'ws1',
        envVariants: [
          { name: 'dev', envFile: '.env' },
          { name: 'prod', envFile: '.env.prod' },
        ],
      },
    ],
    activeWorkspaceId: 'ws1',
    selectedProfileId: 'p1',
  });
  open();
  const pop = screen.getByRole('dialog');
  fireEvent.change(within(pop).getByLabelText('Env variant for dev'), {
    target: { value: 'prod' },
  });
  expect(mockSetVariant).toHaveBeenCalledWith('p1', 'prod');
});

test('shows the selected target as an outside-view row when it is in another workspace', () => {
  useIDEStore.setState({
    runProfiles: [
      { id: 'p1', name: 'dev', type: 'single', source: 'user', workspaceId: 'ws1' },
      { id: 'p2', name: 'api', type: 'single', source: 'user', workspaceId: 'ws2' },
    ],
    activeWorkspaceId: 'ws1', // workspace view scoped to ws1
    selectedProfileId: 'p2', // lives in ws2 -> outside this view
  });
  open();
  const pop = screen.getByRole('dialog');
  expect(within(pop).getByText(/Selected \(outside this view\)/i)).toBeInTheDocument();
  expect(within(pop).getByText('api')).toBeInTheDocument();
});

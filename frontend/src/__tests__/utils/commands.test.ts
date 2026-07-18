import { useIDEStore } from '../../stores/ideStore';
import { useSearchStore } from '../../stores/searchStore';
import { createCommands, matchCommands, type Command } from '../../utils/commands';

const mockNavigateToEditorLocation = jest.fn();
const mockStartProfile = jest.fn().mockResolvedValue(undefined);
const mockRestartProfile = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../wailsjs/go/main/App', () => ({
  StartRunProfile: (...args: unknown[]) => mockStartProfile(...args),
  RestartRunProfile: (...args: unknown[]) => mockRestartProfile(...args),
  StopRunProfile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/editorNavigation', () => ({
  navigateToEditorLocation: (...args: unknown[]) => mockNavigateToEditorLocation(...args),
}));

const command = (id: string, title: string, keywords?: string[]): Command => ({
  id,
  title,
  keywords,
  run: jest.fn(),
});

test('keeps registry order for an empty query', () => {
  const commands = [command('z', 'Zulu'), command('a', 'Alpha')];
  expect(matchCommands(commands, '   ').map((item) => item.id)).toEqual(['z', 'a']);
});

test('ranks exact, prefix, word-boundary, then loose subsequences', () => {
  const commands = [
    command('loose', 'Repair'),
    command('word', 'Run Profiles'),
    command('prefix', 'RP Utilities'),
    command('exact', 'RP'),
  ];
  expect(matchCommands(commands, 'rp').map((item) => item.id)).toEqual([
    'exact',
    'prefix',
    'word',
    'loose',
  ]);
});

test('matches aliases case-insensitively and omits disabled/nonmatches', () => {
  const commands: Command[] = [
    { ...command('git', 'Source Control', ['git', 'scm']), enabled: () => true },
    { ...command('hidden', 'Git History', ['git']), enabled: () => false },
    command('run', 'Run Profiles'),
  ];
  expect(matchCommands(commands, 'GIT').map((item) => item.id)).toEqual(['git']);
});

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState(useIDEStore.getInitialState());
  useSearchStore.setState(useSearchStore.getInitialState());
});

const commandById = (id: string) => {
  const command = createCommands(jest.fn()).find((item) => item.id === id);
  if (!command) throw new Error(`Missing command: ${id}`);
  return command;
};

test('creates the approved command registry with stable metadata', () => {
  const openFolder = jest.fn();
  const commands = createCommands(openFolder);

  expect(commands.map((item) => item.id)).toEqual([
    'open-folder',
    'show-explorer',
    'show-search',
    'show-source-control',
    'show-run-profiles',
    'show-structure',
    'navigate-back',
    'navigate-forward',
    'run-selected-profile',
    'restart-selected-profile',
  ]);
  expect(
    commands.map(({ id, title, keywords, shortcut }) => ({ id, title, keywords, shortcut }))
  ).toEqual([
    { id: 'open-folder', title: 'Open Folder', keywords: ['folder', 'workspace'], shortcut: '⌘O' },
    { id: 'show-explorer', title: 'Show Explorer', keywords: undefined, shortcut: undefined },
    { id: 'show-search', title: 'Show Search', keywords: ['find', 'workspace'], shortcut: '⌘⇧F' },
    {
      id: 'show-source-control',
      title: 'Show Source Control',
      keywords: ['git'],
      shortcut: undefined,
    },
    {
      id: 'show-run-profiles',
      title: 'Show Run Profiles',
      keywords: undefined,
      shortcut: undefined,
    },
    {
      id: 'show-structure',
      title: 'Show Structure',
      keywords: ['symbols', 'outline'],
      shortcut: '⌘⇧Y',
    },
    { id: 'navigate-back', title: 'Navigate Back', keywords: undefined, shortcut: undefined },
    { id: 'navigate-forward', title: 'Navigate Forward', keywords: undefined, shortcut: undefined },
    {
      id: 'run-selected-profile',
      title: 'Run Selected Profile',
      keywords: undefined,
      shortcut: '⌘R',
    },
    {
      id: 'restart-selected-profile',
      title: 'Restart Selected Profile',
      keywords: undefined,
      shortcut: '⌘R',
    },
  ]);

  commands[0].run();
  expect(openFolder).toHaveBeenCalledTimes(1);
});

test('shows search by selecting and expanding the sidebar, then focusing its input', () => {
  useIDEStore.setState({ activeSidebarView: 'explorer', isLeftPanelCollapsed: true });

  commandById('show-search').run();

  expect(useIDEStore.getState().activeSidebarView).toBe('search');
  expect(useIDEStore.getState().isLeftPanelCollapsed).toBe(false);
  expect(useSearchStore.getState().focusInputRevision).toBe(1);
});

test('shows run profiles by expanding only the right panel', () => {
  useIDEStore.setState({
    activeSidebarView: 'git',
    isLeftPanelCollapsed: true,
    isRightPanelCollapsed: true,
  });

  commandById('show-run-profiles').run();

  expect(useIDEStore.getState().isRightPanelCollapsed).toBe(false);
  expect(useIDEStore.getState().activeSidebarView).toBe('git');
  expect(useIDEStore.getState().isLeftPanelCollapsed).toBe(true);
});

test('enables navigation only for an active file with history and preserves navigation semantics', () => {
  const back = commandById('navigate-back');
  const forward = commandById('navigate-forward');

  expect(back.enabled?.()).toBe(false);
  useIDEStore.setState({ activeFileId: '/current.ts' });
  expect(back.enabled?.()).toBe(false);
  useIDEStore.getState().pushNavigationHistory({ fileId: '/source.ts', line: 3, column: 2 });
  expect(back.enabled?.()).toBe(true);

  useIDEStore.setState({
    cursorPosition: { line: 9, column: 4 },
    cursorPositions: { '/current.ts': { line: 12, column: 8 } },
  });
  back.run();

  expect(mockNavigateToEditorLocation).toHaveBeenCalledWith('/source.ts', 3, 2);
  expect(useIDEStore.getState().navigationForward).toEqual([
    { fileId: '/current.ts', line: 12, column: 8 },
  ]);
  expect(forward.enabled?.()).toBe(true);
  forward.run();
  expect(mockNavigateToEditorLocation).toHaveBeenLastCalledWith('/current.ts', 12, 8);
});

test('resolves run targets at invocation time and ignores stopping or restarting targets', () => {
  const run = commandById('run-selected-profile');
  const restart = commandById('restart-selected-profile');

  useIDEStore.setState({
    runProfiles: [
      { id: 'p1', name: 'dev', type: 'single', source: 'user', workspaceId: 'ws' },
      { id: 'p2', name: 'test', type: 'single', source: 'user', workspaceId: 'ws' },
    ],
    activeWorkspaceId: 'ws',
    selectedProfileId: 'p2',
  });
  run.run();
  expect(mockStartProfile).toHaveBeenCalledWith('p2');

  useIDEStore.setState({
    selectedProfileId: 'p1',
    runOutputs: { p1: { state: 'running' } } as never,
  });
  restart.run();
  expect(mockRestartProfile).toHaveBeenCalledWith('p1');

  mockStartProfile.mockClear();
  mockRestartProfile.mockClear();
  useIDEStore.setState({ stoppingProfileIds: ['p1'] });
  run.run();
  useIDEStore.setState({ stoppingProfileIds: [], restartingProfileIds: ['p1'] });
  restart.run();

  expect(mockStartProfile).not.toHaveBeenCalled();
  expect(mockRestartProfile).not.toHaveBeenCalled();
});

test('re-evaluates mutually exclusive run and restart availability from late-bound state', () => {
  const commands = createCommands(jest.fn());
  const availableActions = () =>
    matchCommands(commands, '')
      .map((item) => item.id)
      .filter((id) => id === 'run-selected-profile' || id === 'restart-selected-profile');

  useIDEStore.setState({
    runProfiles: [{ id: 'p1', name: 'test', type: 'single', source: 'user', workspaceId: 'ws' }],
    activeWorkspaceId: 'ws',
    selectedProfileId: 'p1',
  });

  for (const state of ['idle', 'success', 'failed', 'stopped']) {
    useIDEStore.setState({ runOutputs: { p1: { state } } as never });
    expect(availableActions()).toEqual(['run-selected-profile']);
  }

  useIDEStore.setState({ runOutputs: { p1: { state: 'running' } } as never });
  expect(availableActions()).toEqual(['restart-selected-profile']);

  useIDEStore.setState({ stoppingProfileIds: ['p1'] });
  expect(availableActions()).toEqual([]);

  useIDEStore.setState({ stoppingProfileIds: [], restartingProfileIds: ['p1'] });
  expect(availableActions()).toEqual([]);
});

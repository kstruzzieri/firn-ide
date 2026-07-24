import { fireEvent, render, screen } from '@testing-library/react';
import { RunOutputPanel } from '../../../components/RunOutput/RunOutputPanel';
import { RunOutputTabs } from '../../../components/RunOutput/RunOutputTabs';
import { RunOutputToolbar } from '../../../components/RunOutput/RunOutputToolbar';
import { useIDEStore } from '../../../stores/ideStore';
import { ALL_PROFILES_ID } from '../../../types/runOutput';
import type { CompoundRun, RunOutput } from '../../../types/runOutput';
import type { RunProfile } from '../../../types/runProfile';

const mockStop = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
const mockRestart = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

jest.mock('../../../../wailsjs/go/main/App', () => ({
  StopRunProfile: (id: string) => mockStop(id),
  RestartRunProfile: (id: string) => mockRestart(id),
}));

jest.mock('../../../components/RunProfiles/CompoundExecutionView', () => ({
  CompoundExecutionView: ({ compound }: { compound: CompoundRun }) => (
    <div data-testid="compound-view">{compound.compoundId}</div>
  ),
}));

jest.mock('../../../components/RunOutput/MergedView', () => ({
  MergedView: ({ workingDir }: { workingDir?: string }) => (
    <div data-testid="merged-working-dir">{workingDir}</div>
  ),
}));
jest.mock('../../../components/RunOutput/LanesView', () => ({
  LanesView: () => <div data-testid="lanes-view" />,
}));
jest.mock('../../../components/RunOutput/DiffView', () => ({
  DiffView: ({
    entries,
    previousEntries,
    workingDir,
    previousWorkingDir,
  }: {
    entries: Array<{ text: string }>;
    previousEntries: Array<{ text: string }>;
    workingDir?: string;
    previousWorkingDir?: string;
  }) => (
    <div data-testid="diff-props">
      {JSON.stringify({
        entries: entries.map((entry) => entry.text),
        previousEntries: previousEntries.map((entry) => entry.text),
        workingDir,
        previousWorkingDir,
      })}
    </div>
  ),
}));
jest.mock('../../../components/RunOutput/TimelineView', () => ({
  TimelineView: ({ runOutputs }: { runOutputs: Record<string, RunOutput> }) => (
    <div data-testid="timeline-run-ids">{Object.keys(runOutputs).join(',')}</div>
  ),
}));

const output = (
  runInstanceId: string,
  profileId: string,
  text: string,
  workingDir: string,
  state: RunOutput['state'] = 'success'
): RunOutput => ({
  runInstanceId,
  profileId,
  state,
  exitCode: 0,
  workingDir,
  entries: [{ stream: 'stdout', text, timestamp: 1 }],
});

const profile = (id: string, name: string): RunProfile => ({
  id,
  name,
  type: 'single',
  source: 'user',
  command: 'echo test',
});

const compound = (): CompoundRun => ({
  runInstanceId: 'agg-r1',
  compoundId: 'ci',
  name: 'CI',
  state: 'running',
  currentStep: 0,
  steps: [],
  stepOutputs: {},
});

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    ...useIDEStore.getInitialState(),
    workspace: { name: 'Repo', path: '/repo' },
    runProfiles: [profile('p1', 'Build'), profile('p2', 'Test')],
    runOutputs: {},
    runInstanceIdsByProfile: {},
    latestRunInstanceIdByProfile: {},
    runCompounds: {},
    compoundIdByRunInstance: {},
  });
});

it('renders retained ordinary tabs in indexed order with profile and opaque run labels', () => {
  useIDEStore.setState({
    runOutputs: {
      r2: output('r2', 'p1', 'new', 'new-dir'),
      r3: output('r3', 'p2', 'test', 'test-dir'),
      r1: output('r1', 'p1', 'old', 'old-dir'),
    },
    runInstanceIdsByProfile: { p1: ['r1', 'r2'], p2: ['r3'] },
    latestRunInstanceIdByProfile: { p1: 'r2', p2: 'r3' },
    activeRunOutputId: 'r2',
  });

  render(<RunOutputTabs />);

  const labels = screen.getAllByRole('button').map((button) => button.textContent);
  expect(labels).toEqual(['Build · r1', 'Build · r2', 'Test · r3', 'All']);
  fireEvent.click(screen.getByRole('button', { name: 'Build · r1' }));
  expect(useIDEStore.getState().activeRunOutputId).toBe('r1');
});

it('does not show All for two retained runs of one profile', () => {
  useIDEStore.setState({
    runOutputs: {
      r1: output('r1', 'p1', 'old', 'old-dir'),
      r2: output('r2', 'p1', 'new', 'new-dir'),
    },
    runInstanceIdsByProfile: { p1: ['r1', 'r2'] },
    latestRunInstanceIdByProfile: { p1: 'r2' },
    activeRunOutputId: 'r2',
  });

  render(<RunOutputTabs />);

  expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
});

it('renders only the latest ordinary execution per profile in All Profiles', () => {
  useIDEStore.setState({
    runOutputs: {
      r1: output('r1', 'p1', 'old', 'old-dir'),
      r2: output('r2', 'p1', 'new', 'new-dir'),
      r3: output('r3', 'p2', 'test', 'test-dir'),
    },
    runInstanceIdsByProfile: { p1: ['r1', 'r2'], p2: ['r3'] },
    latestRunInstanceIdByProfile: { p1: 'r2', p2: 'r3' },
    activeRunOutputId: ALL_PROFILES_ID,
    runOutputViewMode: 'timeline',
  });

  render(<RunOutputPanel />);

  expect(screen.getByTestId('timeline-run-ids').textContent).toBe('r2,r3');
});

it('derives Diff entries and both working directories from the indexed predecessor', () => {
  useIDEStore.setState({
    runOutputs: {
      r1: output('r1', 'p1', 'old', 'packages/old'),
      r2: output('r2', 'p1', 'new', 'packages/new'),
    },
    runInstanceIdsByProfile: { p1: ['r1', 'r2'] },
    latestRunInstanceIdByProfile: { p1: 'r2' },
    activeRunOutputId: 'r2',
    runOutputViewMode: 'diff',
  });

  render(<RunOutputPanel />);

  expect(screen.getByTestId('diff-props')).toHaveTextContent(
    JSON.stringify({
      entries: ['new'],
      previousEntries: ['old'],
      workingDir: 'packages/new',
      previousWorkingDir: 'packages/old',
    })
  );
});

it('uses the selected historical execution working directory for output links', () => {
  useIDEStore.setState({
    runOutputs: {
      r1: output('r1', 'p1', 'old', 'packages/old'),
      r2: output('r2', 'p1', 'new', 'packages/new'),
    },
    runInstanceIdsByProfile: { p1: ['r1', 'r2'] },
    latestRunInstanceIdByProfile: { p1: 'r2' },
    activeRunOutputId: 'r1',
    runOutputViewMode: 'merged',
  });

  render(<RunOutputPanel />);

  expect(screen.getByTestId('merged-working-dir')).toHaveTextContent('packages/old');
});

it('translates ordinary run instance controls to the profile id', () => {
  useIDEStore.setState({
    runOutputs: { r2: output('r2', 'p1', 'live', 'packages/new', 'running') },
    runInstanceIdsByProfile: { p1: ['r2'] },
    latestRunInstanceIdByProfile: { p1: 'r2' },
    activeRunOutputId: 'r2',
  });

  render(<RunOutputToolbar />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop profile' }));
  fireEvent.click(screen.getByRole('button', { name: 'Re-run profile' }));

  expect(mockStop).toHaveBeenCalledWith('p1');
  expect(mockRestart).toHaveBeenCalledWith('p1');
});

it('derives Stop state from the latest pointer when a historical tab is selected', () => {
  useIDEStore.setState({
    runOutputs: {
      r1: output('r1', 'p1', 'old', 'packages/old', 'success'),
      r2: output('r2', 'p1', 'live', 'packages/new', 'running'),
    },
    runInstanceIdsByProfile: { p1: ['r1', 'r2'] },
    latestRunInstanceIdByProfile: { p1: 'r2' },
    activeRunOutputId: 'r1',
  });

  render(<RunOutputToolbar />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop profile' }));

  expect(mockStop).toHaveBeenCalledWith('p1');
});

it('resolves a compound aggregate run instance for rendering and controls', () => {
  useIDEStore.setState({
    runCompounds: { ci: compound() },
    compoundIdByRunInstance: { 'agg-r1': 'ci' },
    activeRunOutputId: 'agg-r1',
  });

  render(<RunOutputPanel />);

  expect(screen.getByTestId('compound-view')).toHaveTextContent('ci');
  fireEvent.click(screen.getByRole('button', { name: 'Stop profile' }));
  fireEvent.click(screen.getByRole('button', { name: 'Re-run profile' }));
  expect(mockStop).toHaveBeenCalledWith('ci');
  expect(mockRestart).toHaveBeenCalledWith('ci');
});

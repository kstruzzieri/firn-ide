import { fireEvent, render, screen } from '@testing-library/react';
import { RunOutputPanel } from '../../../components/RunOutput/RunOutputPanel';
import { RunOutputToolbar } from '../../../components/RunOutput/RunOutputToolbar';
import { RunOutputTabs } from '../../../components/RunOutput/RunOutputTabs';
import { useIDEStore } from '../../../stores/ideStore';
import type { CompoundRun, RunOutput } from '../../../types/runOutput';

// --- Mocks -----------------------------------------------------------------

const mockStop = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
const mockRestart = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
jest.mock('../../../../wailsjs/go/main/App', () => ({
  StopRunProfile: (id: string) => mockStop(id),
  RestartRunProfile: (id: string) => mockRestart(id),
}));

jest.mock('../../../components/RunProfiles/CompoundExecutionView', () => ({
  CompoundExecutionView: ({ compound }: { compound: { compoundId: string } }) => (
    <div data-testid="compound-view">{compound.compoundId}</div>
  ),
}));

// Stub the heavy ordinary views so panel render stays focused.
jest.mock('../../../components/RunOutput/MergedView', () => ({
  MergedView: () => <div data-testid="merged-view" />,
}));
jest.mock('../../../components/RunOutput/LanesView', () => ({
  LanesView: () => <div data-testid="lanes-view" />,
}));
jest.mock('../../../components/RunOutput/DiffView', () => ({
  DiffView: () => <div data-testid="diff-view" />,
}));
jest.mock('../../../components/RunOutput/TimelineView', () => ({
  TimelineView: () => <div data-testid="timeline-view" />,
}));

// --- Fixtures --------------------------------------------------------------

function makeCompound(overrides: Partial<CompoundRun> = {}): CompoundRun {
  return {
    compoundId: 'ci',
    name: 'CI',
    state: 'running',
    currentStep: 0,
    steps: [],
    stepOutputs: {},
    ...overrides,
  };
}

function makeRunOutput(overrides: Partial<RunOutput> = {}): RunOutput {
  return {
    profileId: 'p1',
    state: 'running',
    exitCode: 0,
    runCount: 1,
    entries: [],
    previousEntries: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState(useIDEStore.getInitialState());
  useIDEStore.setState({ workspace: { name: 'Repo', path: '/repo' } });
});

// --- Panel -----------------------------------------------------------------

describe('RunOutputPanel compound rendering', () => {
  it('renders CompoundExecutionView when the active id is a compound id', () => {
    useIDEStore.setState({
      runOutputs: {},
      runCompounds: { ci: makeCompound() },
      activeRunOutputId: 'ci',
    });

    render(<RunOutputPanel />);

    expect(screen.getByTestId('compound-view')).toHaveTextContent('ci');
  });

  it('renders the compound view even when view mode is timeline', () => {
    useIDEStore.setState({
      runOutputs: {},
      runCompounds: { ci: makeCompound() },
      activeRunOutputId: 'ci',
      runOutputViewMode: 'timeline',
    });

    render(<RunOutputPanel />);

    expect(screen.getByTestId('compound-view')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-view')).not.toBeInTheDocument();
  });

  it('renders ordinary views (not compound) for a plain run output', () => {
    useIDEStore.setState({
      runOutputs: { p1: makeRunOutput() },
      runCompounds: {},
      activeRunOutputId: 'p1',
      runOutputViewMode: 'merged',
    });

    render(<RunOutputPanel />);

    expect(screen.queryByTestId('compound-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('merged-view')).toBeInTheDocument();
  });
});

// --- Toolbar ---------------------------------------------------------------

describe('RunOutputToolbar compound controls', () => {
  it('calls clearCompoundRunOutput with the compound id on Clear', () => {
    const clearCompoundRunOutput = jest.fn();
    useIDEStore.setState({
      runOutputs: {},
      runCompounds: { ci: makeCompound() },
      activeRunOutputId: 'ci',
      clearCompoundRunOutput,
    });

    render(<RunOutputToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear output' }));

    expect(clearCompoundRunOutput).toHaveBeenCalledWith('ci');
  });

  it('stops a running compound via the compound id', () => {
    useIDEStore.setState({
      runOutputs: {},
      runCompounds: { ci: makeCompound({ state: 'running' }) },
      activeRunOutputId: 'ci',
    });

    render(<RunOutputToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop profile' }));

    expect(mockStop).toHaveBeenCalledWith('ci');
  });

  it('re-runs a compound via the compound id', () => {
    useIDEStore.setState({
      runOutputs: {},
      runCompounds: { ci: makeCompound({ state: 'failed' }) },
      activeRunOutputId: 'ci',
    });

    render(<RunOutputToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Re-run profile' }));

    expect(mockRestart).toHaveBeenCalledWith('ci');
  });

  it('hides the view-mode group when a compound is active', () => {
    useIDEStore.setState({
      runOutputs: {},
      runCompounds: { ci: makeCompound() },
      activeRunOutputId: 'ci',
    });

    render(<RunOutputToolbar />);

    expect(screen.queryByRole('button', { name: 'Merged' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Timeline' })).not.toBeInTheDocument();
    // Action controls remain available.
    expect(screen.getByRole('button', { name: 'Clear output' })).toBeInTheDocument();
  });

  it('shows the view-mode group for an ordinary active output', () => {
    useIDEStore.setState({
      runOutputs: { p1: makeRunOutput() },
      runCompounds: {},
      activeRunOutputId: 'p1',
    });

    render(<RunOutputToolbar />);

    expect(screen.getByRole('button', { name: 'Merged' })).toBeInTheDocument();
  });
});

// --- Tabs ------------------------------------------------------------------

describe('RunOutputTabs compound tabs', () => {
  it('renders a tab for a compound that has no ordinary output', () => {
    useIDEStore.setState({
      runOutputs: {},
      runCompounds: { ci: makeCompound({ name: 'CI' }) },
      activeRunOutputId: 'ci',
    });

    render(<RunOutputTabs />);

    expect(screen.getByText('CI')).toBeInTheDocument();
  });

  it('does not render composite step keys as tabs', () => {
    const compositeKey = 'compound:Y2k:0';
    useIDEStore.setState({
      runOutputs: {},
      runCompounds: { ci: makeCompound({ name: 'CI' }) },
      activeRunOutputId: 'ci',
    });

    render(<RunOutputTabs />);

    expect(screen.queryByText(compositeKey)).not.toBeInTheDocument();
    expect(screen.getByText('CI')).toBeInTheDocument();
  });

  it('filters out composite step keys that leak into runOutputs', () => {
    const compositeKey = 'compound:Y2k:0';
    useIDEStore.setState({
      runOutputs: { [compositeKey]: makeRunOutput({ profileId: compositeKey }) },
      runCompounds: { ci: makeCompound({ name: 'CI' }) },
      activeRunOutputId: 'ci',
    });

    render(<RunOutputTabs />);

    expect(screen.queryByText(compositeKey)).not.toBeInTheDocument();
    expect(screen.getByText('CI')).toBeInTheDocument();
  });

  it('does not render the All timeline tab for compounds only', () => {
    useIDEStore.setState({
      runOutputs: {},
      runCompounds: {
        ci: makeCompound({ compoundId: 'ci', name: 'CI' }),
        deploy: makeCompound({ compoundId: 'deploy', name: 'Deploy' }),
      },
      activeRunOutputId: 'ci',
    });

    render(<RunOutputTabs />);

    expect(screen.queryByText('All')).not.toBeInTheDocument();
  });

  it('renders the All timeline tab when 2+ ordinary outputs exist', () => {
    useIDEStore.setState({
      runOutputs: {
        p1: makeRunOutput({ profileId: 'p1' }),
        p2: makeRunOutput({ profileId: 'p2' }),
      },
      runCompounds: {},
      activeRunOutputId: 'p1',
    });

    render(<RunOutputTabs />);

    expect(screen.getByText('All')).toBeInTheDocument();
  });
});

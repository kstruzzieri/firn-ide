import { render, screen, within } from '@testing-library/react';
import { RunProfiles } from '../../components/RunProfiles/RunProfiles';
import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile, RunProfileUIState } from '../../types/runProfile';
import type { RunOutput } from '../../types/runOutput';

jest.mock('../../../wailsjs/go/main/App', () => ({
  StartRunProfile: jest.fn(() => Promise.resolve()),
  StopRunProfile: jest.fn(() => Promise.resolve()),
  RestartRunProfile: jest.fn(() => Promise.resolve()),
  PinRunProfile: jest.fn(() => Promise.resolve()),
  UnpinRunProfile: jest.fn(() => Promise.resolve()),
  SetActiveVariant: jest.fn(() => Promise.resolve()),
  AdoptRunProfile: jest.fn(() => Promise.resolve()),
  UnadoptRunProfile: jest.fn(() => Promise.resolve()),
}));

const WS = 'frontend';

// One profile per section, all scoped to the same workspace so the
// workspace-view grouping resolves them into Working Set / Pinned / Recent / Detected.
const activatedProfile: RunProfile = {
  id: 'activated-1',
  name: 'Build',
  type: 'single',
  source: 'detected',
  command: 'npm run build',
  workspaceId: WS,
  workspaceName: 'Frontend',
};
const pinnedProfile: RunProfile = {
  id: 'pinned-1',
  name: 'Dev',
  type: 'single',
  source: 'user',
  command: 'npm run dev',
  workspaceId: WS,
  workspaceName: 'Frontend',
};
const recentProfile: RunProfile = {
  id: 'recent-1',
  name: 'Test',
  type: 'single',
  source: 'detected',
  command: 'npm test',
  workspaceId: WS,
  workspaceName: 'Frontend',
};
const detectedProfile: RunProfile = {
  id: 'detected-1',
  name: 'Lint',
  type: 'single',
  source: 'detected',
  command: 'npm run lint',
  workspaceId: WS,
  workspaceName: 'Frontend',
};

const allProfiles = [activatedProfile, pinnedProfile, recentProfile, detectedProfile];

const profileState: Record<string, RunProfileUIState> = {
  // adopted detected -> activated (Working Set)
  [activatedProfile.id]: { adopted: true, lastRunAt: 1000 },
  // non-adopted detected with lastRunAt > 0 -> recent
  [recentProfile.id]: { lastRunAt: 500 },
  // detectedProfile has no lastRunAt -> detected
};

function makeRunOutput(profileId: string, state: RunOutput['state']): RunOutput {
  return {
    profileId,
    state,
    exitCode: 0,
    runCount: 1,
    entries: [],
    previousEntries: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    runProfiles: allProfiles,
    runProfileState: profileState,
    activeWorkspaceId: WS, // workspace view
    runOutputs: {},
    runHistory: {},
    runStartTimestamps: {},
    hiddenProfileIds: [],
    stoppingProfileIds: [],
    restartingProfileIds: [],
    isLoadingProfiles: false,
    profilesError: null,
    toast: null,
  });
});

describe('RunProfiles panel grouping (workspace view)', () => {
  it('renders all four section labels', () => {
    render(<RunProfiles />);

    expect(screen.getByText('Working Set')).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Detected')).toBeInTheDocument();
  });
});

describe('RunProfiles panel header counter', () => {
  it('shows running and total counts scoped to the active workspace', () => {
    useIDEStore.setState({
      runOutputs: { [pinnedProfile.id]: makeRunOutput(pinnedProfile.id, 'running') },
    });

    render(<RunProfiles />);

    const header = screen.getByText('Run Profiles').closest('*') as HTMLElement;
    expect(within(header).getByText(/1 running/i)).toBeInTheDocument();
    expect(within(header).getByText(/\d+ total/i)).toBeInTheDocument();
  });
});

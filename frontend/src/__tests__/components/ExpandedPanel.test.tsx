import { render, screen } from '@testing-library/react';
import { ExpandedPanel, getStopProgressPercent } from '../../components/RunProfiles/ExpandedPanel';
import type { RunProfile } from '../../types/runProfile';
import type { RunHistoryEntry, RunOutput } from '../../types/runOutput';

const mockProfile: RunProfile = {
  id: 'test-1',
  name: 'go test',
  type: 'single',
  source: 'user',
  command: 'go test ./...',
  workingDir: '/tmp/project',
};

const noop = () => {};

function renderPanel({
  visualState = 'idle',
  runHistory = [],
  runOutput,
  stopElapsedMs = 0,
}: {
  visualState?: 'idle' | 'running' | 'stopping' | 'failed' | 'success' | 'stopped';
  runHistory?: RunHistoryEntry[];
  runOutput?: RunOutput;
  stopElapsedMs?: number;
} = {}) {
  return render(
    <ExpandedPanel
      profile={mockProfile}
      visualState={visualState}
      runOutput={runOutput}
      runHistory={runHistory}
      waveformData={[1, 2, 3, 4]}
      elapsed={2000}
      stopElapsedMs={stopElapsedMs}
      onFocusOutput={noop}
      onStart={noop}
      onStop={noop}
      onRestart={noop}
      onPin={noop}
      onUnpin={noop}
      onHide={noop}
    />
  );
}

describe('getStopProgressPercent', () => {
  it('returns 0 at start of grace period', () => {
    expect(getStopProgressPercent(0, 3000)).toBe(0);
  });

  it('returns 50 at midpoint', () => {
    expect(getStopProgressPercent(1500, 3000)).toBe(50);
  });

  it('caps at 100', () => {
    expect(getStopProgressPercent(5000, 3000)).toBe(100);
  });
});

describe('ExpandedPanel', () => {
  it('renders dormant copy for idle profiles with no history', () => {
    renderPanel();
    expect(screen.getByText('Never run — click play to start')).toBeInTheDocument();
  });

  it('preserves cancelled semantics for idle profiles whose last run was stopped', () => {
    renderPanel({
      runHistory: [{ state: 'stopped', duration: 1800, timestamp: Date.now() }],
    });
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('renders failed detail with exit code for failed state', () => {
    renderPanel({
      visualState: 'failed',
      runOutput: {
        profileId: 'test-1',
        state: 'failed',
        exitCode: 2,
        runCount: 1,
        entries: [{ stream: 'stderr', text: 'boom', timestamp: Date.now() }],
        previousEntries: [],
      },
      runHistory: [{ state: 'failed', duration: 1800, timestamp: Date.now() }],
    });
    expect(screen.getByText('Exit 2')).toBeInTheDocument();
    expect(screen.getByText('Process failed')).toBeInTheDocument();
  });

  it('renders stopping progress from the real stop elapsed time', () => {
    renderPanel({
      visualState: 'stopping',
      stopElapsedMs: 1500,
      runOutput: {
        profileId: 'test-1',
        state: 'running',
        exitCode: 0,
        runCount: 1,
        entries: [],
        previousEntries: [],
      },
    });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('force-kill in 2s')).toBeInTheDocument();
  });

  it('shows restarting indicator when stopping a non-running profile', () => {
    renderPanel({ visualState: 'stopping', stopElapsedMs: 0 });
    expect(screen.getByText(/Restarting/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

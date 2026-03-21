import type { VisualState, RunOutput, RunHistoryEntry, OutputEntry } from '../../types/runOutput';
import type { RunProfile } from '../../types/runProfile';
import { ActivityGraph } from './ActivityGraph';
import { RunHistoryDots } from './RunHistoryDots';
import { PlayIcon, StopIcon, RestartIcon } from '../icons';
import { formatDuration } from '../../utils/formatDuration';
import styles from './ExpandedPanel.module.css';

const GRACE_PERIOD_MS = 3000;

/**
 * Compute stop-progress as a clamped 0-100 integer.
 */
export function getStopProgressPercent(elapsedSinceStop: number, gracePeriod: number): number {
  return Math.max(0, Math.min(100, Math.round((elapsedSinceStop / gracePeriod) * 100)));
}

export interface ExpandedPanelProps {
  profile: RunProfile;
  visualState: VisualState;
  runOutput: RunOutput | undefined;
  runHistory: RunHistoryEntry[];
  waveformData: number[];
  elapsed: number;
  stopElapsedMs: number;
  onFocusOutput: (profileId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onHide: () => void;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function getTailEntries(entries: OutputEntry[] | undefined, count: number): OutputEntry[] {
  if (!entries || entries.length === 0) return [];
  return entries.slice(-count);
}

function OutputTail({ entries }: { entries: OutputEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className={styles.outputPreview}>
      {entries.map((entry, i) => (
        <div
          key={i}
          className={entry.stream === 'stderr' ? styles.outputStderr : styles.outputLine}
        >
          {entry.text}
        </div>
      ))}
    </div>
  );
}

function StatsRow({
  elapsed,
  profile,
  runHistory,
  resultLabel,
}: {
  elapsed: number;
  profile: RunProfile;
  runHistory: RunHistoryEntry[];
  resultLabel?: string;
}) {
  const avgDuration =
    runHistory.length > 0
      ? runHistory.reduce((sum, h) => sum + h.duration, 0) / runHistory.length
      : 0;

  return (
    <div className={styles.statRow}>
      <div className={styles.stat}>
        <span className={styles.statLabel}>Elapsed</span>
        <span className={styles.statValueHl}>{formatDuration(elapsed)}</span>
      </div>
      {profile.workingDir && (
        <div className={styles.stat}>
          <span className={styles.statLabel}>Dir</span>
          <span className={styles.statValue}>{profile.workingDir}</span>
        </div>
      )}
      {runHistory.length > 0 && (
        <div className={styles.stat}>
          <span className={styles.statLabel}>Avg</span>
          <span className={styles.statValue}>{formatDuration(avgDuration)}</span>
        </div>
      )}
      <div className={styles.stat}>
        <span className={styles.statLabel}>Runs</span>
        <span className={styles.statValue}>{runHistory.length}</span>
      </div>
      {resultLabel && (
        <div className={styles.stat}>
          <span className={styles.statLabel}>Result</span>
          <span className={styles.statValue}>{resultLabel}</span>
        </div>
      )}
    </div>
  );
}

/* ── Sub-panels ───────────────────────────────────────────────── */

function RunningPanel({
  profile,
  runOutput,
  runHistory,
  waveformData,
  elapsed,
}: {
  profile: RunProfile;
  runOutput: RunOutput | undefined;
  runHistory: RunHistoryEntry[];
  waveformData: number[];
  elapsed: number;
}) {
  const tail = getTailEntries(runOutput?.entries, 4);
  return (
    <>
      <ActivityGraph data={waveformData} visualState="running" />
      <OutputTail entries={tail} />
      <StatsRow elapsed={elapsed} profile={profile} runHistory={runHistory} />
    </>
  );
}

function StoppingPanel({
  profile,
  runOutput,
  runHistory,
  waveformData,
  elapsed,
  stopElapsedMs,
}: {
  profile: RunProfile;
  runOutput: RunOutput | undefined;
  runHistory: RunHistoryEntry[];
  waveformData: number[];
  elapsed: number;
  stopElapsedMs: number;
}) {
  const progress = getStopProgressPercent(stopElapsedMs, GRACE_PERIOD_MS);
  const remainingMs = Math.max(0, GRACE_PERIOD_MS - stopElapsedMs);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const tail = getTailEntries(runOutput?.entries, 4);

  return (
    <>
      <div className={styles.stopProgress}>
        <div className={styles.stopLabel}>
          <span>Sending SIGTERM...</span>
          <span className={styles.stopHint}>force-kill in {remainingSeconds}s</span>
        </div>
        <div className={styles.stopBar}>
          <div
            className={styles.stopFill}
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          />
        </div>
      </div>
      <ActivityGraph data={waveformData} visualState="stopping" />
      <OutputTail entries={tail} />
      <StatsRow elapsed={elapsed} profile={profile} runHistory={runHistory} />
    </>
  );
}

function FailedPanel({
  profile,
  runOutput,
  runHistory,
  waveformData,
  elapsed,
}: {
  profile: RunProfile;
  runOutput: RunOutput | undefined;
  runHistory: RunHistoryEntry[];
  waveformData: number[];
  elapsed: number;
}) {
  const exitCode = runOutput?.exitCode ?? 1;
  const stderrEntries = (runOutput?.entries ?? []).filter((e) => e.stream === 'stderr');
  const tail = getTailEntries(stderrEntries, 4);

  return (
    <>
      <div className={styles.errorDetail}>
        <div className={styles.errorHeader}>
          <span className={styles.errorCode}>Exit {exitCode}</span>
          <span className={styles.errorLabel}>Process failed</span>
        </div>
      </div>
      <OutputTail entries={tail} />
      <ActivityGraph data={waveformData} visualState="failed" />
      <StatsRow elapsed={elapsed} profile={profile} runHistory={runHistory} />
    </>
  );
}

function DormantPanel({ profile }: { profile: RunProfile }) {
  return (
    <div className={styles.dormantInfo}>
      {profile.source && (
        <div className={styles.dormantRow}>
          <span className={styles.dormantLabel}>Source</span>
          <span className={styles.dormantValue}>{profile.source}</span>
        </div>
      )}
      {profile.workingDir && (
        <div className={styles.dormantRow}>
          <span className={styles.dormantLabel}>Dir</span>
          <span className={styles.dormantValue}>{profile.workingDir}</span>
        </div>
      )}
      {profile.command && (
        <div className={styles.dormantRow}>
          <span className={styles.dormantLabel}>Command</span>
          <span className={styles.dormantValue}>{profile.command}</span>
        </div>
      )}
      <div className={styles.dormantRow}>
        <span className={styles.dormantValue}>Never run — click play to start</span>
      </div>
    </div>
  );
}

function getResultLabel(lastEntry: RunHistoryEntry | undefined): string | undefined {
  if (!lastEntry) return undefined;
  switch (lastEntry.state) {
    case 'success':
      return 'Passed';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Cancelled';
    default:
      return undefined;
  }
}

function IdlePanel({
  profile,
  runOutput,
  runHistory,
  elapsed,
}: {
  profile: RunProfile;
  runOutput: RunOutput | undefined;
  runHistory: RunHistoryEntry[];
  elapsed: number;
}) {
  const lastEntry = runHistory[runHistory.length - 1];
  const resultLabel = getResultLabel(lastEntry);
  const tail = getTailEntries(runOutput?.entries, 4);

  return (
    <>
      <OutputTail entries={tail} />
      <StatsRow
        elapsed={elapsed}
        profile={profile}
        runHistory={runHistory}
        resultLabel={resultLabel}
      />
    </>
  );
}

function SuccessPanel({
  profile,
  runOutput,
  runHistory,
  waveformData,
  elapsed,
}: {
  profile: RunProfile;
  runOutput: RunOutput | undefined;
  runHistory: RunHistoryEntry[];
  waveformData: number[];
  elapsed: number;
}) {
  const tail = getTailEntries(runOutput?.entries, 4);
  return (
    <>
      <OutputTail entries={tail} />
      <ActivityGraph data={waveformData} visualState="success" />
      <StatsRow elapsed={elapsed} profile={profile} runHistory={runHistory} />
    </>
  );
}

function StoppedPanel({ profile }: { profile: RunProfile }) {
  return (
    <div className={styles.dormantInfo}>
      <div className={styles.dormantRow}>
        <span className={styles.dormantLabel}>Status</span>
        <span className={styles.dormantValue}>Cancelled</span>
      </div>
      {profile.workingDir && (
        <div className={styles.dormantRow}>
          <span className={styles.dormantLabel}>Dir</span>
          <span className={styles.dormantValue}>{profile.workingDir}</span>
        </div>
      )}
    </div>
  );
}

/* ── Actions ──────────────────────────────────────────────────── */

function ActionsRow({
  profile,
  visualState,
  onFocusOutput,
  onStart,
  onStop,
  onRestart,
  onPin,
  onUnpin,
  onHide,
}: {
  profile: RunProfile;
  visualState: VisualState;
  onFocusOutput: (profileId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onHide: () => void;
}) {
  const isActive = visualState === 'running' || visualState === 'stopping';

  return (
    <div className={styles.actions}>
      {isActive ? (
        <>
          <button
            className={styles.actionDanger}
            onClick={onStop}
            aria-label={`Stop ${profile.name}`}
          >
            <StopIcon /> Stop
          </button>
          <button
            className={styles.actionPurple}
            onClick={onRestart}
            aria-label={`Restart ${profile.name}`}
          >
            <RestartIcon /> Restart
          </button>
          <button
            className={styles.actionGhost}
            onClick={() => onFocusOutput(profile.id)}
            aria-label={`View output ${profile.name}`}
          >
            Output
          </button>
        </>
      ) : (
        <>
          <button
            className={styles.actionPrimary}
            onClick={onStart}
            aria-label={`Start ${profile.name}`}
          >
            <PlayIcon /> Run
          </button>
          <button
            className={styles.actionGhost}
            onClick={() => onFocusOutput(profile.id)}
            aria-label={`View output ${profile.name}`}
          >
            Output
          </button>
        </>
      )}
      <span className={styles.spacer} />
      <button className={styles.actionGhost} onClick={onPin} aria-label={`Pin ${profile.name}`}>
        Pin
      </button>
      <button className={styles.actionGhost} onClick={onUnpin} aria-label={`Unpin ${profile.name}`}>
        Unpin
      </button>
      <button className={styles.actionGhost} onClick={onHide} aria-label={`Hide ${profile.name}`}>
        Hide
      </button>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────── */

export function ExpandedPanel({
  profile,
  visualState,
  runOutput,
  runHistory,
  waveformData,
  elapsed,
  stopElapsedMs,
  onFocusOutput,
  onStart,
  onStop,
  onRestart,
  onPin,
  onUnpin,
  onHide,
}: ExpandedPanelProps) {
  function renderPanel() {
    switch (visualState) {
      case 'running':
        return (
          <RunningPanel
            profile={profile}
            runOutput={runOutput}
            runHistory={runHistory}
            waveformData={waveformData}
            elapsed={elapsed}
          />
        );
      case 'stopping':
        return (
          <StoppingPanel
            profile={profile}
            runOutput={runOutput}
            runHistory={runHistory}
            waveformData={waveformData}
            elapsed={elapsed}
            stopElapsedMs={stopElapsedMs}
          />
        );
      case 'failed':
        return (
          <FailedPanel
            profile={profile}
            runOutput={runOutput}
            runHistory={runHistory}
            waveformData={waveformData}
            elapsed={elapsed}
          />
        );
      case 'success':
        return (
          <SuccessPanel
            profile={profile}
            runOutput={runOutput}
            runHistory={runHistory}
            waveformData={waveformData}
            elapsed={elapsed}
          />
        );
      case 'stopped':
        return <StoppedPanel profile={profile} />;
      case 'idle':
        if (runHistory.length === 0) {
          return <DormantPanel profile={profile} />;
        }
        return (
          <IdlePanel
            profile={profile}
            runOutput={runOutput}
            runHistory={runHistory}
            elapsed={elapsed}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {renderPanel()}
      <ActionsRow
        profile={profile}
        visualState={visualState}
        onFocusOutput={onFocusOutput}
        onStart={onStart}
        onStop={onStop}
        onRestart={onRestart}
        onPin={onPin}
        onUnpin={onUnpin}
        onHide={onHide}
      />
      {runHistory.length > 0 && (
        <div className={styles.historyRow}>
          <RunHistoryDots
            history={runHistory}
            isCurrentlyRunning={visualState === 'running'}
            expanded
          />
        </div>
      )}
    </div>
  );
}

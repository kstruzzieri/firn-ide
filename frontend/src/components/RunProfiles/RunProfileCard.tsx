import { useState, useEffect } from 'react';
import { ActivityWaveform } from './ActivityWaveform';
import { RunHistoryDots } from './RunHistoryDots';
import { StatusBadge } from './StatusBadge';
import { ExpandedPanel } from './ExpandedPanel';
import { getTagColor } from '../../utils/tagColors';
import { formatDuration } from '../../utils/formatDuration';
import { PlayIcon, StopIcon, RestartIcon, LoaderIcon } from '../icons';
import {
  StartRunProfile,
  StopRunProfile,
  RestartRunProfile,
  PinRunProfile,
  UnpinRunProfile,
} from '../../../wailsjs/go/main/App';
import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile } from '../../types/runProfile';
import type { VisualState, RunHistoryEntry, RunOutput } from '../../types/runOutput';
import styles from './RunProfileCard.module.css';

/**
 * Custom hook for a live elapsed timer. Returns elapsed ms since startTs.
 * Returns 0 when startTs is undefined (not running).
 */
function useElapsedTimer(startTs: number | undefined): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTs) {
      setElapsed(0); // eslint-disable-line react-hooks/set-state-in-effect -- reset is intentional on dependency change
      return;
    }
    // Initial value + interval — all managed in one effect
    setElapsed(Date.now() - startTs);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTs);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTs]);

  return startTs ? elapsed : 0;
}

interface RunProfileCardProps {
  profile: RunProfile;
  visualState: VisualState;
  runOutput: RunOutput | undefined;
  runHistory: RunHistoryEntry[];
  waveformData: number[];
  isDormant: boolean;
  isDuplicate: boolean;
  onFocusOutput: (profileId: string) => void;
}

function getStateClass(visualState: VisualState): string {
  switch (visualState) {
    case 'running':
      return styles.running;
    case 'stopping':
      return styles.stopping;
    case 'failed':
      return styles.failed;
    case 'success':
      return styles.success;
    default:
      return '';
  }
}

function getDurationLabel(
  visualState: VisualState,
  elapsed: number,
  runHistory: RunHistoryEntry[],
  runOutput: RunOutput | undefined,
  isDormant: boolean
): string {
  if (isDormant) return '';

  switch (visualState) {
    case 'running':
      return formatDuration(elapsed);
    case 'stopping':
      return 'stopping\u2026';
    case 'failed':
      return runOutput !== undefined ? `exit ${runOutput.exitCode}` : 'failed';
    case 'success': {
      const last = runHistory[runHistory.length - 1];
      return last ? formatDuration(last.duration) : '';
    }
    case 'stopped':
      return 'stopped';
    case 'idle': {
      const last = runHistory[runHistory.length - 1];
      return last ? formatDuration(last.duration) : '';
    }
    default:
      return '';
  }
}

export function RunProfileCard({
  profile,
  visualState,
  runOutput,
  runHistory,
  waveformData,
  isDormant,
  isDuplicate,
  onFocusOutput,
}: RunProfileCardProps) {
  const setProfileStopping = useIDEStore((s) => s.setProfileStopping);
  const clearProfileStopping = useIDEStore((s) => s.clearProfileStopping);
  const setProfileRestarting = useIDEStore((s) => s.setProfileRestarting);
  const clearProfileRestarting = useIDEStore((s) => s.clearProfileRestarting);
  const showToast = useIDEStore((s) => s.showToast);

  const startTs = useIDEStore((s) => s.runStartTimestamps[profile.id]);
  const stopRequestTs = useIDEStore((s) => s.stopRequestTimestamps[profile.id]);

  const computedElapsed = useElapsedTimer(visualState === 'running' ? startTs : undefined);
  const computedStopElapsed = useElapsedTimer(
    visualState === 'stopping' ? stopRequestTs : undefined
  );

  // Shared action handlers — used by both inline action button and ExpandedPanel
  const handleStart = () => {
    StartRunProfile(profile.id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to start "${profile.name}": ${message}`, 'error');
    });
  };

  const handleStop = () => {
    setProfileStopping(profile.id);
    StopRunProfile(profile.id).catch((err: unknown) => {
      clearProfileStopping(profile.id);
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to stop "${profile.name}": ${message}`, 'error');
    });
  };

  const handleRestart = () => {
    setProfileRestarting(profile.id);
    RestartRunProfile(profile.id).catch((err: unknown) => {
      clearProfileRestarting(profile.id);
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to restart "${profile.name}": ${message}`, 'error');
    });
  };

  const handlePin = () => {
    PinRunProfile(profile.id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to pin "${profile.name}": ${message}`, 'error');
    });
  };

  const handleUnpin = () => {
    UnpinRunProfile(profile.id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to unpin "${profile.name}": ${message}`, 'error');
    });
  };

  const handleHide = () => {
    useIDEStore.getState().hideProfile(profile.id);
  };

  const handleCardClick = () => {
    if (isDormant) {
      handleStart();
    } else {
      onFocusOutput(profile.id);
    }
  };

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (visualState === 'idle' || visualState === 'success') {
      handleStart();
    } else if (visualState === 'running') {
      handleStop();
    } else if (visualState === 'stopped' || visualState === 'failed') {
      handleRestart();
    }
  };

  const durationLabel = getDurationLabel(
    visualState,
    computedElapsed,
    runHistory,
    runOutput,
    isDormant
  );

  const isActiveState =
    visualState === 'running' || visualState === 'stopping' || visualState === 'failed';

  const cardClassName = [
    styles.card,
    getStateClass(visualState),
    isDormant ? styles.dormant : '',
    isActiveState ? styles.forceExpand : '',
  ]
    .filter(Boolean)
    .join(' ');

  function renderActionButton() {
    if (visualState === 'stopping') {
      return (
        <button
          className={`${styles.actionBtn} ${styles.actionBtnLoading}`}
          disabled
          aria-label="Stopping"
          tabIndex={-1}
        >
          <LoaderIcon aria-hidden="true" />
        </button>
      );
    }

    if (visualState === 'running') {
      return (
        <button
          className={`${styles.actionBtn} ${styles.actionBtnStop}`}
          onClick={handleActionClick}
          aria-label={`Stop ${profile.name}`}
        >
          <StopIcon aria-hidden="true" />
        </button>
      );
    }

    if (visualState === 'stopped' || visualState === 'failed') {
      return (
        <button
          className={`${styles.actionBtn} ${styles.actionBtnRestart}`}
          onClick={handleActionClick}
          aria-label={`Restart ${profile.name}`}
        >
          <RestartIcon aria-hidden="true" />
        </button>
      );
    }

    // idle / success
    return (
      <button
        className={`${styles.actionBtn} ${styles.actionBtnPlay}`}
        onClick={handleActionClick}
        aria-label={`Run ${profile.name}`}
      >
        <PlayIcon aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      className={cardClassName}
      onClick={handleCardClick}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      role="button"
      aria-label={profile.name}
    >
      <div className={styles.rail} />

      {/* Row 1: action button + name + duration */}
      <div className={styles.row1}>
        {renderActionButton()}
        <span className={styles.name}>{profile.name}</span>
        <StatusBadge visualState={visualState} profile={profile} runHistory={runHistory} />
        {durationLabel && <span className={styles.duration}>{durationLabel}</span>}
      </div>

      {/* Row 2: command line */}
      {profile.command && (
        <div className={styles.cmd}>
          {profile.command}
          {isDuplicate && profile.detectedFrom && (
            <span style={{ display: 'block', color: '#2a2a2a', fontSize: 9, marginTop: 1 }}>
              {profile.detectedFrom}
            </span>
          )}
        </div>
      )}

      {/* Row 3: waveform + tags + history dots */}
      <div className={styles.rowBottom}>
        <ActivityWaveform data={waveformData} visualState={visualState} />
        {profile.tags && profile.tags.length > 0 && (
          <div className={styles.tags}>
            {profile.tags.map((tag) => {
              const color = getTagColor(tag);
              return (
                <span
                  key={tag}
                  className={styles.tag}
                  style={{ background: color.background, color: color.text }}
                >
                  {tag}
                </span>
              );
            })}
          </div>
        )}
        <RunHistoryDots history={runHistory} isCurrentlyRunning={visualState === 'running'} />
      </div>

      {/* Hover reveal — expanded on hover/focus */}
      <div className={styles.hoverReveal}>
        <ExpandedPanel
          profile={profile}
          visualState={visualState}
          runOutput={runOutput}
          runHistory={runHistory}
          waveformData={waveformData}
          elapsed={computedElapsed}
          stopElapsedMs={computedStopElapsed}
          onFocusOutput={onFocusOutput}
          onStart={handleStart}
          onStop={handleStop}
          onRestart={handleRestart}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onHide={handleHide}
        />
      </div>
    </div>
  );
}

import {
  useIDEStore,
  useRunOutputViewMode,
  useRunOutputAutoScroll,
  useActiveRunOutputId,
} from '../../stores/ideStore';
import { RestartRunProfile, StopRunProfile } from '../../../wailsjs/go/main/App';
import { ALL_PROFILES_ID } from '../../types/runOutput';
import type { RunOutputViewMode } from '../../types/runOutput';
import styles from './RunOutput.module.css';

function showError(action: string, profileId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  useIDEStore.getState().showToast(`Failed to ${action} "${profileId}": ${message}`, 'error');
}

const VIEW_MODES: Array<{ id: RunOutputViewMode; label: string }> = [
  { id: 'merged', label: 'Merged' },
  { id: 'lanes', label: 'Lanes' },
  { id: 'diff', label: 'Diff' },
  { id: 'timeline', label: 'Timeline' },
];

export function RunOutputToolbar() {
  const viewMode = useRunOutputViewMode();
  const autoScroll = useRunOutputAutoScroll();
  const activeId = useActiveRunOutputId();
  const setViewMode = useIDEStore((s) => s.setRunOutputViewMode);
  const toggleAutoScroll = useIDEStore((s) => s.toggleAutoScroll);
  const clearRunOutput = useIDEStore((s) => s.clearRunOutput);
  const clearAllRunOutputs = useIDEStore((s) => s.clearAllRunOutputs);
  const clearCompoundRunOutput = useIDEStore((s) => s.clearCompoundRunOutput);
  const setActiveRunOutput = useIDEStore((s) => s.setActiveRunOutput);
  const runOutputs = useIDEStore((s) => s.runOutputs);
  const runCompounds = useIDEStore((s) => s.runCompounds);

  const isAllProfiles = activeId === ALL_PROFILES_ID;
  const hasActiveProfile = activeId && !isAllProfiles;
  const activeOutput = hasActiveProfile ? runOutputs[activeId] : undefined;
  const activeCompound = activeId && !isAllProfiles ? runCompounds[activeId] : undefined;
  const isRunning = activeOutput?.state === 'running' || activeCompound?.state === 'running';
  // Timeline is ordinary-profiles-only: exclude compound aggregates (a compound
  // emits an aggregate run:status, so runOutputs[compoundId] exists) so they do
  // not inflate the count or render as empty timeline sources.
  const outputIds = Object.keys(runOutputs).filter((id) => !runCompounds[id]);
  const canTimeline = outputIds.length >= 2;

  const handleViewMode = (mode: RunOutputViewMode) => {
    // Gate timeline mode: only allow with 2+ profiles
    if (mode === 'timeline' && !canTimeline) return;
    setViewMode(mode);
    if (mode === 'timeline') {
      setActiveRunOutput(ALL_PROFILES_ID);
    } else if (isAllProfiles) {
      const firstId = outputIds[0];
      if (firstId) setActiveRunOutput(firstId);
    }
  };

  const handleRerun = () => {
    if (hasActiveProfile) {
      RestartRunProfile(activeId).catch((err: unknown) => showError('restart', activeId, err));
    }
  };

  const handleStop = () => {
    // activeId is the compound id for compounds, which the bindings accept directly.
    if (activeId && isRunning) {
      StopRunProfile(activeId).catch((err: unknown) => showError('stop', activeId, err));
    }
  };

  const handleClear = () => {
    if (activeCompound) {
      clearCompoundRunOutput(activeId as string);
    } else if (isAllProfiles) {
      clearAllRunOutputs();
    } else if (activeId) {
      clearRunOutput(activeId);
    }
  };

  return (
    <div className={styles.toolbar}>
      {/* The compound view owns its own internal tabs, so hide the segmented
          view-mode group while a compound run is active. */}
      {!activeCompound && (
        <div className={styles.viewModeGroup}>
          {VIEW_MODES.map(({ id, label }) => (
            <button
              key={id}
              className={`${styles.viewModeBtn} ${viewMode === id ? styles.active : ''}`}
              onClick={() => handleViewMode(id)}
              disabled={id === 'timeline' && !canTimeline}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.toolbarDivider} />

      <button
        className={styles.toolbarBtn}
        onClick={handleRerun}
        disabled={!hasActiveProfile}
        title="Re-run"
        aria-label="Re-run profile"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>

      <button
        className={`${styles.toolbarBtn} ${styles.danger}`}
        onClick={handleStop}
        disabled={!isRunning}
        title="Stop"
        aria-label="Stop profile"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>

      <button
        className={styles.toolbarBtn}
        onClick={handleClear}
        disabled={!activeId}
        title="Clear output"
        aria-label="Clear output"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
      </button>

      <div className={styles.toolbarSpacer} />

      <button
        className={`${styles.autoscrollIndicator} ${autoScroll ? styles.pinned : ''}`}
        onClick={toggleAutoScroll}
        title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
        aria-label="Toggle auto-scroll"
      >
        <span className={styles.autoscrollDot} />
        Auto-scroll
      </button>
    </div>
  );
}

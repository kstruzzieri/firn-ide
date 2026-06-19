import { useEffect, useState, useCallback, useMemo } from 'react';
import { MergedView } from '../RunOutput/MergedView';
import { SourceTimelineView } from '../RunOutput/SourceTimelineView';
import type { TimelineSource } from '../RunOutput/SourceTimelineView';
import { resolveFileReferencePath } from '../../utils/parseFileReferences';
import { useIDEStore, useWorkspace, useRunOutputAutoScroll } from '../../stores/ideStore';
import { StopRunProfile } from '../../../wailsjs/go/main/App';
import type { CompoundRun, CompoundStep, CompoundStepState } from '../../types/runOutput';
import styles from './CompoundExecutionView.module.css';

interface CompoundExecutionViewProps {
  compound: CompoundRun;
}

const STATE_LABELS: Record<CompoundStepState, string> = {
  pending: 'Pending',
  running: 'Running',
  success: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
  stopped: 'Stopped',
};

/** Format a millisecond duration as `Nms` (sub-second) or `Ns` (>= 1s). */
function formatStepDuration(ms: number): string {
  if (ms <= 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${Math.round(ms / 1000)}s`;
}

/** Format the compound ETA as `~Ns`. */
function formatEta(ms: number): string {
  return `~${Math.round(ms / 1000)}s`;
}

export function CompoundExecutionView({ compound }: CompoundExecutionViewProps) {
  const workspace = useWorkspace();
  const workspacePath = workspace?.path;
  const autoScroll = useRunOutputAutoScroll();
  const showToast = useIDEStore((s) => s.showToast);
  const requestEditorNavigation = useIDEStore((s) => s.requestEditorNavigation);

  const [selectedStepIdx, setSelectedStepIdx] = useState<number>(
    () => compound.steps.find((s) => s.state === 'running')?.idx ?? compound.steps[0]?.idx ?? 0
  );
  const [tab, setTab] = useState<'stages' | 'all'>('stages');
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set());

  const runningStepIdx = compound.steps.find((s) => s.state === 'running')?.idx;
  const isAggregateFailed = compound.state === 'failed';
  const firstFailedStepIdx = compound.steps.find((s) => s.state === 'failed')?.idx;

  // Auto-select the running stage when a step transitions to running.
  useEffect(() => {
    if (runningStepIdx !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional auto-follow of the active step
      setSelectedStepIdx(runningStepIdx);
    }
  }, [runningStepIdx]);

  // Auto-select the first failed stage when the compound aggregate fails.
  useEffect(() => {
    if (isAggregateFailed && firstFailedStepIdx !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional jump to the failed step
      setSelectedStepIdx(firstFailedStepIdx);
    }
  }, [isAggregateFailed, firstFailedStepIdx]);

  const selectedStep: CompoundStep | undefined = compound.steps.find(
    (s) => s.idx === selectedStepIdx
  );
  const selectedEntries = compound.stepOutputs[selectedStepIdx] ?? [];

  const handleToggleFold = useCallback((foldId: string) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(foldId)) {
        next.delete(foldId);
      } else {
        next.add(foldId);
      }
      return next;
    });
  }, []);

  const handleStop = () => {
    StopRunProfile(compound.compoundId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to stop "${compound.name}": ${message}`, 'error');
    });
  };

  const handleJumpToFailure = () => {
    if (!compound.failedReference) return;
    const failedStep = compound.steps.find((s) => s.idx === compound.failedReference!.stepIdx);
    const resolvedPath = resolveFileReferencePath(
      compound.failedReference.path,
      failedStep?.workingDir,
      workspacePath
    );
    requestEditorNavigation(
      resolvedPath,
      compound.failedReference.line,
      compound.failedReference.column
    );
  };

  const timelineSources: TimelineSource[] = useMemo(
    () =>
      compound.steps.map((step) => ({
        id: String(step.idx),
        label: step.name,
        workingDir: step.workingDir,
        entries: compound.stepOutputs[step.idx] ?? [],
      })),
    [compound.steps, compound.stepOutputs]
  );

  return (
    <div className={styles.compoundRoot}>
      <div className={styles.header}>
        <span className={styles.headerName}>{compound.name}</span>
        <span className={styles.headerBadge} data-state={compound.state}>
          {compound.state}
        </span>
        {compound.etaMs !== undefined && (
          <span className={styles.eta}>{formatEta(compound.etaMs)}</span>
        )}
        <span className={styles.headerSpacer} />
        <div className={styles.headerActions}>
          {compound.failedReference && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.jumpButton}`}
              onClick={handleJumpToFailure}
            >
              Jump to failure
            </button>
          )}
          {compound.state === 'running' && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.stopButton}`}
              onClick={handleStop}
              aria-label={`Stop ${compound.name}`}
            >
              Stop
            </button>
          )}
        </div>
      </div>

      <div className={styles.tabBar}>
        <div className={styles.tabGroup}>
          <button
            type="button"
            aria-pressed={tab === 'stages'}
            className={styles.tabButton}
            onClick={() => setTab('stages')}
          >
            Stages
          </button>
          <button
            type="button"
            aria-pressed={tab === 'all'}
            className={styles.tabButton}
            onClick={() => setTab('all')}
          >
            All steps
          </button>
        </div>
      </div>

      {tab === 'stages' ? (
        <div className={styles.compoundBody}>
          <div className={styles.stageList}>
            {compound.steps.map((step) => {
              const duration = formatStepDuration(step.durationMs);
              const isSelected = step.idx === selectedStepIdx;
              return (
                <button
                  type="button"
                  key={step.idx}
                  className={`${styles.stageRow} ${isSelected ? styles.selected : ''}`}
                  data-state={step.state}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => setSelectedStepIdx(step.idx)}
                >
                  <span className={styles.stageDot} data-state={step.state} aria-hidden="true" />
                  <span className={styles.stageInfo}>
                    <span className={styles.stageName}>{step.name}</span>
                    <span className={styles.stageMeta}>
                      <span className={styles.stageState} data-state={step.state}>
                        {STATE_LABELS[step.state]}
                      </span>
                      {duration && <span className={styles.stageDuration}>{duration}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className={styles.stageOutput}>
            {selectedEntries.length === 0 && selectedStep?.errorMessage ? (
              <div className={styles.stageError}>{selectedStep.errorMessage}</div>
            ) : (
              <MergedView
                entries={selectedEntries}
                autoScroll={autoScroll}
                expandedFolds={expandedFolds}
                onToggleFold={handleToggleFold}
                workingDir={selectedStep?.workingDir}
                workspacePath={workspacePath}
              />
            )}
          </div>
        </div>
      ) : (
        <div className={styles.allBody}>
          <SourceTimelineView
            sources={timelineSources}
            autoScroll={autoScroll}
            workspacePath={workspacePath}
            emptyMessage="No output yet"
          />
        </div>
      )}
    </div>
  );
}

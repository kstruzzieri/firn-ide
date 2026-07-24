import { useState, useCallback, useMemo } from 'react';
import {
  useActiveRunOutput,
  useActiveCompoundRun,
  useRunOutputViewMode,
  useRunOutputAutoScroll,
  useRunOutputs,
  useWorkspace,
  useIDEStore,
} from '../../stores/ideStore';
import { RunOutputToolbar } from './RunOutputToolbar';
import { RunOutputTabs } from './RunOutputTabs';
import { MergedView } from './MergedView';
import { LanesView } from './LanesView';
import { DiffView } from './DiffView';
import { TimelineView } from './TimelineView';
// Import the compound view file directly (not the RunProfiles barrel) to avoid a
// circular import, since CompoundExecutionView imports from ../RunOutput/*.
import { CompoundExecutionView } from '../RunProfiles/CompoundExecutionView';
import styles from './RunOutput.module.css';

export function RunOutputPanel() {
  const activeOutput = useActiveRunOutput();
  const activeCompound = useActiveCompoundRun();
  const viewMode = useRunOutputViewMode();
  const autoScroll = useRunOutputAutoScroll();
  const runOutputs = useRunOutputs();
  const runInstanceIdsByProfile = useIDEStore((state) => state.runInstanceIdsByProfile);
  const latestRunInstanceIdByProfile = useIDEStore((state) => state.latestRunInstanceIdByProfile);
  const workspace = useWorkspace();
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set());

  const workspacePath = workspace?.path;
  const activeWorkingDir = activeOutput?.workingDir;

  const timelineOutputs = useMemo(() => {
    const filtered: typeof runOutputs = {};
    for (const id of Object.values(latestRunInstanceIdByProfile)) {
      if (runOutputs[id]) filtered[id] = runOutputs[id];
    }
    return filtered;
  }, [runOutputs, latestRunInstanceIdByProfile]);

  const previousOutput = useMemo(() => {
    if (!activeOutput) return undefined;
    const ids = runInstanceIdsByProfile[activeOutput.profileId] ?? [];
    const index = ids.indexOf(activeOutput.runInstanceId);
    return index > 0 ? runOutputs[ids[index - 1]] : undefined;
  }, [activeOutput, runInstanceIdsByProfile, runOutputs]);

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

  // A compound run owns the entire output surface (it has its own internal
  // tabs/views), so it takes precedence over the ordinary view modes.
  if (activeCompound) {
    return (
      <div className={styles.panelContainer}>
        <RunOutputTabs />
        <RunOutputToolbar />
        <CompoundExecutionView key={activeCompound.compoundId} compound={activeCompound} />
      </div>
    );
  }

  return (
    <div className={styles.panelContainer}>
      <RunOutputTabs />
      <RunOutputToolbar />
      {viewMode === 'timeline' ? (
        <TimelineView
          runOutputs={timelineOutputs}
          autoScroll={autoScroll}
          workspacePath={workspacePath}
        />
      ) : activeOutput ? (
        <>
          {viewMode === 'merged' && (
            <MergedView
              entries={activeOutput.entries}
              autoScroll={autoScroll}
              expandedFolds={expandedFolds}
              onToggleFold={handleToggleFold}
              workingDir={activeWorkingDir}
              workspacePath={workspacePath}
            />
          )}
          {viewMode === 'lanes' && (
            <LanesView
              entries={activeOutput.entries}
              autoScroll={autoScroll}
              workingDir={activeWorkingDir}
              workspacePath={workspacePath}
            />
          )}
          {viewMode === 'diff' && (
            <DiffView
              entries={activeOutput.entries}
              previousEntries={previousOutput?.entries ?? []}
              workingDir={activeWorkingDir}
              previousWorkingDir={previousOutput?.workingDir}
              workspacePath={workspacePath}
            />
          )}
        </>
      ) : (
        <div className={styles.emptyState}>
          <p>Run a profile to see output here</p>
        </div>
      )}
    </div>
  );
}

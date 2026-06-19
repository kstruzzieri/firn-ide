import { useState, useCallback, useMemo } from 'react';
import {
  useActiveRunOutput,
  useActiveCompoundRun,
  useRunOutputViewMode,
  useRunOutputAutoScroll,
  useRunOutputs,
  useRunCompounds,
  useWorkspace,
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
  const runCompounds = useRunCompounds();
  const workspace = useWorkspace();
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set());

  const workspacePath = workspace?.path;
  const activeWorkingDir = activeOutput?.workingDir;

  // The global timeline is ordinary-profiles-only. A compound emits an aggregate
  // run:status, so runOutputs[compoundId] exists (for the card badge) but carries
  // no entries — exclude those so the timeline doesn't render empty sources.
  const timelineOutputs = useMemo(() => {
    const filtered: typeof runOutputs = {};
    for (const [id, output] of Object.entries(runOutputs)) {
      if (!runCompounds[id]) filtered[id] = output;
    }
    return filtered;
  }, [runOutputs, runCompounds]);

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
        <CompoundExecutionView compound={activeCompound} />
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
              previousEntries={activeOutput.previousEntries}
              workingDir={activeWorkingDir}
              previousWorkingDir={activeOutput.previousWorkingDir}
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

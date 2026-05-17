import { useState, useCallback, useMemo } from 'react';
import {
  useActiveRunOutput,
  useRunOutputViewMode,
  useRunOutputAutoScroll,
  useRunOutputs,
  useRunProfiles,
  useWorkspace,
} from '../../stores/ideStore';
import { RunOutputToolbar } from './RunOutputToolbar';
import { RunOutputTabs } from './RunOutputTabs';
import { MergedView } from './MergedView';
import { LanesView } from './LanesView';
import { DiffView } from './DiffView';
import { TimelineView } from './TimelineView';
import styles from './RunOutput.module.css';

export function RunOutputPanel() {
  const activeOutput = useActiveRunOutput();
  const viewMode = useRunOutputViewMode();
  const autoScroll = useRunOutputAutoScroll();
  const runOutputs = useRunOutputs();
  const runProfiles = useRunProfiles();
  const workspace = useWorkspace();
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set());

  const profileWorkingDirs = useMemo(() => {
    const workingDirs: Record<string, string | undefined> = {};
    for (const profile of runProfiles) {
      workingDirs[profile.id] = profile.workingDir;
    }
    return workingDirs;
  }, [runProfiles]);

  const workspacePath = workspace?.path;
  const activeWorkingDir = activeOutput ? profileWorkingDirs[activeOutput.profileId] : undefined;

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

  return (
    <div className={styles.panelContainer}>
      <RunOutputTabs />
      <RunOutputToolbar />
      {viewMode === 'timeline' ? (
        <TimelineView
          runOutputs={runOutputs}
          autoScroll={autoScroll}
          profileWorkingDirs={profileWorkingDirs}
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

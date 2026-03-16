import { useState, useCallback } from 'react';
import {
  useActiveRunOutput,
  useRunOutputViewMode,
  useRunOutputAutoScroll,
  useRunOutputs,
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
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set());

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
        <TimelineView runOutputs={runOutputs} autoScroll={autoScroll} />
      ) : activeOutput ? (
        <>
          {viewMode === 'merged' && (
            <MergedView
              entries={activeOutput.entries}
              autoScroll={autoScroll}
              expandedFolds={expandedFolds}
              onToggleFold={handleToggleFold}
            />
          )}
          {viewMode === 'lanes' && (
            <LanesView entries={activeOutput.entries} autoScroll={autoScroll} />
          )}
          {viewMode === 'diff' && (
            <DiffView
              entries={activeOutput.entries}
              previousEntries={activeOutput.previousEntries}
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

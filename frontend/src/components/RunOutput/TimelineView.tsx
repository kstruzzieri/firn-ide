import { useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RunOutput, OutputEntry } from '../../types/runOutput';
import { OutputLine } from './OutputLine';
import styles from './RunOutput.module.css';

interface TimelineViewProps {
  runOutputs: Record<string, RunOutput>;
  autoScroll: boolean;
  workspacePath?: string;
}

interface TimelineEntry extends OutputEntry {
  profileId: string;
}

const PROFILE_COLOR_CLASSES = ['frontend', 'backend', 'lint', 'test', 'deploy'] as const;

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

export function TimelineView({ runOutputs, autoScroll, workspacePath }: TimelineViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const profileIds = useMemo(() => Object.keys(runOutputs), [runOutputs]);
  const profileColorMap = useMemo(() => {
    const map = new Map<string, string>();
    profileIds.forEach((id, idx) => {
      map.set(id, PROFILE_COLOR_CLASSES[idx % PROFILE_COLOR_CLASSES.length]);
    });
    return map;
  }, [profileIds]);

  const entries = useMemo(() => {
    const all: TimelineEntry[] = [];
    for (const id of profileIds) {
      const output = runOutputs[id];
      for (const entry of output.entries) {
        all.push({ ...entry, profileId: output.profileId });
      }
    }
    all.sort((a, b) => a.timestamp - b.timestamp);
    return all;
  }, [runOutputs, profileIds]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  useEffect(() => {
    if (autoScroll && entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
    }
  }, [entries.length, autoScroll, virtualizer]);

  if (entries.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No output from any profile</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className={styles.outputContent}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = entries[virtualRow.index];
          const colorClass = profileColorMap.get(entry.profileId) ?? PROFILE_COLOR_CLASSES[0];
          return (
            <div
              key={virtualRow.index}
              className={styles.timelineLine}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
            >
              <span className={styles.timelineTimestamp}>{formatTimestamp(entry.timestamp)}</span>
              <span className={`${styles.timelineProfile} ${styles[colorClass]}`}>
                {entry.profileId}
              </span>
              <OutputLine
                text={entry.text}
                className={`${styles.timelineData} ${entry.stream === 'stderr' ? styles.stderr : ''}`}
                workingDir={runOutputs[entry.profileId]?.workingDir}
                workspacePath={workspacePath}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

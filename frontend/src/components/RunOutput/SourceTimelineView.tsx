import { useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { OutputEntry } from '../../types/runOutput';
import { OutputLine } from './OutputLine';
import styles from './RunOutput.module.css';

export interface TimelineSource {
  id: string;
  label: string;
  workingDir?: string;
  entries: OutputEntry[];
}

export interface MergedTimelineEntry extends OutputEntry {
  sourceId: string;
  sourceLabel: string;
  workingDir?: string;
}

interface SourceTimelineViewProps {
  sources: TimelineSource[];
  autoScroll: boolean;
  workspacePath?: string;
  emptyMessage?: string;
}

const PROFILE_COLOR_CLASSES = ['frontend', 'backend', 'lint', 'test', 'deploy'] as const;

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

/**
 * Pure function: flatten all sources into a single time-sorted list.
 * Stable: entries with equal timestamps preserve source-then-entry order
 * because we pre-flatten in source/entry order and use a stable sort.
 */
export function mergeTimelineSources(sources: TimelineSource[]): MergedTimelineEntry[] {
  const all: MergedTimelineEntry[] = [];
  for (const source of sources) {
    for (const entry of source.entries) {
      all.push({
        ...entry,
        sourceId: source.id,
        sourceLabel: source.label,
        workingDir: source.workingDir,
      });
    }
  }
  // Array.prototype.sort is stable in V8 (and required by ES2019+)
  all.sort((a, b) => a.timestamp - b.timestamp);
  return all;
}

export function SourceTimelineView({
  sources,
  autoScroll,
  workspacePath,
  emptyMessage = 'No output',
}: SourceTimelineViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    sources.forEach((source, idx) => {
      map.set(source.id, PROFILE_COLOR_CLASSES[idx % PROFILE_COLOR_CLASSES.length]);
    });
    return map;
  }, [sources]);

  const entries = useMemo(() => mergeTimelineSources(sources), [sources]);

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
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className={styles.outputContent}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = entries[virtualRow.index];
          const colorClass = colorMap.get(entry.sourceId) ?? PROFILE_COLOR_CLASSES[0];
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
                {entry.sourceLabel}
              </span>
              <OutputLine
                text={entry.text}
                className={`${styles.timelineData} ${entry.stream === 'stderr' ? styles.stderr : ''}`}
                workingDir={entry.workingDir}
                workspacePath={workspacePath}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

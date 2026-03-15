import { useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { OutputEntry } from '../../types/runOutput';
import { diffOutputLines } from '../../utils/diffOutput';
import styles from './RunOutput.module.css';

interface DiffViewProps {
  entries: OutputEntry[];
  previousEntries: OutputEntry[];
}

export function DiffView({ entries, previousEntries }: DiffViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const diffLines = useMemo(() => {
    return diffOutputLines(
      previousEntries.map((e) => e.text),
      entries.map((e) => e.text)
    );
  }, [entries, previousEntries]);

  const virtualizer = useVirtualizer({
    count: diffLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  if (previousEntries.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>Run this profile again to see what changed</p>
      </div>
    );
  }

  if (diffLines.length === 1 && diffLines[0].type === 'too-large') {
    return (
      <div className={styles.emptyState}>
        <p>Output too large to diff</p>
      </div>
    );
  }

  const added = diffLines.filter((l) => l.type === 'added').length;
  const removed = diffLines.filter((l) => l.type === 'removed').length;

  return (
    <div ref={parentRef} className={styles.outputContent}>
      <div className={styles.diffHeader}>
        <span className={styles.diffLabelPrev}>Previous run</span>
        <span className={styles.diffArrow}>→</span>
        <span className={styles.diffLabelCurr}>Current run</span>
        <span className={styles.diffStats}>
          {added} added, {removed} removed
        </span>
      </div>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const line = diffLines[virtualRow.index];
          return (
            <div
              key={virtualRow.index}
              className={`${styles.diffLine} ${styles[line.type]}`}
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
              <span className={styles.diffMarker}>
                {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
              </span>
              {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

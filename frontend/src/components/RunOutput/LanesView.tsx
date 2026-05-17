import { useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { OutputEntry } from '../../types/runOutput';
import { OutputLine } from './OutputLine';
import styles from './RunOutput.module.css';

interface LanesViewProps {
  entries: OutputEntry[];
  autoScroll: boolean;
  workingDir?: string;
  workspacePath?: string;
}

interface LaneRow {
  stdout: string | null;
  stderr: string | null;
}

export function LanesView({ entries, autoScroll, workingDir, workspacePath }: LanesViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    return entries.map(
      (entry): LaneRow => ({
        stdout: entry.stream === 'stdout' ? entry.text : null,
        stderr: entry.stream === 'stderr' ? entry.text : null,
      })
    );
  }, [entries]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  useEffect(() => {
    if (autoScroll && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  }, [rows.length, autoScroll, virtualizer]);

  if (entries.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No output to display</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className={styles.outputContent}>
      <div className={styles.laneHeaders}>
        <div className={`${styles.laneHeader} ${styles.stdoutHeader}`}>
          <span className={styles.laneDot} />
          stdout
        </div>
        <div className={`${styles.laneHeader} ${styles.stderrHeader}`}>
          <span className={styles.laneDot} />
          stderr
        </div>
      </div>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.index}
              className={styles.laneRow}
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
              <OutputLine
                text={row.stdout ?? ''}
                className={styles.laneLine}
                workingDir={workingDir}
                workspacePath={workspacePath}
              />
              <OutputLine
                text={row.stderr ?? ''}
                className={`${styles.laneLine} ${row.stderr != null ? styles.stderr : ''}`}
                workingDir={workingDir}
                workspacePath={workspacePath}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

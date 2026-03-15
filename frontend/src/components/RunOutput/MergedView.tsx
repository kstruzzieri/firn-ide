import { useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { OutputEntry } from '../../types/runOutput';
import { isFoldedRegion } from '../../types/runOutput';
import { foldOutput } from '../../utils/foldOutput';
import { SmartFold } from './SmartFold';
import styles from './RunOutput.module.css';

interface MergedViewProps {
  entries: OutputEntry[];
  autoScroll: boolean;
  expandedFolds: Set<string>;
  onToggleFold: (foldId: string) => void;
}

export function MergedView({ entries, autoScroll, expandedFolds, onToggleFold }: MergedViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => foldOutput(entries), [entries]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  useEffect(() => {
    if (autoScroll && items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    }
  }, [items.length, autoScroll, virtualizer]);

  if (entries.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No output to display</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className={styles.outputContent}>
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={virtualRow.index}
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
              {isFoldedRegion(item) ? (
                <SmartFold
                  fold={item}
                  isExpanded={expandedFolds.has(item.id)}
                  onToggle={onToggleFold}
                />
              ) : (
                <div className={`${styles.outputLine} ${styles[item.stream]}`}>{item.text}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

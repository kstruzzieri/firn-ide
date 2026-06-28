import {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type CSSProperties,
  type PointerEvent,
} from 'react';
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

// Column split is the fraction of width given to the stdout lane. Clamped so
// neither lane collapses below a usable minimum. Persisted globally (one split
// for all profiles) — mirrors the localStorage idiom in ideStore.
const LANE_SPLIT_KEY = 'firn.lanesSplit';
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;
const DEFAULT_SPLIT = 0.5;

export function clampSplit(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SPLIT;
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, n));
}

function loadSplit(): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LANE_SPLIT_KEY) : null;
    return raw == null ? DEFAULT_SPLIT : clampSplit(parseFloat(raw));
  } catch {
    return DEFAULT_SPLIT;
  }
}

function writeSplit(v: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANE_SPLIT_KEY, String(v));
  } catch {
    // localStorage may be unavailable (private mode / WebView quirks); split still applies in-session.
  }
}

export function LanesView({ entries, autoScroll, workingDir, workspacePath }: LanesViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<number>(loadSplit);
  const splitRef = useRef(split);
  splitRef.current = split;

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

  const onDividerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = parentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let latest = splitRef.current;
    const move = (ev: globalThis.PointerEvent) => {
      latest = clampSplit((ev.clientX - rect.left) / rect.width);
      setSplit(latest);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      writeSplit(latest);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }, []);

  if (entries.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No output to display</p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={`${styles.outputContent} ${styles.lanesScroll}`}
      style={{ ['--lane-split']: `${split * 100}%` } as CSSProperties}
    >
      <div className={styles.laneHeaders}>
        <div className={`${styles.laneHeader} ${styles.stdoutHeader}`}>
          <span className={styles.laneDot} />
          stdout
        </div>
        <div className={`${styles.laneHeader} ${styles.stderrHeader}`}>
          <span className={styles.laneDot} />
          stderr
        </div>
        <div
          className={styles.laneDivider}
          style={{ left: `${split * 100}%` }}
          onPointerDown={onDividerDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize stdout and stderr lanes"
        />
      </div>
      <div className={styles.laneRows} style={{ height: `${virtualizer.getTotalSize()}px` }}>
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

import {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
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

// Column split is the fraction of width given to the stdout lane. Clamped so
// neither lane collapses below a usable minimum. Persisted globally (one split
// for all profiles) — mirrors the localStorage idiom in ideStore.
const LANE_SPLIT_KEY = 'firn.lanesSplit';
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;
const DEFAULT_SPLIT = 0.5;

// Whether the two lanes share a scroll position. Off by default so a lopsided
// run (e.g. all-stderr `npm test`) still lets the user read stdout in full.
const LANE_SYNC_KEY = 'firn.lanesSyncScroll';

export function clampSplit(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SPLIT;
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, n));
}

/**
 * Map a source lane's scroll position onto the target lane's range by fraction,
 * so the two move together regardless of differing content heights. Returns the
 * scrollTop the target should adopt; 0 when the source has nothing to scroll.
 */
export function mirrorScrollTop(
  src: { scrollTop: number; scrollHeight: number; clientHeight: number },
  dst: { scrollHeight: number; clientHeight: number }
): number {
  const maxSrc = src.scrollHeight - src.clientHeight;
  const maxDst = dst.scrollHeight - dst.clientHeight;
  if (maxSrc <= 0) return 0;
  return (src.scrollTop / maxSrc) * maxDst;
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

function loadSync(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LANE_SYNC_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSync(v: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANE_SYNC_KEY, String(v));
  } catch {
    // Persistence is best-effort; the toggle still applies for the session.
  }
}

interface LaneProps {
  stream: 'stdout' | 'stderr';
  label: string;
  entries: OutputEntry[];
  autoScroll: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  workingDir?: string;
  workspacePath?: string;
  children?: ReactNode;
}

// One stream's scroll column. Owns its own virtualizer so it packs only its own
// lines (no blank filler rows) and scrolls independently of the sibling lane.
function Lane({
  stream,
  label,
  entries,
  autoScroll,
  scrollRef,
  onScroll,
  workingDir,
  workspacePath,
  children,
}: LaneProps) {
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  useEffect(() => {
    if (autoScroll && entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
    }
  }, [entries.length, autoScroll, virtualizer]);

  const headerClass =
    stream === 'stdout'
      ? `${styles.laneHeader} ${styles.stdoutHeader}`
      : `${styles.laneHeader} ${styles.stderrHeader}`;

  return (
    <div className={styles.lane}>
      <div className={headerClass}>
        <span className={styles.laneDot} />
        {label}
        {children}
      </div>
      <div ref={scrollRef} className={styles.laneColumn} data-stream={stream} onScroll={onScroll}>
        <div
          className={styles.laneColumnInner}
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.index}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className={styles.laneRow}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <OutputLine
                text={entries[virtualRow.index].text}
                className={`${styles.laneLine} ${stream === 'stderr' ? styles.stderr : ''}`}
                workingDir={workingDir}
                workspacePath={workspacePath}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LanesView({ entries, autoScroll, workingDir, workspacePath }: LanesViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const stdoutRef = useRef<HTMLDivElement>(null);
  const stderrRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<number>(loadSplit);
  const [sync, setSync] = useState<boolean>(loadSync);
  const splitRef = useRef(split);
  const syncRef = useRef(sync);
  const suppressRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Mirror the latest split/sync into refs the event handlers read, without
  // touching refs during render (handlers also update them imperatively).
  useEffect(() => {
    splitRef.current = split;
    syncRef.current = sync;
  }, [split, sync]);

  const stdoutEntries = useMemo(() => entries.filter((e) => e.stream === 'stdout'), [entries]);
  const stderrEntries = useMemo(() => entries.filter((e) => e.stream === 'stderr'), [entries]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  // Drive `dst` to match `src`'s scroll fraction when sync is on. The suppress
  // flag breaks the feedback loop: the programmatic scroll we trigger fires the
  // sibling's onScroll, which we swallow rather than echoing back.
  const couple = useCallback((src: HTMLDivElement | null, dst: HTMLDivElement | null) => {
    if (!syncRef.current) return;
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }
    if (!src || !dst) return;
    const target = mirrorScrollTop(src, dst);
    if (Math.abs(dst.scrollTop - target) < 0.5) return;
    suppressRef.current = true;
    dst.scrollTop = target;
  }, []);

  const onStdoutScroll = useCallback(() => couple(stdoutRef.current, stderrRef.current), [couple]);
  const onStderrScroll = useCallback(() => couple(stderrRef.current, stdoutRef.current), [couple]);

  const toggleSync = useCallback(() => {
    const next = !syncRef.current;
    syncRef.current = next;
    setSync(next);
    writeSync(next);
    // Align immediately on enable so the lanes start out moving together. Only
    // arm the suppress flag if we actually move stderr — otherwise no scroll
    // event fires to clear it and the next real scroll would be swallowed.
    if (next && stdoutRef.current && stderrRef.current) {
      const target = mirrorScrollTop(stdoutRef.current, stderrRef.current);
      if (Math.abs(stderrRef.current.scrollTop - target) >= 0.5) {
        suppressRef.current = true;
        stderrRef.current.scrollTop = target;
      }
    }
  }, []);

  const commitSplit = useCallback((value: number) => {
    const next = clampSplit(value);
    splitRef.current = next;
    setSplit(next);
    writeSplit(next);
  }, []);

  const onDividerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = bodyRef.current;
    if (!el) return;
    dragCleanupRef.current?.();
    const rect = el.getBoundingClientRect();
    let latest = splitRef.current;
    const move = (ev: globalThis.PointerEvent) => {
      latest = clampSplit((ev.clientX - rect.left) / rect.width);
      setSplit(latest);
    };
    const stop = () => {
      if (dragCleanupRef.current !== stop) return;
      dragCleanupRef.current = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      writeSplit(latest);
    };
    dragCleanupRef.current = stop;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  }, []);

  const onDividerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      let next: number | null = null;

      if (e.key === 'ArrowLeft') next = splitRef.current - step;
      if (e.key === 'ArrowRight') next = splitRef.current + step;
      if (e.key === 'Home') next = MIN_SPLIT;
      if (e.key === 'End') next = MAX_SPLIT;
      if (next == null) return;

      e.preventDefault();
      commitSplit(next);
    },
    [commitSplit]
  );

  if (entries.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No output to display</p>
      </div>
    );
  }

  return (
    <div
      className={styles.lanesView}
      style={{ ['--lane-split']: `${split * 100}%` } as CSSProperties}
    >
      <div ref={bodyRef} className={styles.laneBody}>
        <Lane
          stream="stdout"
          label="stdout"
          entries={stdoutEntries}
          autoScroll={autoScroll}
          scrollRef={stdoutRef}
          onScroll={onStdoutScroll}
          workingDir={workingDir}
          workspacePath={workspacePath}
        />
        <Lane
          stream="stderr"
          label="stderr"
          entries={stderrEntries}
          autoScroll={autoScroll}
          scrollRef={stderrRef}
          onScroll={onStderrScroll}
          workingDir={workingDir}
          workspacePath={workspacePath}
        >
          <button
            type="button"
            className={styles.laneSyncToggle}
            onClick={toggleSync}
            aria-pressed={sync}
            title={sync ? 'Sync scroll enabled' : 'Sync scroll disabled'}
          >
            <span className={styles.laneSyncDot} />
            Sync scroll
          </button>
        </Lane>
        <div
          className={styles.laneDivider}
          style={{ left: `${split * 100}%` }}
          onPointerDown={onDividerDown}
          onKeyDown={onDividerKeyDown}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize stdout and stderr lanes"
          aria-valuemin={MIN_SPLIT * 100}
          aria-valuemax={MAX_SPLIT * 100}
          aria-valuenow={Math.round(split * 100)}
        />
      </div>
    </div>
  );
}

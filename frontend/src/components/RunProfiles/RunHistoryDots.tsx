import type { RunHistoryEntry } from '../../types/runOutput';
import { formatDuration } from '../../utils/formatDuration';
import styles from './RunProfileCard.module.css';

interface RunHistoryDotsProps {
  history: RunHistoryEntry[];
  isCurrentlyRunning: boolean;
  expanded?: boolean;
}

const MAX_DOTS = 8;

function getDotClass(state: RunHistoryEntry['state']): string {
  switch (state) {
    case 'success':
      return styles.historyDotOk;
    case 'failed':
      return styles.historyDotErr;
    case 'stopped':
      return styles.historyDotStopped;
  }
}

export function RunHistoryDots({
  history,
  isCurrentlyRunning,
  expanded = false,
}: RunHistoryDotsProps) {
  if (history.length === 0 && !isCurrentlyRunning) return null;

  const visible = history.slice(-MAX_DOTS);
  const overflow = history.length - MAX_DOTS;

  return (
    <div className={styles.history} style={expanded ? { gap: 6 } : undefined}>
      {visible.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span className={`${styles.historyDot} ${getDotClass(entry.state)}`} />
          {expanded && (
            <span className={styles.historyDuration}>{formatDuration(entry.duration)}</span>
          )}
        </div>
      ))}
      {isCurrentlyRunning && <span className={`${styles.historyDot} ${styles.historyDotActive}`} />}
      {expanded && overflow > 0 && (
        <span className={styles.historyOverflow}>&#8627; {overflow} more runs</span>
      )}
    </div>
  );
}

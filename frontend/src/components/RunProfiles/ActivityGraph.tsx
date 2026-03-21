import { memo } from 'react';
import type { VisualState } from '../../types/runOutput';
import styles from './ActivityGraph.module.css';

const INTERVAL_MS = 500;

export function computeOutputRate(data: number[]): number {
  if (data.length === 0) return 0;
  const totalEvents = data.reduce((sum, v) => sum + v, 0);
  const totalSeconds = (data.length * INTERVAL_MS) / 1000;
  return Math.round(totalEvents / totalSeconds);
}

function getBarColor(visualState: VisualState): string {
  switch (visualState) {
    case 'running':
      return '#22c55e';
    case 'failed':
      return '#ef4444';
    case 'stopping':
      return '#f59e0b';
    case 'success':
      return 'rgba(34, 197, 94, 0.3)';
    default:
      return '#222';
  }
}

function getRateLabel(visualState: VisualState, rate: number): string {
  switch (visualState) {
    case 'running':
      return rate > 0 ? `~${rate} events/s` : 'quiet';
    case 'stopping':
      return rate > 0 ? `~${rate} events/s` : 'quiet';
    case 'failed':
    case 'success':
      return '';
    default:
      return '';
  }
}

interface ActivityGraphProps {
  data: number[];
  visualState: VisualState;
}

export const ActivityGraph = memo(function ActivityGraph({
  data,
  visualState,
}: ActivityGraphProps) {
  if (data.length === 0) return null;

  const rate = computeOutputRate(data);
  const rateLabel = getRateLabel(visualState, rate);
  const barColor = getBarColor(visualState);
  const maxVal = Math.max(...data, 1);

  return (
    <div className={styles.graph}>
      <div className={styles.labelRow}>
        <span className={styles.label}>Output Activity</span>
        {rateLabel && <span className={styles.rate}>{rateLabel}</span>}
      </div>
      <div className={styles.bars}>
        {data.map((value, i) => {
          const height = Math.max(2, (value / maxVal) * 28);
          return (
            <div
              key={i}
              className={styles.bar}
              style={{ height: `${height}px`, background: barColor }}
            />
          );
        })}
      </div>
    </div>
  );
});

import { memo } from 'react';
import type { VisualState } from '../../types/runOutput';

interface ActivityWaveformProps {
  data: number[];
  visualState: VisualState;
  expanded?: boolean;
}

function getBarColor(state: VisualState): string {
  switch (state) {
    case 'running': return '#22c55e';
    case 'stopping': return '#f59e0b';
    case 'failed': return '#ef4444';
    case 'success': return 'rgba(34,197,94,0.3)';
    default: return '#222';
  }
}

function ActivityWaveformInner({ data, visualState, expanded = false }: ActivityWaveformProps) {
  const barCount = expanded ? 24 : 12;
  const height = expanded ? 24 : 12;

  // Normalize data to target bar count
  const bars = data.length >= barCount
    ? data.slice(data.length - barCount)
    : [...new Array(barCount - data.length).fill(0), ...data];

  const maxVal = Math.max(...bars, 1);
  const barColor = getBarColor(visualState);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 1,
        height,
        width: expanded ? '100%' : 48,
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {bars.map((val, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            minWidth: 2,
            borderRadius: '1px 1px 0 0',
            height: `${Math.max((val / maxVal) * 100, 3)}%`,
            background: barColor,
            transition: 'height 0.15s ease',
          }}
        />
      ))}
    </div>
  );
}

export const ActivityWaveform = memo(ActivityWaveformInner);

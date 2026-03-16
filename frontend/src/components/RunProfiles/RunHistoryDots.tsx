import type { RunHistoryEntry } from '../../types/runOutput';
import { formatDuration } from '../../utils/formatDuration';

interface RunHistoryDotsProps {
  history: RunHistoryEntry[];
  isCurrentlyRunning: boolean;
  expanded?: boolean;
}

const MAX_DOTS = 8;

const PULSE_KEYFRAMES = `
@keyframes hdotPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
`;

function getDotColor(state: RunHistoryEntry['state']): string {
  switch (state) {
    case 'success': return 'rgba(34,197,94,0.4)';
    case 'failed': return 'rgba(239,68,68,0.4)';
    case 'stopped': return 'rgba(255,255,255,0.1)';
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
    <>
      <style>{PULSE_KEYFRAMES}</style>
      <div
        style={{
          display: 'flex',
          gap: expanded ? 6 : 2,
          alignItems: 'center',
          marginLeft: 'auto',
        }}
      >
        {visible.map((entry, i) => (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: 2 }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: getDotColor(entry.state),
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            {expanded && (
              <span
                style={{
                  fontSize: 8,
                  color: '#444',
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                }}
              >
                {formatDuration(entry.duration)}
              </span>
            )}
          </div>
        ))}
        {isCurrentlyRunning && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#22c55e',
              display: 'inline-block',
              flexShrink: 0,
              animation: 'hdotPulse 1.5s ease-in-out infinite',
            }}
          />
        )}
        {expanded && overflow > 0 && (
          <span style={{ fontSize: 8, color: '#444', marginLeft: 4 }}>
            &#8627; {overflow} more runs
          </span>
        )}
      </div>
    </>
  );
}

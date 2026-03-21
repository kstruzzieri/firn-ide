import { memo } from 'react';
import type { VisualState, RunHistoryEntry } from '../../types/runOutput';
import type { RunProfile } from '../../types/runProfile';
import styles from './StatusBadge.module.css';

export interface StatusBadgeInfo {
  text: string;
  className: string;
}

export function getStatusBadgeInfo(
  visualState: VisualState,
  _profile: RunProfile,
  runHistory: RunHistoryEntry[]
): StatusBadgeInfo {
  switch (visualState) {
    case 'running':
      return { text: 'RUNNING', className: 'running' };
    case 'stopping':
      return { text: 'STOPPING', className: 'stopping' };
    case 'failed':
      return { text: 'FAILED', className: 'failed' };
    case 'success':
      return { text: 'PASSED', className: 'passed' };
    case 'stopped':
      return { text: 'STOPPED', className: 'stopped' };
    case 'idle': {
      if (runHistory.length === 0) {
        return { text: 'READY', className: 'ready' };
      }
      const last = runHistory[runHistory.length - 1];
      if (last.state === 'success') return { text: 'PASSED', className: 'passed' };
      if (last.state === 'stopped') return { text: 'STOPPED', className: 'stopped' };
      return { text: 'FAILED', className: 'failed' };
    }
    default:
      return { text: 'IDLE', className: 'idle' };
  }
}

interface StatusBadgeProps {
  visualState: VisualState;
  profile: RunProfile;
  runHistory: RunHistoryEntry[];
}

export const StatusBadge = memo(function StatusBadge({
  visualState,
  profile,
  runHistory,
}: StatusBadgeProps) {
  const info = getStatusBadgeInfo(visualState, profile, runHistory);
  return <span className={`${styles.badge} ${styles[info.className] ?? ''}`}>{info.text}</span>;
});

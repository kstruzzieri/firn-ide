import type { RunHistoryEntry } from '../types/runOutput';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function estimateDuration(history: RunHistoryEntry[]): number | null {
  const successDurations = history.filter((h) => h.state === 'success').map((h) => h.duration);
  if (successDurations.length < 2) return null;
  return Math.round(median(successDurations));
}

/**
 * Estimate remaining time for a running profile based on past successful runs.
 * Returns milliseconds remaining, or null if insufficient data (need 2+ success runs).
 * Returns 0 if elapsed exceeds estimate (overrunning).
 */
export function estimateRemaining(history: RunHistoryEntry[], elapsed: number): number | null {
  const estimated = estimateDuration(history);
  if (estimated == null) return null;
  return Math.max(0, Math.round(estimated - elapsed));
}

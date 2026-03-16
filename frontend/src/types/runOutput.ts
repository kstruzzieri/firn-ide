/** Sentinel value for the "All Profiles" virtual tab in Timeline view */
export const ALL_PROFILES_ID = '__all__';

/** Max entries per profile before FIFO truncation */
export const MAX_OUTPUT_ENTRIES = 10_000;

/** Raw event payload from backend (chunk-oriented, may split/merge lines) */
export interface OutputChunk {
  profileId: string;
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp: number;
}

/** Stored entry (line-oriented, always one complete line per entry) */
export interface OutputEntry {
  stream: 'stdout' | 'stderr';
  text: string;
  timestamp: number;
}

export type RunState = 'idle' | 'running' | 'stopped' | 'failed' | 'success';

export interface RunHistoryEntry {
  state: 'success' | 'failed' | 'stopped';
  duration: number;  // milliseconds
  timestamp: number; // when run completed (UnixMilli)
}

export type VisualState = RunState | 'stopping';

export type RunOutputViewMode = 'merged' | 'lanes' | 'diff' | 'timeline';

export interface RunOutput {
  profileId: string;
  state: RunState;
  exitCode: number;
  runCount: number;
  entries: OutputEntry[];
  previousEntries: OutputEntry[];
}

export interface FoldedRegion {
  kind: 'fold';
  id: string;
  summary: string;
  lineCount: number;
  entries: OutputEntry[];
}

export type FoldedItem = OutputEntry | FoldedRegion;

export function isFoldedRegion(item: FoldedItem): item is FoldedRegion {
  return (item as FoldedRegion).kind === 'fold';
}

/** Sentinel value for the "All Profiles" virtual tab in Timeline view */
export const ALL_PROFILES_ID = '__all__';

/** Max entries per retained ordinary execution or compound step before FIFO truncation */
export const MAX_OUTPUT_ENTRIES = 10_000;

/** Raw event payload from backend (chunk-oriented, may split/merge lines) */
export interface OutputChunk {
  runInstanceId: string;
  profileId: string;
  parentRunInstanceId?: string;
  stepIdx: number;
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
  duration: number; // milliseconds
  timestamp: number; // when run completed (UnixMilli)
}

export type VisualState = RunState | 'stopping';

export type RunOutputViewMode = 'merged' | 'lanes' | 'diff' | 'timeline';

/** Payload of the run:status event (top-level runs and compound aggregates). */
export interface RunStatusEvent {
  runInstanceId: string;
  profileId: string;
  parentRunInstanceId?: string;
  stepIdx: number;
  state: RunState;
  exitCode: number;
  timestamp?: number;
}

export interface RunOutput {
  profileId: string;
  runInstanceId: string;
  workingDir?: string;
  state: RunState;
  exitCode: number;
  entries: OutputEntry[];
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

export type CompoundStepState =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'stopped';

export interface CompoundStep {
  idx: number;
  runInstanceId: string;
  profileId: string;
  name: string;
  state: CompoundStepState;
  exitCode: number;
  workingDir: string;
  durationMs: number;
  startedAt?: number;
  endedAt?: number;
  errorMessage?: string;
}

export interface CompoundRun {
  compoundId: string;
  runInstanceId: string;
  name: string;
  state: RunState;
  currentStep: number;
  etaMs?: number;
  steps: CompoundStep[];
  stepOutputs: Record<number, OutputEntry[]>;
  selectedStepIdx?: number;
  failedReference?: { stepIdx: number; path: string; line: number; column: number };
}

export interface CompoundRunEvent {
  runInstanceId: string;
  compoundId: string;
  name: string;
  state: RunState;
  currentStep: number;
  steps: CompoundStep[];
}

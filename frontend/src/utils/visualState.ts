import type { RunState, VisualState } from '../types/runOutput';

export function getVisualState(
  profileId: string,
  backendState: RunState | undefined,
  stoppingProfileIds: string[],
  restartingProfileIds: string[]
): VisualState {
  const state = backendState ?? 'idle';
  if (stoppingProfileIds.includes(profileId)) return 'stopping';
  if (restartingProfileIds.includes(profileId) && state !== 'running') return 'stopping';
  return state;
}

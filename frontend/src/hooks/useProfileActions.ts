import { useMemo } from 'react';
import type { RunProfile } from '../types/runProfile';
import { startProfile, stopProfile, restartProfile } from '../utils/profileActions';

export interface ProfileActions {
  start: () => void;
  stop: () => void;
  restart: () => void;
}

/** Component-friendly wrapper around the imperative profile-action core (spec §6). */
export function useProfileActions(profile: Pick<RunProfile, 'id' | 'name'>): ProfileActions {
  return useMemo(
    () => ({
      start: () => startProfile(profile.id, profile.name),
      stop: () => stopProfile(profile.id, profile.name),
      restart: () => restartProfile(profile.id, profile.name),
    }),
    [profile.id, profile.name]
  );
}

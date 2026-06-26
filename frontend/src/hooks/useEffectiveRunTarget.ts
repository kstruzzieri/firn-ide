import { useMemo } from 'react';
import { useIDEStore } from '../stores/ideStore';
import { resolveEffectiveRunTargetId } from '../utils/resolveEffectiveRunTarget';

/** The id of the profile the header button + Cmd+R act on (spec §5). */
export function useEffectiveRunTarget(): string | null {
  const selectedProfileId = useIDEStore((s) => s.selectedProfileId);
  const profiles = useIDEStore((s) => s.runProfiles);
  const profileState = useIDEStore((s) => s.runProfileState);
  const hiddenProfileIds = useIDEStore((s) => s.hiddenProfileIds);
  const activeWorkspaceId = useIDEStore((s) => s.activeWorkspaceId);

  return useMemo(
    () =>
      resolveEffectiveRunTargetId({
        selectedProfileId,
        profiles,
        profileState,
        hiddenProfileIds,
        activeWorkspaceId,
      }),
    [selectedProfileId, profiles, profileState, hiddenProfileIds, activeWorkspaceId]
  );
}

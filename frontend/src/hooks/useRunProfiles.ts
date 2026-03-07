import { useEffect } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { LoadRunProfiles, GetAllRunProfiles } from '../../wailsjs/go/main/App';
import { useIDEStore } from '../stores/ideStore';
import type { RunProfile } from '../types/runProfile';

/**
 * Hook to load and reactively update run profiles for a workspace.
 *
 * @param workspacePath - The workspace path. Pass null/undefined to skip loading.
 */
export function useRunProfilesLoader(workspacePath: string | null | undefined): void {
  useEffect(() => {
    if (!workspacePath) {
      return;
    }

    const { setProfilesLoading, setRunProfiles, setProfilesError } = useIDEStore.getState();

    setProfilesLoading(true);

    LoadRunProfiles(workspacePath)
      .then(() => GetAllRunProfiles())
      .then((profiles: RunProfile[]) => {
        setRunProfiles(profiles);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setProfilesError(message);
      });

    // Subscribe to reactive profile updates from file watcher
    const cleanup = EventsOn('runprofiles:changed', (profiles: unknown) => {
      if (Array.isArray(profiles)) {
        setRunProfiles(profiles as RunProfile[]);
      }
    });

    return () => {
      cleanup();
    };
  }, [workspacePath]);
}

import { useEffect } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { LoadRunProfiles, GetRunProfilesSnapshot } from '../../wailsjs/go/main/App';
import type { runprofile } from '../../wailsjs/go/models';
import { useIDEStore } from '../stores/ideStore';
import type {
  ProfileSource,
  ProfileTag,
  ProfileType,
  RunProfile,
  RunProfileUIState,
} from '../types/runProfile';

const VALID_PROFILE_TYPES: ReadonlySet<string> = new Set(['single', 'compound']);
const VALID_PROFILE_SOURCES: ReadonlySet<string> = new Set(['user', 'detected']);
const VALID_PROFILE_TAGS: ReadonlySet<string> = new Set(['build', 'test', 'dev', 'deploy', 'lint']);

function asProfileType(value: unknown): ProfileType {
  return VALID_PROFILE_TYPES.has(value as string) ? (value as ProfileType) : 'single';
}

function asProfileSource(value: unknown): ProfileSource {
  return VALID_PROFILE_SOURCES.has(value as string) ? (value as ProfileSource) : 'detected';
}

function asTags(value: unknown): ProfileTag[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tags = value.filter(
    (tag): tag is ProfileTag => typeof tag === 'string' && VALID_PROFILE_TAGS.has(tag)
  );
  return tags.length > 0 ? tags : undefined;
}

function normalizeRunProfiles(rawProfiles: unknown): RunProfile[] {
  if (!Array.isArray(rawProfiles)) {
    return [];
  }

  const normalized: RunProfile[] = [];

  for (const rawProfile of rawProfiles) {
    if (!rawProfile || typeof rawProfile !== 'object') {
      continue;
    }

    const profile = rawProfile as runprofile.RunProfile;

    if (!profile.id || !profile.name) {
      continue;
    }

    normalized.push({
      id: profile.id,
      name: profile.name,
      type: asProfileType(profile.type),
      source: asProfileSource(profile.source),
      command: profile.command,
      workingDir: profile.workingDir,
      env: profile.env,
      envFile: profile.envFile,
      envVariants: profile.envVariants,
      activeVariant: profile.activeVariant,
      tags: asTags(profile.tags),
      steps: profile.steps,
      detectedFrom: profile.detectedFrom,
      order: profile.order,
      workspaceId: profile.workspaceId,
      workspaceName: profile.workspaceName,
      workspaceRelDir: profile.workspaceRelDir,
    });
  }

  return normalized;
}

export function normalizeProfileState(raw: unknown): Record<string, RunProfileUIState> {
  const out: Record<string, RunProfileUIState> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    out[id] = {
      adopted: v.adopted === true,
      lastRunAt: typeof v.lastRunAt === 'number' ? v.lastRunAt : 0,
    };
  }
  return out;
}

function normalizeSnapshot(raw: unknown): {
  profiles: RunProfile[];
  profileState: Record<string, RunProfileUIState>;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    profiles: normalizeRunProfiles(obj.profiles),
    profileState: normalizeProfileState(obj.profileState),
  };
}

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

    useIDEStore.getState().resetWorkspaceRunState();

    let cancelled = false;
    const { setProfilesLoading, setRunProfilesSnapshot, setProfilesError } = useIDEStore.getState();

    setProfilesLoading(true);

    LoadRunProfiles(workspacePath)
      .then(() => GetRunProfilesSnapshot())
      .then((snap: unknown) => {
        if (!cancelled) {
          const { profiles, profileState } = normalizeSnapshot(snap);
          setRunProfilesSnapshot(profiles, profileState);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setProfilesError(message);
        }
      });

    // Subscribe to reactive profile updates from the backend file watcher.
    // These events are emitted by the StartWatching callback in app.go when
    // a config file (package.json, go.mod, etc.) changes. The watcher must
    // be started separately (e.g., via useFileWatcher) for events to fire.
    const cleanup = EventsOn('runprofiles:changed', (snap: unknown) => {
      if (!cancelled) {
        const { profiles, profileState } = normalizeSnapshot(snap);
        setRunProfilesSnapshot(profiles, profileState);
      }
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [workspacePath]);
}

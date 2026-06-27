import type { RunProfile, RunProfileUIState } from '../types/runProfile';

export interface ResolveEffectiveRunTargetArgs {
  selectedProfileId: string | null;
  profiles: RunProfile[];
  profileState: Record<string, RunProfileUIState>;
  hiddenProfileIds: string[];
  activeWorkspaceId: string;
}

const lastRunAt = (state: Record<string, RunProfileUIState>, id: string): number =>
  state[id]?.lastRunAt ?? 0;

// Pick a default target from a candidate list, in preference order (spec §5.2–5.4):
//   1. most-recently-run adopted   2. most-recently-run any source
//   3. first pinned (user)         4. first detected
function pickDefault(
  list: RunProfile[],
  state: Record<string, RunProfileUIState>
): RunProfile | null {
  if (list.length === 0) return null;

  const ran = (p: RunProfile) => lastRunAt(state, p.id) > 0;
  const byRecencyDesc = (a: RunProfile, b: RunProfile) =>
    lastRunAt(state, b.id) - lastRunAt(state, a.id);

  const adoptedRan = list.filter((p) => state[p.id]?.adopted && ran(p)).sort(byRecencyDesc);
  if (adoptedRan.length) return adoptedRan[0];

  const anyRan = list.filter(ran).sort(byRecencyDesc);
  if (anyRan.length) return anyRan[0];

  const pinned = list.find((p) => p.source === 'user');
  if (pinned) return pinned;

  const detected = list.find((p) => p.source === 'detected');
  return detected ?? null;
}

export function resolveEffectiveRunTargetId(args: ResolveEffectiveRunTargetArgs): string | null {
  const { selectedProfileId, profiles, profileState, hiddenProfileIds, activeWorkspaceId } = args;
  const hidden = new Set(hiddenProfileIds);
  const visible = profiles.filter((p) => !hidden.has(p.id));

  // 1. Explicit selection wins when it still exists and is visible.
  if (selectedProfileId && visible.some((p) => p.id === selectedProfileId)) {
    return selectedProfileId;
  }

  // 2–4. Prefer the active workspace, then fall back across all workspaces.
  const inActive = visible.filter((p) => (p.workspaceId ?? '') === activeWorkspaceId);
  return (pickDefault(inActive, profileState) ?? pickDefault(visible, profileState))?.id ?? null;
}

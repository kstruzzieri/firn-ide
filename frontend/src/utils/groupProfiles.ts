import type { RunProfile, RunProfileUIState } from '../types/runProfile';

export type ProfileSection = 'activated' | 'pinned' | 'recent' | 'detected';

export const SECTION_ORDER: ProfileSection[] = ['activated', 'pinned', 'recent', 'detected'];

export const SECTION_LABEL: Record<ProfileSection, string> = {
  activated: 'Working Set',
  pinned: 'Pinned',
  recent: 'Recent',
  detected: 'Detected',
};

const RECENT_CAP = 5;

export interface SectionGroup {
  key: ProfileSection;
  profiles: RunProfile[];
}

export interface WorkspaceGroup {
  workspaceId: string;
  workspaceName: string;
  sections: SectionGroup[];
}

export interface GroupedProfiles {
  sections: SectionGroup[];
  workspaceGroups: WorkspaceGroup[];
  freshestRunId: string | null;
}

export interface GroupOptions {
  viewMode: 'workspace' | 'project';
  activeWorkspaceId: string;
}

const lastRunAt = (state: Record<string, RunProfileUIState>, id: string): number =>
  state[id]?.lastRunAt ?? 0;

export function groupProfiles(
  profiles: RunProfile[],
  state: Record<string, RunProfileUIState>,
  opts: GroupOptions
): GroupedProfiles {
  const scoped =
    opts.viewMode === 'workspace'
      ? profiles.filter((p) => (p.workspaceId ?? '') === opts.activeWorkspaceId)
      : profiles;

  const recentEligible = scoped
    .filter((p) => p.source === 'detected' && !state[p.id]?.adopted && lastRunAt(state, p.id) > 0)
    .sort((a, b) => lastRunAt(state, b.id) - lastRunAt(state, a.id));
  const recentIds = new Set(recentEligible.slice(0, RECENT_CAP).map((p) => p.id));

  const sectionFor = (p: RunProfile): ProfileSection => {
    if (p.source === 'detected' && state[p.id]?.adopted) return 'activated';
    if (p.source === 'user') return 'pinned';
    if (recentIds.has(p.id)) return 'recent';
    return 'detected';
  };

  const buildSections = (list: RunProfile[]): SectionGroup[] => {
    const byKey: Record<ProfileSection, RunProfile[]> = {
      activated: [],
      pinned: [],
      recent: [],
      detected: [],
    };
    for (const p of list) byKey[sectionFor(p)].push(p);
    byKey.recent.sort((a, b) => lastRunAt(state, b.id) - lastRunAt(state, a.id));
    return SECTION_ORDER.map((key) => ({ key, profiles: byKey[key] })).filter(
      (g) => g.profiles.length > 0
    );
  };

  let freshestRunId: string | null = null;
  let best = 0;
  for (const p of scoped) {
    const ts = lastRunAt(state, p.id);
    if (ts > best) {
      best = ts;
      freshestRunId = p.id;
    }
  }

  const order: string[] = [];
  const byWs = new Map<string, RunProfile[]>();
  for (const p of scoped) {
    const ws = p.workspaceId ?? '';
    if (!byWs.has(ws)) {
      byWs.set(ws, []);
      order.push(ws);
    }
    byWs.get(ws)!.push(p);
  }
  const workspaceGroups: WorkspaceGroup[] = order.map((ws) => ({
    workspaceId: ws,
    workspaceName: byWs.get(ws)![0].workspaceName ?? ws,
    sections: buildSections(byWs.get(ws)!),
  }));

  return { sections: buildSections(scoped), workspaceGroups, freshestRunId };
}

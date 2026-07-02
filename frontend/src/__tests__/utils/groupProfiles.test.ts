import {
  groupProfiles,
  isJustRan,
  JUST_RAN_WINDOW_MS,
  type ProfileSection,
} from '../../utils/groupProfiles';
import type { RunProfile } from '../../types/runProfile';

const p = (over: Partial<RunProfile>): RunProfile => ({
  id: over.id ?? 'x',
  name: over.name ?? 'P',
  type: 'single',
  source: over.source ?? 'detected',
  workspaceId: over.workspaceId ?? 'frontend',
  workspaceName: over.workspaceName ?? 'Frontend',
  ...over,
});

test('cascade: adopted detected→activated; user→pinned; recent-run detected→recent; rest→detected', () => {
  const profiles = [
    p({ id: 'adopted', source: 'detected' }),
    p({ id: 'saved', source: 'user' }),
    p({ id: 'ran', source: 'detected' }),
    p({ id: 'plain', source: 'detected' }),
  ];
  const state = { adopted: { adopted: true }, ran: { lastRunAt: 1000 } };
  const groups = groupProfiles(profiles, state, {
    viewMode: 'workspace',
    activeWorkspaceId: 'frontend',
  });
  const section = (id: string): ProfileSection | undefined =>
    groups.sections.find((s) => s.profiles.some((pr) => pr.id === id))?.key;
  expect(section('adopted')).toBe('activated');
  expect(section('saved')).toBe('pinned');
  expect(section('ran')).toBe('recent');
  expect(section('plain')).toBe('detected');
});

test('user profile that ran stays pinned, not recent', () => {
  const profiles = [p({ id: 'saved', source: 'user' })];
  const groups = groupProfiles(
    profiles,
    { saved: { lastRunAt: 9 } },
    { viewMode: 'workspace', activeWorkspaceId: 'frontend' }
  );
  expect(groups.sections.find((s) => s.key === 'recent')?.profiles ?? []).toHaveLength(0);
  expect(groups.sections.find((s) => s.key === 'pinned')?.profiles).toHaveLength(1);
});

test('RECENT caps at 5 most recent by lastRunAt', () => {
  const profiles = Array.from({ length: 7 }, (_, i) => p({ id: `r${i}`, source: 'detected' }));
  const state: Record<string, { lastRunAt: number }> = {};
  profiles.forEach((pr, i) => (state[pr.id] = { lastRunAt: i + 1 }));
  const groups = groupProfiles(profiles, state, {
    viewMode: 'workspace',
    activeWorkspaceId: 'frontend',
  });
  const recent = groups.sections.find((s) => s.key === 'recent')!.profiles;
  expect(recent).toHaveLength(5);
  expect(recent.map((r) => r.id)).toEqual(['r6', 'r5', 'r4', 'r3', 'r2']);
});

test('freshestRunId is the single highest lastRunAt in view scope', () => {
  const profiles = [p({ id: 'a' }), p({ id: 'b' })];
  const groups = groupProfiles(
    profiles,
    { a: { lastRunAt: 10 }, b: { lastRunAt: 20 } },
    { viewMode: 'workspace', activeWorkspaceId: 'frontend' }
  );
  expect(groups.freshestRunId).toBe('b');
});

test('workspace view filters to the active workspace', () => {
  const profiles = [p({ id: 'a', workspaceId: 'frontend' }), p({ id: 'b', workspaceId: 'go' })];
  const groups = groupProfiles(
    profiles,
    {},
    { viewMode: 'workspace', activeWorkspaceId: 'frontend' }
  );
  const ids = groups.sections.flatMap((s) => s.profiles.map((pr) => pr.id));
  expect(ids).toEqual(['a']);
});

test('project view groups by workspace, sections nested', () => {
  const profiles = [
    p({ id: 'a', workspaceId: 'frontend', workspaceName: 'Frontend', source: 'user' }),
    p({ id: 'b', workspaceId: 'go', workspaceName: 'Go' }),
  ];
  const groups = groupProfiles(profiles, {}, { viewMode: 'project', activeWorkspaceId: 'project' });
  expect(groups.workspaceGroups.map((g) => g.workspaceId)).toEqual(['frontend', 'go']);
  expect(groups.workspaceGroups[0].sections.find((s) => s.key === 'pinned')?.profiles).toHaveLength(
    1
  );
});

test('project view caps RECENT independently per workspace group', () => {
  const mk = (ws: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      p({ id: `${ws}-r${i}`, workspaceId: ws, workspaceName: ws, source: 'detected' })
    );
  const profiles = [...mk('frontend', 6), ...mk('go', 6)];
  const state: Record<string, { lastRunAt: number }> = {};
  profiles.forEach((pr, i) => (state[pr.id] = { lastRunAt: i + 1 }));
  const groups = groupProfiles(profiles, state, {
    viewMode: 'project',
    activeWorkspaceId: 'project',
  });
  const recentLen = (ws: string) =>
    groups.workspaceGroups
      .find((g) => g.workspaceId === ws)!
      .sections.find((s) => s.key === 'recent')?.profiles.length ?? 0;
  expect(recentLen('frontend')).toBe(5);
  expect(recentLen('go')).toBe(5);
});

test('empty input yields empty groups and null freshest', () => {
  const groups = groupProfiles([], {}, { viewMode: 'workspace', activeWorkspaceId: 'frontend' });
  expect(groups.sections).toEqual([]);
  expect(groups.workspaceGroups).toEqual([]);
  expect(groups.freshestRunId).toBeNull();
});

test('freshestRunId is null when nothing has run', () => {
  const groups = groupProfiles(
    [p({ id: 'a' })],
    {},
    { viewMode: 'workspace', activeWorkspaceId: 'frontend' }
  );
  expect(groups.freshestRunId).toBeNull();
});

describe('isJustRan recency window', () => {
  const now = 1_700_000_000_000;

  test('run at exactly now is within the window', () => {
    expect(isJustRan(now, now)).toBe(true);
  });

  test('run older than the window is not just-ran', () => {
    expect(isJustRan(now - 6 * 60 * 1000, now)).toBe(false);
  });

  test('run at the window boundary is still just-ran', () => {
    expect(isJustRan(now - JUST_RAN_WINDOW_MS, now)).toBe(true);
  });

  test('lastRunAt of 0 (never ran) is not just-ran', () => {
    expect(isJustRan(0, now)).toBe(false);
  });

  test('undefined lastRunAt is not just-ran', () => {
    expect(isJustRan(undefined, now)).toBe(false);
  });
});

test('adopted user profile classifies as pinned, not activated', () => {
  const groups = groupProfiles(
    [p({ id: 'a', source: 'user' })],
    { a: { adopted: true } },
    { viewMode: 'workspace', activeWorkspaceId: 'frontend' }
  );
  expect(groups.sections.find((s) => s.key === 'pinned')?.profiles).toHaveLength(1);
  expect(groups.sections.find((s) => s.key === 'activated')?.profiles ?? []).toHaveLength(0);
});

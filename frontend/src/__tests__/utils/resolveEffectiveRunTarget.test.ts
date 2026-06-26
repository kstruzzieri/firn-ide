import { resolveEffectiveRunTargetId } from '../../utils/resolveEffectiveRunTarget';
import type { RunProfile, RunProfileUIState } from '../../types/runProfile';

function p(id: string, over: Partial<RunProfile> = {}): RunProfile {
  return { id, name: id, type: 'single', source: 'detected', ...over };
}
const base = {
  selectedProfileId: null as string | null,
  hiddenProfileIds: [] as string[],
  activeWorkspaceId: 'ws1',
};

test('explicit selection wins when visible', () => {
  const profiles = [p('a'), p('b')];
  expect(
    resolveEffectiveRunTargetId({ ...base, selectedProfileId: 'b', profiles, profileState: {} })
  ).toBe('b');
});

test('hidden explicit selection falls through to default', () => {
  const profiles = [p('a', { source: 'user' }), p('b')];
  const r = resolveEffectiveRunTargetId({
    ...base,
    selectedProfileId: 'b',
    hiddenProfileIds: ['b'],
    profiles,
    profileState: {},
  });
  expect(r).toBe('a'); // first pinned (user) profile
});

test('default = most-recently-run adopted', () => {
  const profiles = [p('a', { workspaceId: 'ws1' }), p('b', { workspaceId: 'ws1' })];
  const state: Record<string, RunProfileUIState> = {
    a: { adopted: true, lastRunAt: 10 },
    b: { adopted: true, lastRunAt: 20 },
  };
  expect(resolveEffectiveRunTargetId({ ...base, profiles, profileState: state })).toBe('b');
});

test('falls to most-recent-run of any source when no adopted', () => {
  const profiles = [p('a', { workspaceId: 'ws1' }), p('b', { workspaceId: 'ws1' })];
  const state = { a: { lastRunAt: 5 }, b: { lastRunAt: 9 } };
  expect(resolveEffectiveRunTargetId({ ...base, profiles, profileState: state })).toBe('b');
});

test('falls to first pinned then first detected when nothing ran', () => {
  const profiles = [
    p('d1', { workspaceId: 'ws1' }),
    p('u1', { source: 'user', workspaceId: 'ws1' }),
  ];
  expect(resolveEffectiveRunTargetId({ ...base, profiles, profileState: {} })).toBe('u1');
});

test('prefers active workspace before falling back globally', () => {
  const profiles = [
    p('other', { workspaceId: 'ws2', source: 'user' }),
    p('mine', { workspaceId: 'ws1', source: 'detected' }),
  ];
  expect(resolveEffectiveRunTargetId({ ...base, profiles, profileState: {} })).toBe('mine');
});

test('returns null when no visible profiles', () => {
  expect(resolveEffectiveRunTargetId({ ...base, profiles: [], profileState: {} })).toBeNull();
});

import {
  seedName,
  envRowsToMap,
  mapToEnvRows,
  duplicateEnvKeys,
  relativizeWorkingDir,
  buildProfileFromForm,
  type EnvRow,
} from '../../utils/runProfileForm';
import type { RunProfile } from '../../types/runProfile';

const detected: RunProfile = {
  id: 'detected:frontend:dev',
  name: 'npm run dev',
  type: 'single',
  source: 'detected',
  command: 'npm run dev',
  workspaceName: 'Frontend',
  workspaceRelDir: 'frontend',
  tags: ['dev'],
};

describe('seedName', () => {
  it('qualifies with workspace when the profile has a distinct workspace', () => {
    expect(seedName(detected)).toBe('Frontend — npm run dev');
  });
  it('falls back to the bare name for repo-root profiles', () => {
    expect(seedName({ ...detected, workspaceName: 'Project', workspaceRelDir: '' })).toBe(
      'npm run dev'
    );
  });
  it('falls back when workspaceName is empty', () => {
    expect(seedName({ ...detected, workspaceName: '' })).toBe('npm run dev');
  });
});

describe('env map round-trip', () => {
  it('drops fully-empty rows and rows with empty keys, trims keys', () => {
    const rows: EnvRow[] = [
      { key: ' NODE_ENV ', value: 'development' },
      { key: '', value: '' },
      { key: '', value: 'orphan' },
      { key: 'PORT', value: '' },
    ];
    expect(envRowsToMap(rows)).toEqual({ NODE_ENV: 'development', PORT: '' });
  });
  it('returns undefined when no usable rows', () => {
    expect(envRowsToMap([{ key: '', value: '' }])).toBeUndefined();
  });
  it('mapToEnvRows inverts a map', () => {
    expect(mapToEnvRows({ A: '1', B: '2' })).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
    expect(mapToEnvRows(undefined)).toEqual([]);
  });
  it('flags duplicate non-empty keys after trim', () => {
    expect(
      duplicateEnvKeys([
        { key: 'A', value: '1' },
        { key: ' A ', value: '2' },
      ])
    ).toEqual(['A']);
    expect(
      duplicateEnvKeys([
        { key: 'A', value: '1' },
        { key: 'B', value: '2' },
      ])
    ).toEqual([]);
  });
});

describe('relativizeWorkingDir', () => {
  it('returns empty string when the pick is the repo root', () => {
    expect(relativizeWorkingDir('/repo', '/repo')).toEqual({ ok: true, relDir: '' });
  });
  it('relativizes a child path', () => {
    expect(relativizeWorkingDir('/repo/frontend/sub', '/repo')).toEqual({
      ok: true,
      relDir: 'frontend/sub',
    });
  });
  it('rejects a path outside the repo root', () => {
    expect(relativizeWorkingDir('/elsewhere/x', '/repo')).toEqual({ ok: false });
  });
  it('normalizes Windows separators and trailing slashes', () => {
    expect(relativizeWorkingDir('C:\\repo\\frontend', 'C:\\repo\\')).toEqual({
      ok: true,
      relDir: 'frontend',
    });
  });
});

describe('buildProfileFromForm', () => {
  const values = {
    name: '  Dev  ',
    command: '  npm run dev  ',
    workingDir: ' frontend ',
    envRows: [{ key: 'A', value: '1' }] as EnvRow[],
    envFile: ' .env ',
    tags: ['dev'] as RunProfile['tags'],
    workspaceId: 'frontend',
  };

  it('mints a fresh id and trims fields on create', () => {
    const p = buildProfileFromForm(values, { mode: 'create' }, () => 'fixed-uuid');
    expect(p.id).toBe('fixed-uuid');
    expect(p).toMatchObject({
      name: 'Dev',
      command: 'npm run dev',
      type: 'single',
      source: 'user',
      workingDir: 'frontend',
      env: { A: '1' },
      envFile: '.env',
      tags: ['dev'],
      workspaceId: 'frontend',
    });
  });

  it('reuses the profile id and carries variants/order on edit', () => {
    const existing: RunProfile = {
      ...detected,
      id: 'detected:frontend:dev',
      envVariants: [{ name: 'dev', envFile: '.env.dev' }],
      activeVariant: 'dev',
      order: 7,
    };
    const p = buildProfileFromForm(
      values,
      { mode: 'edit', profile: existing },
      () => 'should-not-be-used'
    );
    expect(p.id).toBe('detected:frontend:dev');
    expect(p.envVariants).toEqual([{ name: 'dev', envFile: '.env.dev' }]);
    expect(p.activeVariant).toBe('dev');
    expect(p.order).toBe(7);
  });

  it('omits empty optional fields', () => {
    const p = buildProfileFromForm(
      { ...values, workingDir: '   ', envRows: [], envFile: '', tags: [] },
      { mode: 'create' },
      () => 'x'
    );
    expect(p.workingDir).toBeUndefined();
    expect(p.env).toBeUndefined();
    expect(p.envFile).toBeUndefined();
    expect(p.tags).toBeUndefined();
  });
});

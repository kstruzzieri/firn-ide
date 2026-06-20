import { relativePathFromRoot } from '../../utils/workspaceRegions';

describe('relativePathFromRoot', () => {
  const root = '/Users/me/repo';

  it('returns "" for the repo root itself', () => {
    expect(relativePathFromRoot(root, root)).toBe('');
  });

  it('returns the forward-slash relative path for a nested file', () => {
    expect(relativePathFromRoot('/Users/me/repo/frontend/src/App.tsx', root)).toBe(
      'frontend/src/App.tsx'
    );
  });

  it('tolerates a trailing slash on the root', () => {
    expect(relativePathFromRoot('/Users/me/repo/go.mod', '/Users/me/repo/')).toBe('go.mod');
  });

  it('returns null for a path outside the root', () => {
    expect(relativePathFromRoot('/Users/me/other/x.ts', root)).toBeNull();
  });

  it('does not treat a sibling prefix as inside the root', () => {
    expect(relativePathFromRoot('/Users/me/repo-2/x.ts', root)).toBeNull();
  });

  it('normalizes Windows backslashes and drive-letter case', () => {
    expect(relativePathFromRoot('C:\\Repo\\frontend\\App.tsx', 'c:/repo')).toBe('frontend/App.tsx');
  });

  it('returns null for empty inputs', () => {
    expect(relativePathFromRoot('', root)).toBeNull();
    expect(relativePathFromRoot(root, '')).toBeNull();
  });
});

import { createRegionAccentResolver } from '../../utils/workspaceRegions';
import type { workspace } from '../../../wailsjs/go/models';
import type { FileEntry } from '../../stores/ideStore';

function ws(partial: Partial<workspace.WorkspaceDef>): workspace.WorkspaceDef {
  return {
    id: '',
    name: '',
    relDir: '',
    type: '',
    accent: '',
    ...partial,
  } as workspace.WorkspaceDef;
}
function entry(path: string, isDir = false, name?: string): FileEntry {
  return { path, isDir, name: name ?? path.split('/').pop()! } as FileEntry;
}

describe('createRegionAccentResolver', () => {
  const root = '/Users/me/repo';
  const workspaces = [
    ws({ id: 'project', relDir: '', accent: 'project' }),
    ws({ id: 'frontend', relDir: 'frontend', accent: 'blue' }),
    ws({ id: 'backend', relDir: 'backend', accent: 'cyan' }),
    ws({ id: 'backend/api', relDir: 'backend/api', accent: 'green' }),
  ];

  it('tints a workspace folder and its descendants with the workspace accent', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    expect(resolve(entry('/Users/me/repo/frontend', true))).toBe('blue');
    expect(resolve(entry('/Users/me/repo/frontend/src/App.tsx'))).toBe('blue');
  });

  it('prefers the longest matching relDir for nested workspaces', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    expect(resolve(entry('/Users/me/repo/backend/api/main.go'))).toBe('green');
    expect(resolve(entry('/Users/me/repo/backend/db/x.go'))).toBe('cyan');
  });

  it('does NOT match a sibling whose name shares a prefix', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    // "backend/apiary" must not match "backend/api"
    expect(resolve(entry('/Users/me/repo/backend/apiary/x.go'))).toBe('cyan');
  });

  it('skips region tint for root workspaces (relDir === "")', () => {
    const resolve = createRegionAccentResolver(root, [
      ws({ id: 'project', relDir: '', accent: 'project' }),
      ws({ id: 'root:go', relDir: '', accent: 'cyan' }),
    ]);
    expect(resolve(entry('/Users/me/repo/main.go'))).toBeNull();
  });

  it('tints loose root files by file-type association', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    expect(resolve(entry('/Users/me/repo/docker-compose.yml'))).toBe('purple');
    expect(resolve(entry('/Users/me/repo/Dockerfile'))).toBe('purple');
    expect(resolve(entry('/Users/me/repo/main.tf'))).toBe('purple');
  });

  it('does NOT tint a nested .tf outside any workspace', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    expect(resolve(entry('/Users/me/repo/scripts/main.tf'))).toBeNull();
  });

  it('does NOT tint an untyped loose root file', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    expect(resolve(entry('/Users/me/repo/README.md'))).toBeNull();
  });

  it('returns null for paths outside the repo root', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    expect(resolve(entry('/Users/me/other/App.tsx'))).toBeNull();
  });
});

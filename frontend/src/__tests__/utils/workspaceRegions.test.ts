import {
  treeLoadLevels,
  createWorkspacePathResolver,
  getInfraFileAccent,
  pathUnderRoot,
  relativePathFromRoot,
} from '../../utils/workspaceRegions';

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

  it.each([
    ['C:\\src\\a.ts', 'src/a.ts'],
    ['c:\\src\\a.ts', 'src/a.ts'],
    ['c:/', ''],
    ['C:/', ''],
  ])('resolves %s under the drive root C:\\ (#447)', (absPath, expected) => {
    expect(relativePathFromRoot(absPath, 'C:\\')).toBe(expected);
  });

  it.each([
    ['C:\\ws\\a.ts', 'C:\\ws', 'a.ts'],
    ['\\\\server\\share\\src\\a.ts', '\\\\server\\share\\', 'src/a.ts'],
    ['//server/share/src/a.ts', '\\\\server\\share', 'src/a.ts'],
    // İ lowercases to two UTF-16 units, so the comparison form is longer.
    ['C:\\ws\\İ\\a.ts', 'C:\\ws', 'İ/a.ts'],
    ['C:\\İ\\a.ts', 'C:\\İ', 'a.ts'],
    ['/C:/ws/src/a.ts', 'C:\\ws', 'src/a.ts'],
    // Repeated separators count as one; a UNC prefix keeps its two.
    ['C:\\ws\\\\a.ts', 'C:\\ws', 'a.ts'],
    ['C:\\\\src', 'C:\\', 'src'],
    ['\\\\server\\share\\\\x', '\\\\server\\share', 'x'],
  ])('keeps the Windows reading of %s under %s', (absPath, windowsRoot, expected) => {
    expect(relativePathFromRoot(absPath, windowsRoot)).toBe(expected);
  });

  it.each([
    ['/Users/me/ws/a\\b/readme.txt', '/Users/me/ws', 'a\\b/readme.txt'],
    ['/Users/me/ws/a\\b', '/Users/me/ws', 'a\\b'],
    ['/Users/me/a/b/readme.txt', '/Users/me/a\\b', null],
    ['/Users/me/a\\b/src/x.ts', '/Users/me/a\\b', 'src/x.ts'],
    ['/Users/me/ws/src/x.ts', '/Users/me/ws', 'src/x.ts'],
    ['/Users/me/ws//src/x.ts', '/Users/me/ws', 'src/x.ts'],
  ])(
    'reads %s under the POSIX root %s with backslashes as name characters (#447)',
    (absPath, posixRoot, expected) => {
      expect(relativePathFromRoot(absPath, posixRoot)).toBe(expected);
    }
  );
});

describe('pathUnderRoot', () => {
  it.each([
    ['/r', 'a/b', '/r/a/b'],
    ['/r/', 'a', '/r/a'],
    ['/', 'a', '/a'],
    ['/Users/me/a\\b', 'src/x', '/Users/me/a\\b/src/x'],
    ['C:\\', 'src/a', 'C:\\src\\a'],
    ['C:\\ws\\', 'src', 'C:\\ws\\src'],
    ['C:/ws', 'src/a', 'C:/ws/src/a'],
    ['\\\\server\\share\\', 'src', '\\\\server\\share\\src'],
    ['C:\\', '', 'C:\\'],
  ])('spells %s + %s in the root syntax as %s', (root, relPath, expected) => {
    expect(pathUnderRoot(root, relPath)).toBe(expected);
  });
});

import { createRegionAccentResolver } from '../../utils/workspaceRegions';
import type { workspace } from '../../wails/bindings';
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

function infraFileAccent(path: string, isDir = false) {
  return getInfraFileAccent(entry(path, isDir));
}

describe('getInfraFileAccent', () => {
  it.each([
    ['Dockerfile', 'docker'],
    ['docker-compose.yml', 'docker'],
    ['docker-compose.yaml', 'docker'],
    ['compose.yml', 'docker'],
    ['compose.yaml', 'docker'],
    ['.dockerignore', 'docker'],
    ['main.tf', 'terraform'],
    ['production.tfvars', 'terraform'],
  ] as const)('matches %s as %s', (name, accent) => {
    expect(infraFileAccent(`/Users/me/repo/${name}`)).toBe(accent);
  });

  it('matches files at any tree depth', () => {
    expect(infraFileAccent('/Users/me/repo/services/api/Dockerfile')).toBe('docker');
    expect(infraFileAccent('/Users/me/repo/infra/live/main.tf')).toBe('terraform');
  });

  it.each([
    'Dockerfile.dev',
    'dockerfile',
    'docker-compose.xml',
    'docker-compose.YML',
    'compose.xml',
    'compose.yaml.bak',
    'Compose.yaml',
    '.Dockerignore',
    '.dockerignore.bak',
    'main.tf.json',
    'main.TF',
    'main.TFVARS',
    'main.tfvars.json',
    '.terraform.lock.hcl',
  ])('leaves near-miss file %s neutral', (name) => {
    expect(infraFileAccent(`/Users/me/repo/${name}`)).toBeNull();
  });

  it.each(['Dockerfile', 'main.tf'])('leaves matching directory %s neutral', (name) => {
    expect(infraFileAccent(`/Users/me/repo/${name}`, true)).toBeNull();
  });
});

describe('createWorkspacePathResolver', () => {
  const root = '/Users/me/repo';
  const workspaces = [
    ws({ id: 'project', relDir: '', accent: 'project' }),
    ws({ id: 'root:go', relDir: '', accent: 'terraform' }),
    ws({ id: 'backend', relDir: 'backend', accent: 'go' }),
    ws({ id: 'backend/api', relDir: 'backend/api', accent: 'python' }),
  ];

  it('uses the root workspace for files outside nested workspace regions', () => {
    const resolve = createWorkspacePathResolver(root, workspaces);
    expect(resolve('/Users/me/repo/main.go')?.id).toBe('root:go');
  });

  it('prefers the longest matching workspace path', () => {
    const resolve = createWorkspacePathResolver(root, workspaces);
    expect(resolve('/Users/me/repo/backend/api/main.go')?.id).toBe('backend/api');
    expect(resolve('/Users/me/repo/backend/db/query.go')?.id).toBe('backend');
  });

  it('returns null for paths outside the repository', () => {
    const resolve = createWorkspacePathResolver(root, workspaces);
    expect(resolve('/Users/me/other/main.go')).toBeNull();
  });

  it('does not match workspace names across path-segment boundaries', () => {
    const resolve = createWorkspacePathResolver(root, [
      ws({ id: 'project', relDir: '', accent: 'project' }),
      ws({ id: 'api', relDir: 'backend/api', accent: 'python' }),
    ]);
    expect(resolve('/Users/me/repo/backend/apiary/main.go')).toBeNull();
  });
});

describe('createRegionAccentResolver', () => {
  const root = '/Users/me/repo';
  const workspaces = [
    ws({ id: 'project', relDir: '', accent: 'project' }),
    ws({ id: 'frontend', relDir: 'frontend', accent: 'frontend' }),
    ws({ id: 'backend', relDir: 'backend', accent: 'go' }),
    ws({ id: 'backend/api', relDir: 'backend/api', accent: 'python' }),
  ];

  it('tints a workspace folder and its descendants with the workspace accent', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    expect(resolve(entry('/Users/me/repo/frontend', true))).toBe('frontend');
    expect(resolve(entry('/Users/me/repo/frontend/src/App.tsx'))).toBe('frontend');
  });

  it('prefers the longest matching relDir for nested workspaces', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    expect(resolve(entry('/Users/me/repo/backend/api/main.go'))).toBe('python');
    expect(resolve(entry('/Users/me/repo/backend/db/x.go'))).toBe('go');
  });

  it('does NOT match a sibling whose name shares a prefix', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    // "backend/apiary" must not match "backend/api"
    expect(resolve(entry('/Users/me/repo/backend/apiary/x.go'))).toBe('go');
  });

  it('skips region tint for root workspaces (relDir === "")', () => {
    const resolve = createRegionAccentResolver(root, [
      ws({ id: 'project', relDir: '', accent: 'project' }),
      ws({ id: 'root:go', relDir: '', accent: 'go' }),
    ]);
    expect(resolve(entry('/Users/me/repo/main.go'))).toBeNull();
  });

  it('tints loose root files by file-type association', () => {
    const resolve = createRegionAccentResolver(root, workspaces);
    expect(resolve(entry('/Users/me/repo/docker-compose.yml'))).toBe('docker');
    expect(resolve(entry('/Users/me/repo/Dockerfile'))).toBe('docker');
    expect(resolve(entry('/Users/me/repo/.dockerignore'))).toBe('docker');
    expect(resolve(entry('/Users/me/repo/main.tf'))).toBe('terraform');
    expect(resolve(entry('/Users/me/repo/production.tfvars'))).toBe('terraform');
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

describe('treeLoadLevels', () => {
  it('preserves literal POSIX backslashes without inventing or merging ancestors', () => {
    expect(treeLoadLevels('/ws', ['/ws/a\\b/c', '/ws/a/b', '/ws/tail\\'])).toEqual([
      ['/ws'],
      ['/ws/a\\b', '/ws/a', '/ws/tail\\'],
      ['/ws/a\\b/c', '/ws/a/b'],
    ]);
    expect(treeLoadLevels('/ws\\repo', ['/ws\\repo/src/sub'])).toEqual([
      ['/ws\\repo'],
      ['/ws\\repo/src'],
      ['/ws\\repo/src/sub'],
    ]);
  });

  it('starts at the root, adds missing ancestors, groups by depth and drops outsiders', () => {
    expect(treeLoadLevels('/ws', ['/ws/a/b/c', '/ws/x', '/other/y', '/ws'])).toEqual([
      ['/ws'],
      ['/ws/a', '/ws/x'],
      ['/ws/a/b'],
      ['/ws/a/b/c'],
    ]);
  });

  it('builds Windows ancestors with the separators it was given and dedupes by case', () => {
    expect(treeLoadLevels('C:\\repo', ['C:\\repo\\a\\b', 'c:\\repo\\a', 'D:\\other\\x'])).toEqual([
      ['C:\\repo'],
      ['C:\\repo\\a'],
      ['C:\\repo\\a\\b'],
    ]);
  });

  it('accepts forward-slash UNC roots with native Windows descendants', () => {
    expect(treeLoadLevels('//server/share', ['\\\\server\\share\\src\\inner'])).toEqual([
      ['//server/share'],
      ['\\\\server\\share\\src'],
      ['\\\\server\\share\\src\\inner'],
    ]);
  });
});

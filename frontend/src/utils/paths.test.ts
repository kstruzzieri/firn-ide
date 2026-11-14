// These tests assert macOS/Linux path rules (#510): pin a POSIX host.
jest.mock('./platform', () => ({
  ...jest.requireActual('./platform'),
  getPlatform: () => 'linux',
}));

import { normalizeFsPath, joinRepoPath } from './paths';

describe('normalizeFsPath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizeFsPath('C:\\repo\\src\\a.ts')).toBe('C:/repo/src/a.ts');
  });

  it('strips trailing slashes', () => {
    expect(normalizeFsPath('/repo/src/')).toBe('/repo/src');
  });

  it('keeps a bare root slash', () => {
    expect(normalizeFsPath('/')).toBe('/');
  });

  it('leaves normal posix paths untouched', () => {
    expect(normalizeFsPath('/repo/src/a.ts')).toBe('/repo/src/a.ts');
  });
});

describe('joinRepoPath', () => {
  it('joins a repo root and a porcelain relative path', () => {
    expect(joinRepoPath('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
  });

  it('normalizes a windows repo root against git forward slashes', () => {
    expect(joinRepoPath('C:\\repo', 'src/a.ts')).toBe('C:/repo/src/a.ts');
  });

  it('tolerates a trailing slash on the root', () => {
    expect(joinRepoPath('/repo/', 'a.ts')).toBe('/repo/a.ts');
  });

  it('joins a repository rooted at the filesystem root', () => {
    expect(joinRepoPath('/', 'a.ts')).toBe('/a.ts');
  });

  // #510: on macOS and Linux a backslash is a name character, so a repo at
  // `/home/dev/a\b` is not `/home/dev/a/b`.
  it('keeps a backslash in a POSIX repo root', () => {
    expect(joinRepoPath('/home/dev/a\\b', 'x.ts')).toBe('/home/dev/a\\b/x.ts');
    expect(normalizeFsPath('/home/dev/a\\b/')).toBe('/home/dev/a\\b');
  });

  it('normalizes a UNC repo root against git forward slashes', () => {
    expect(joinRepoPath('\\\\server\\share\\repo', 'a.ts')).toBe('//server/share/repo/a.ts');
  });
});

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

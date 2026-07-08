import { classifyChange, buildStatusByPath, type GitFileChange } from './git';

const fc = (index: string, worktree: string, over?: Partial<GitFileChange>): GitFileChange => ({
  path: 'src/file.ts',
  index,
  worktree,
  ...over,
});

describe('classifyChange', () => {
  it('splits a staged-only modification into the staged bucket', () => {
    const c = classifyChange(fc('M', '.'));
    expect(c.staged).toBe(true);
    expect(c.unstaged).toBe(false);
    expect(c.rowStatus).toBe('modified');
  });

  it('splits an unstaged-only modification into the unstaged bucket', () => {
    const c = classifyChange(fc('.', 'M'));
    expect(c.staged).toBe(false);
    expect(c.unstaged).toBe(true);
    expect(c.rowStatus).toBe('modified');
  });

  it('puts a partially staged file in both buckets', () => {
    const c = classifyChange(fc('M', 'M'));
    expect(c.staged).toBe(true);
    expect(c.unstaged).toBe(true);
  });

  it('classifies untracked files', () => {
    const c = classifyChange(fc('?', '?'));
    expect(c.staged).toBe(false);
    expect(c.unstaged).toBe(false);
    expect(c.untracked).toBe(true);
    expect(c.rowStatus).toBe('untracked');
  });

  it('classifies staged additions as added', () => {
    expect(classifyChange(fc('A', '.')).rowStatus).toBe('added');
  });

  it('classifies deletions as deleted', () => {
    expect(classifyChange(fc('.', 'D')).rowStatus).toBe('deleted');
    expect(classifyChange(fc('D', '.')).rowStatus).toBe('deleted');
  });

  it('classifies renames as renamed', () => {
    expect(classifyChange(fc('R', '.', { origPath: 'src/old.ts' })).rowStatus).toBe('renamed');
  });

  it('conflict wins over everything', () => {
    const c = classifyChange(fc('U', 'U', { unmerged: true }));
    expect(c.conflicted).toBe(true);
    expect(c.rowStatus).toBe('conflicted');
    expect(c.staged).toBe(false);
  });
});

describe('buildStatusByPath', () => {
  it('maps repo-root-relative paths to absolute paths', () => {
    const map = buildStatusByPath('/repo', [fc('.', 'M', { path: 'sub/a.ts' })]);
    expect(map['/repo/sub/a.ts']).toBe('modified');
  });

  it('returns empty map for no files', () => {
    expect(buildStatusByPath('/repo', [])).toEqual({});
  });
});

import { isDirVisible } from '../../utils/treeVisibility';

const base = {
  rootPath: '/r',
  isRootExpanded: true,
  expandedPaths: new Set<string>(['/r/a', '/r/a/b']),
};

describe('isDirVisible', () => {
  it('true when all ancestors expanded + root expanded', () => {
    expect(isDirVisible('/r/a/b/c', base)).toBe(true); // parent /r/a/b expanded, /r/a expanded
  });
  it('false when an ancestor is collapsed', () => {
    expect(isDirVisible('/r/a/b/c', { ...base, expandedPaths: new Set(['/r/a']) })).toBe(false);
  });
  it('false when root collapsed', () => {
    expect(isDirVisible('/r/a/b/c', { ...base, isRootExpanded: false })).toBe(false);
  });
  it('top-level dir visible when root expanded', () => {
    expect(isDirVisible('/r/a', base)).toBe(true);
  });
  it('root path itself is visible when root expanded', () => {
    expect(isDirVisible('/r', base)).toBe(true);
  });
  it('handles Windows separators', () => {
    expect(
      isDirVisible('C:\\repo\\a\\b\\c', {
        rootPath: 'C:\\repo',
        isRootExpanded: true,
        expandedPaths: new Set<string>(['C:\\repo\\a', 'C:\\repo\\a\\b']),
      })
    ).toBe(true);
  });
  it('false for path outside root', () => {
    expect(isDirVisible('/other/x', base)).toBe(false);
  });
  it('handles a Windows drive root (#447)', () => {
    expect(
      isDirVisible('C:\\src\\a\\b', {
        rootPath: 'C:\\',
        isRootExpanded: true,
        expandedPaths: new Set<string>(['C:\\src', 'C:\\src\\a']),
      })
    ).toBe(true);
  });
  it('reads a backslash in a POSIX root as part of its name (#447)', () => {
    expect(
      isDirVisible('/me/a\\b/src/x', {
        rootPath: '/me/a\\b',
        isRootExpanded: true,
        expandedPaths: new Set<string>(['/me/a\\b/src']),
      })
    ).toBe(true);
  });
});

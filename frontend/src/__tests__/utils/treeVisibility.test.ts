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
  it('false for path outside root', () => {
    expect(isDirVisible('/other/x', base)).toBe(false);
  });
});

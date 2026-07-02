import { gitLineMarkers, type GitLineMarker } from './lineDiff';

const markers = (a: string, b: string): GitLineMarker[] => gitLineMarkers(a, b);

describe('diffLines / markersFromHunks', () => {
  it('returns no markers for identical content', () => {
    expect(markers('a\nb\nc\n', 'a\nb\nc\n')).toEqual([]);
  });

  it('marks an inserted line as added', () => {
    expect(markers('a\nc\n', 'a\nb\nc\n')).toEqual([{ line: 2, type: 'added' }]);
  });

  it('marks a changed line as modified', () => {
    expect(markers('a\nb\nc\n', 'a\nX\nc\n')).toEqual([{ line: 2, type: 'modified' }]);
  });

  it('marks a removal as deleted on the following line', () => {
    expect(markers('a\nb\nc\n', 'a\nc\n')).toEqual([{ line: 2, type: 'deleted' }]);
  });

  it('handles multiple separate hunks', () => {
    const got = markers('a\nb\nc\nd\ne\n', 'a\nX\nc\nd\nY\ne\n');
    expect(got).toEqual([
      { line: 2, type: 'modified' },
      { line: 5, type: 'added' },
    ]);
  });

  it('treats an empty baseline as all lines added (untracked file)', () => {
    expect(markers('', 'a\nb\n')).toEqual([
      { line: 1, type: 'added' },
      { line: 2, type: 'added' },
    ]);
  });

  it('marks trailing additions', () => {
    expect(markers('a\n', 'a\nb\n')).toEqual([{ line: 2, type: 'added' }]);
  });

  it('a deletion at the end anchors to the last line', () => {
    expect(markers('a\nb\n', 'a\n')).toEqual([{ line: 1, type: 'deleted' }]);
  });
});

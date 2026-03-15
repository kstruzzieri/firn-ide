import { foldOutput } from './foldOutput';
import { isFoldedRegion } from '../types/runOutput';
import type { OutputEntry, FoldedRegion } from '../types/runOutput';

function makeEntry(
  text: string,
  stream: 'stdout' | 'stderr' = 'stdout',
  timestamp = 1000
): OutputEntry {
  return { stream, text, timestamp };
}

function makeEntries(texts: string[]): OutputEntry[] {
  return texts.map((t) => makeEntry(t));
}

describe('foldOutput', () => {
  it('returns entries as-is when fewer than 10', () => {
    const entries = makeEntries(['a', 'b', 'c']);
    const result = foldOutput(entries);
    expect(result).toEqual(entries);
  });

  it('returns entries as-is when no repetitive prefix detected', () => {
    // 10 entries but all different prefixes
    const entries = makeEntries([
      'alpha one',
      'beta two',
      'gamma three',
      'delta four',
      'epsilon five',
      'zeta six',
      'eta seven',
      'theta eight',
      'iota nine',
      'kappa ten',
    ]);
    const result = foldOutput(entries);
    expect(result).toHaveLength(10);
    expect(result.every((item) => !isFoldedRegion(item))).toBe(true);
  });

  it('folds 10+ consecutive lines with same prefix', () => {
    const entries = makeEntries([
      'npm warn deprecated package-a',
      'npm warn deprecated package-b',
      'npm warn deprecated package-c',
      'npm warn deprecated package-d',
      'npm warn deprecated package-e',
      'npm warn deprecated package-f',
      'npm warn deprecated package-g',
      'npm warn deprecated package-h',
      'npm warn deprecated package-i',
      'npm warn deprecated package-j',
    ]);
    const result = foldOutput(entries);
    expect(result).toHaveLength(1);
    expect(isFoldedRegion(result[0])).toBe(true);
    const fold = result[0] as FoldedRegion;
    expect(fold.lineCount).toBe(10);
    expect(fold.entries).toHaveLength(10);
  });

  it('does not fold fewer than 10 consecutive matching lines', () => {
    const entries = makeEntries([
      'npm warn deprecated package-a',
      'npm warn deprecated package-b',
      'npm warn deprecated package-c',
      'npm warn deprecated package-d',
      'npm warn deprecated package-e',
      'npm warn deprecated package-f',
      'npm warn deprecated package-g',
      'npm warn deprecated package-h',
      'npm warn deprecated package-i',
    ]);
    const result = foldOutput(entries);
    // 9 entries total — below minimum fold size, returns unchanged
    expect(result).toEqual(entries);
  });

  it('produces stable content-based fold IDs (same input = same ID)', () => {
    const entries = makeEntries(Array.from({ length: 10 }, (_, i) => `downloading chunk ${i}`));
    const result1 = foldOutput(entries);
    const result2 = foldOutput(entries);
    expect(isFoldedRegion(result1[0])).toBe(true);
    expect(isFoldedRegion(result2[0])).toBe(true);
    expect((result1[0] as FoldedRegion).id).toBe((result2[0] as FoldedRegion).id);
  });

  it('handles empty input', () => {
    expect(foldOutput([])).toEqual([]);
  });
});

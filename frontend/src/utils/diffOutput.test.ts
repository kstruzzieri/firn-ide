import { diffOutputLines } from './diffOutput';

describe('diffOutputLines', () => {
  it('empty arrays return empty result', () => {
    expect(diffOutputLines([], [])).toEqual([]);
  });

  it('all added when prev is empty', () => {
    const result = diffOutputLines([], ['a', 'b', 'c']);
    expect(result).toHaveLength(3);
    expect(result.every((l) => l.type === 'added')).toBe(true);
    expect(result.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('all removed when curr is empty', () => {
    const result = diffOutputLines(['x', 'y'], []);
    expect(result).toHaveLength(2);
    expect(result.every((l) => l.type === 'removed')).toBe(true);
    expect(result.map((l) => l.text)).toEqual(['x', 'y']);
  });

  it('identical lines are all unchanged', () => {
    const lines = ['foo', 'bar', 'baz'];
    const result = diffOutputLines(lines, lines);
    expect(result).toHaveLength(3);
    expect(result.every((l) => l.type === 'unchanged')).toBe(true);
  });

  it('mixed additions and removals', () => {
    const prev = ['a', 'b', 'c'];
    const curr = ['a', 'x', 'c'];
    const result = diffOutputLines(prev, curr);
    const unchanged = result.filter((l) => l.type === 'unchanged');
    const added = result.filter((l) => l.type === 'added');
    const removed = result.filter((l) => l.type === 'removed');
    expect(unchanged.map((l) => l.text)).toContain('a');
    expect(unchanged.map((l) => l.text)).toContain('c');
    expect(added.map((l) => l.text)).toContain('x');
    expect(removed.map((l) => l.text)).toContain('b');
  });

  it('too-large guard when product exceeds threshold', () => {
    // 2001 x 2001 = 4,004,001 > 4,000,000 limit
    const big = Array.from({ length: 2001 }, (_, i) => `line ${i}`);
    const result = diffOutputLines(big, big);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('too-large');
  });

  it('large one-sided diff still computes when product is under limit', () => {
    const big = Array.from({ length: 5001 }, (_, i) => `line ${i}`);
    const small = ['only one line'];
    // 5001 x 1 = 5001 < 4,000,000 — computes fine
    const result = diffOutputLines(big, small);
    expect(result.every((l) => l.type !== 'too-large')).toBe(true);
    expect(result.some((l) => l.type === 'added')).toBe(true);
    expect(result.some((l) => l.type === 'removed')).toBe(true);
  });
});

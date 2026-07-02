// Jest globals — no import needed
import { computeOutputRate } from '../../components/RunProfiles/ActivityGraph';

describe('computeOutputRate', () => {
  it('returns 0 for empty data', () => {
    expect(computeOutputRate([])).toBe(0);
  });

  it('computes average output events/sec from waveform data', () => {
    // 12 values, each representing a 500ms bucket from useRunOutput.ts
    // Total events = sum = 60, over 6 seconds = 10 events/sec
    const data = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    expect(computeOutputRate(data)).toBe(10);
  });

  it('handles sparse data', () => {
    // Only 4 values → 2 seconds → sum=8 → 4 events/sec
    const data = [2, 2, 2, 2];
    expect(computeOutputRate(data)).toBe(4);
  });

  it('rounds to nearest integer', () => {
    const data = [3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4];
    // sum=42, over 6s = 7 events/sec
    expect(computeOutputRate(data)).toBe(7);
  });
});

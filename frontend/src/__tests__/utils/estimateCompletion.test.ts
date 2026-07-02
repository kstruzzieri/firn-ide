// Jest globals -- no import needed
import { estimateRemaining, estimateDuration } from '../../utils/estimateCompletion';
import type { RunHistoryEntry } from '../../types/runOutput';

describe('estimateRemaining', () => {
  it('returns null with no history', () => {
    expect(estimateRemaining([], 5000)).toBeNull();
  });

  it('returns null with only one history entry', () => {
    const history: RunHistoryEntry[] = [
      { state: 'success', duration: 3000, timestamp: Date.now() },
    ];
    expect(estimateRemaining(history, 1000)).toBeNull();
  });

  it('estimates remaining from median duration', () => {
    const history: RunHistoryEntry[] = [
      { state: 'success', duration: 4000, timestamp: Date.now() - 3000 },
      { state: 'success', duration: 6000, timestamp: Date.now() - 2000 },
      { state: 'success', duration: 5000, timestamp: Date.now() - 1000 },
    ];
    // Median = 5000ms, elapsed = 2000ms -> remaining = 3000ms
    expect(estimateRemaining(history, 2000)).toBe(3000);
  });

  it('returns 0 when elapsed exceeds estimate', () => {
    const history: RunHistoryEntry[] = [
      { state: 'success', duration: 3000, timestamp: Date.now() - 2000 },
      { state: 'success', duration: 3000, timestamp: Date.now() - 1000 },
    ];
    expect(estimateRemaining(history, 5000)).toBe(0);
  });

  it('ignores failed/stopped runs', () => {
    const history: RunHistoryEntry[] = [
      { state: 'success', duration: 4000, timestamp: Date.now() - 3000 },
      { state: 'failed', duration: 500, timestamp: Date.now() - 2000 },
      { state: 'success', duration: 6000, timestamp: Date.now() - 1000 },
    ];
    expect(estimateRemaining(history, 2000)).toBe(3000);
  });
});

describe('estimateDuration', () => {
  it('estimates median duration from successful runs only', () => {
    expect(
      estimateDuration([
        { state: 'success', duration: 1000, timestamp: 1 },
        { state: 'failed', duration: 9999, timestamp: 2 },
        { state: 'success', duration: 3000, timestamp: 3 },
      ])
    ).toBe(2000);
  });

  it('returns null without two successful samples', () => {
    expect(estimateDuration([{ state: 'success', duration: 1000, timestamp: 1 }])).toBeNull();
  });
});

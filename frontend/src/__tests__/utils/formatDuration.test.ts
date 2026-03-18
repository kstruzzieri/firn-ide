import { formatDuration } from '../../utils/formatDuration';

describe('formatDuration', () => {
  it('formats sub-second as 0s', () => {
    expect(formatDuration(500)).toBe('0s');
  });
  it('formats seconds only', () => {
    expect(formatDuration(45_000)).toBe('45s');
  });
  it('formats minutes and seconds', () => {
    expect(formatDuration(134_000)).toBe('2m 14s');
  });
  it('formats hours and minutes', () => {
    expect(formatDuration(3_780_000)).toBe('1h 3m');
  });
  it('formats exact minute boundary', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
  });
  it('formats exact hour boundary', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
  });
  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});

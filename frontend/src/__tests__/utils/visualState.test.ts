import { getVisualState } from '../../utils/visualState';
import type { RunState } from '../../types/runOutput';

describe('getVisualState', () => {
  it('returns stopping when profile is in stoppingProfileIds', () => {
    expect(getVisualState('p1', 'running', ['p1'], [])).toBe('stopping');
  });
  it('returns stopping when restarting and not yet running', () => {
    expect(getVisualState('p1', 'stopped', [], ['p1'])).toBe('stopping');
  });
  it('returns running when restarting and backend says running', () => {
    expect(getVisualState('p1', 'running', [], ['p1'])).toBe('running');
  });
  it('returns backend state when no local flags set', () => {
    const states: RunState[] = ['idle', 'running', 'stopped', 'failed', 'success'];
    for (const state of states) {
      expect(getVisualState('p1', state, [], [])).toBe(state);
    }
  });
  it('returns idle when no backend state exists', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getVisualState('p1', undefined as unknown as RunState, [], [])).toBe('idle');
  });
  it('stopping flag takes precedence over restarting flag', () => {
    expect(getVisualState('p1', 'running', ['p1'], ['p1'])).toBe('stopping');
  });
});

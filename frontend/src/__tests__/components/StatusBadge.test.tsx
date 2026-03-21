// Jest globals — no import needed
import { getStatusBadgeInfo } from '../../components/RunProfiles/StatusBadge';
import type { RunProfile } from '../../types/runProfile';

const mockProfile: RunProfile = {
  id: 'test-1',
  name: 'go test',
  type: 'single',
  source: 'user',
};

describe('getStatusBadgeInfo', () => {
  it('returns RUNNING for running state', () => {
    const badge = getStatusBadgeInfo('running', mockProfile, []);
    expect(badge.text).toBe('RUNNING');
    expect(badge.className).toBe('running');
  });

  it('returns STOPPING for stopping state', () => {
    const badge = getStatusBadgeInfo('stopping', mockProfile, []);
    expect(badge.text).toBe('STOPPING');
    expect(badge.className).toBe('stopping');
  });

  it('returns FAILED for failed state', () => {
    const badge = getStatusBadgeInfo('failed', mockProfile, []);
    expect(badge.text).toBe('FAILED');
    expect(badge.className).toBe('failed');
  });

  it('returns PASSED for success state', () => {
    const badge = getStatusBadgeInfo('success', mockProfile, []);
    expect(badge.text).toBe('PASSED');
    expect(badge.className).toBe('passed');
  });

  it('returns STOPPED for stopped state', () => {
    const badge = getStatusBadgeInfo('stopped', mockProfile, []);
    expect(badge.text).toBe('STOPPED');
    expect(badge.className).toBe('stopped');
  });

  it('returns READY for idle state with no history (dormant)', () => {
    const badge = getStatusBadgeInfo('idle', mockProfile, []);
    expect(badge.text).toBe('READY');
    expect(badge.className).toBe('ready');
  });

  it('returns PASSED for idle state with successful last run', () => {
    const history = [{ state: 'success' as const, duration: 2300, timestamp: Date.now() }];
    const badge = getStatusBadgeInfo('idle', mockProfile, history);
    expect(badge.text).toBe('PASSED');
    expect(badge.className).toBe('passed');
  });

  it('returns FAILED for idle state with failed last run', () => {
    const history = [{ state: 'failed' as const, duration: 1800, timestamp: Date.now() }];
    const badge = getStatusBadgeInfo('idle', mockProfile, history);
    expect(badge.text).toBe('FAILED');
    expect(badge.className).toBe('failed');
  });
});

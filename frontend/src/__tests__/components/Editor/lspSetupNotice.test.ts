import { describeSetup } from '../../../components/Editor/lspSetupNotice';
import type { LSPServerStatus } from '../../../stores/lspStore';

function status(overrides: Partial<LSPServerStatus>): LSPServerStatus {
  return { family: 'python', workspace: '/proj', state: 'ready', ...overrides };
}

describe('describeSetup phase 2 states', () => {
  it('provisioning -> info tone with percent', () => {
    const n = describeSetup(status({ setupState: 'provisioning', provisionPct: 40 }));
    expect(n?.tone).toBe('info');
    expect(n?.message.toLowerCase()).toContain('setting up');
    expect(n?.hint).toContain('40%');
  });
  it('provisioning without percent -> generic downloading hint', () => {
    const n = describeSetup(status({ setupState: 'provisioning' }));
    expect(n?.tone).toBe('info');
    expect(n?.hint.toLowerCase()).toContain('downloading');
  });
  it('offline -> error tone with retry hint', () => {
    const n = describeSetup(status({ setupState: 'offline', action: 'retry' }));
    expect(n?.tone).toBe('error');
    expect(n?.hint.toLowerCase()).toContain('retry');
  });
  it('provision_failed -> error tone', () => {
    const n = describeSetup(status({ setupState: 'provision_failed', action: 'retry' }));
    expect(n?.tone).toBe('error');
  });
});

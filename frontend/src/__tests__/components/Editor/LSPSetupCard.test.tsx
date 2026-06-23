import { render, screen } from '@testing-library/react';
import { LSPSetupCard } from '../../../components/Editor/LSPSetupCard';
import { describeSetup } from '../../../components/Editor/lspSetupNotice';
import type { LSPServerStatus } from '../../../stores/lspStore';

function status(overrides: Partial<LSPServerStatus>): LSPServerStatus {
  return { family: 'python', workspace: '/proj', state: 'ready', ...overrides };
}

describe('describeSetup', () => {
  it('returns null when ready', () => {
    expect(describeSetup(status({ setupState: 'ready' }))).toBeNull();
  });

  it('returns null when setupState is absent', () => {
    expect(describeSetup(status({}))).toBeNull();
  });

  it('describes a missing interpreter with a venv hint', () => {
    const notice = describeSetup(status({ setupState: 'missing_interpreter' }));
    expect(notice).not.toBeNull();
    expect(notice!.tone).toBe('warning');
    expect(notice!.hint.toLowerCase()).toContain('venv');
  });

  it('describes a missing server as an error', () => {
    const notice = describeSetup(status({ setupState: 'missing_server' }));
    expect(notice!.tone).toBe('error');
  });
});

describe('LSPSetupCard', () => {
  it('renders nothing when ready', () => {
    const { container } = render(<LSPSetupCard status={status({ setupState: 'ready' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the message and hint for missing_interpreter', () => {
    render(<LSPSetupCard status={status({ setupState: 'missing_interpreter' })} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/no python interpreter/i)).toBeInTheDocument();
  });
});

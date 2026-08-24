import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GolemConfiguration } from '../../../components/Golem/GolemConfiguration';

jest.mock('../../../../wailsjs/go/main/App', () => ({
  ReloadGolemSettings: jest.fn(),
}));
import { ReloadGolemSettings } from '../../../../wailsjs/go/main/App';

const testRevision = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const readyProjection = {
  state: 'ready',
  sourceOrigin: 'user_config',
  revision: testRevision,
  readOnly: false,
  editable: true,
  routes: [{ useCase: 'agent', role: 'agent-m' }],
  models: [
    {
      role: 'agent-m',
      modelName: 'wire-model',
      provider: 'hosted',
      type: 'dense',
      effectiveCapabilities: ['chat', 'stream', 'tool_call'],
      capabilityFacts: {
        caps: ['chat', 'stream', 'tool_call'],
        knownCaps: ['chat', 'generate', 'stream', 'embed', 'tool_call', 'thinking', 'insert'],
      },
      exposedCapabilities: ['chat', 'stream', 'tool_call'],
      thinkMode: 'auto',
      routedUseCases: ['agent'],
      removable: false,
    },
  ],
  providers: [
    {
      name: 'hosted',
      endpoint: 'https://api.example.com:8443/v1',
      classification: 'remote',
      apiFormat: 'openai-compat',
      credentialState: 'available',
    },
  ],
  diagnostics: [],
};

const limitedProjection = {
  state: 'limited',
  sourceOrigin: 'working_directory',
  revision: testRevision,
  readOnly: false,
  editable: true,
  routes: [],
  models: [],
  providers: [],
  diagnostics: [
    {
      code: 'provider_endpoint_unsupported',
      subjectKind: 'provider',
      subjectName: 'agent-p',
      blocking: true,
    },
    { code: 'projection_limited', subjectKind: '', subjectName: '', blocking: false },
  ],
};

describe('GolemConfiguration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: readyProjection,
    });
  });

  it('reloads on mount and renders routes, models, providers', async () => {
    render(<GolemConfiguration onClose={() => {}} />);
    expect(await screen.findByText('wire-model')).toBeInTheDocument();
    expect(screen.getByText('https://api.example.com:8443/v1')).toBeInTheDocument();
    expect(screen.getByText(/User configuration directory/)).toBeInTheDocument();
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(ReloadGolemSettings).toHaveBeenCalledTimes(1);
  });

  it('mount-reload busy renders the snapshot silently (no busy notice)', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: true,
      projection: readyProjection,
    });
    render(<GolemConfiguration onClose={() => {}} />);
    expect(await screen.findByText('wire-model')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explicit Refresh while busy shows the inline busy notice', async () => {
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('wire-model');
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: true,
      projection: readyProjection,
    });
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Golem is busy/);
  });

  it('disables Refresh while a request is in flight and re-enables after', async () => {
    let resolveFirst!: (v: unknown) => void;
    (ReloadGolemSettings as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    render(<GolemConfiguration onClose={() => {}} />);
    const refresh = await screen.findByRole('button', { name: /refresh/i });
    expect(refresh).toBeDisabled(); // mount request still pending
    resolveFirst({ busy: false, projection: readyProjection });
    await screen.findByText('wire-model');
    expect(refresh).toBeEnabled();
  });

  it('unmount during a pending request does not update state', async () => {
    let resolveLate!: (v: unknown) => void;
    (ReloadGolemSettings as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        })
    );
    const { unmount } = render(<GolemConfiguration onClose={() => {}} />);
    unmount();
    resolveLate({ busy: false, projection: readyProjection });
    await waitFor(() => expect(ReloadGolemSettings).toHaveBeenCalledTimes(1));
  });

  it('renders limited state with neutral copy plus its blocking diagnostic', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: limitedProjection,
    });
    render(<GolemConfiguration onClose={() => {}} />);
    expect(
      await screen.findByText('Configuration is too large to display in full.')
    ).toBeInTheDocument();
    expect(screen.getByText(/not a usable URL/)).toBeInTheDocument();
    expect(screen.getByText('Blocking')).toBeInTheDocument();
    expect(screen.getByText(/agent-p/)).toBeInTheDocument();
  });

  it('renders blocking diagnostics with human text and subject', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: {
        ...readyProjection,
        diagnostics: [
          {
            code: 'agent_capabilities_insufficient',
            subjectKind: 'model',
            subjectName: 'agent-m',
            blocking: true,
          },
        ],
      },
    });
    render(<GolemConfiguration onClose={() => {}} />);
    expect(await screen.findByText(/must support chat, stream, and tool_call/)).toBeInTheDocument();
  });

  it('missing state renders the empty-state message', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: {
        state: 'missing',
        sourceOrigin: 'none',
        readOnly: false,
        editable: false,
        routes: [],
        models: [],
        providers: [],
        diagnostics: [{ code: 'config_missing', subjectKind: '', subjectName: '', blocking: true }],
      },
    });
    render(<GolemConfiguration onClose={() => {}} />);
    expect(await screen.findByText(/No models\.json was found/)).toBeInTheDocument();
  });

  it('invalid state renders its diagnostic', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: {
        state: 'invalid',
        sourceOrigin: 'env',
        readOnly: false,
        editable: false,
        routes: [],
        models: [],
        providers: [],
        diagnostics: [{ code: 'json_invalid', subjectKind: '', subjectName: '', blocking: true }],
      },
    });
    render(<GolemConfiguration onClose={() => {}} />);
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
    expect(screen.getByText('Blocking')).toBeInTheDocument();
  });

  it('a rejected call renders the retry state with a bounded message', async () => {
    (ReloadGolemSettings as jest.Mock).mockRejectedValue('Golem is unavailable.');
    render(<GolemConfiguration onClose={() => {}} />);
    expect(await screen.findByText('Golem is unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('a malformed payload becomes the fixed contract error, not a crash', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: { state: 'weird' },
    });
    render(<GolemConfiguration onClose={() => {}} />);
    expect(await screen.findByText('Golem returned an unexpected response.')).toBeInTheDocument();
  });

  it('renders typed Slice-A diagnostics with exact copy and severity', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: {
        ...readyProjection,
        state: 'limited',
        diagnostics: [
          {
            code: 'key_reference_unavailable',
            subjectKind: 'provider',
            subjectName: '',
            blocking: true,
          },
          { code: 'duplicate_keys', subjectKind: 'provider', subjectName: '', blocking: false },
        ],
      },
    });

    render(<GolemConfiguration onClose={() => {}} />);

    expect(
      await screen.findByText('An API-key environment variable is unavailable.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Duplicate JSON keys make this configuration read-only.')
    ).toBeInTheDocument();
    expect(screen.getByText('Blocking')).toBeInTheDocument();
    expect(screen.getByText('Notice')).toBeInTheDocument();
    expect(screen.getByText('wire-model')).toBeInTheDocument();
  });

  it('keeps duplicate-key Limited entities visible and labels the notice', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: {
        ...readyProjection,
        state: 'limited',
        readOnly: true,
        diagnostics: [
          {
            code: 'duplicate_keys',
            subjectKind: 'provider',
            subjectName: 'hosted',
            blocking: false,
          },
        ],
      },
    });
    render(<GolemConfiguration onClose={() => {}} />);
    expect(await screen.findByText('wire-model')).toBeInTheDocument();
    expect(
      screen.getByText('Duplicate JSON keys make this configuration read-only.')
    ).toBeInTheDocument();
    expect(screen.getByText('Notice')).toBeInTheDocument();
  });

  it('moves focus to the heading on mount', async () => {
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('wire-model');
    expect(screen.getByRole('heading', { name: /configuration/i })).toHaveFocus();
  });
});

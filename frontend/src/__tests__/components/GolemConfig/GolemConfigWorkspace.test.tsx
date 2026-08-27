import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GolemConfigWorkspace } from '../../../components/GolemConfig/GolemConfigWorkspace';

jest.mock('../../../../wailsjs/go/main/App', () => ({
  ReloadGolemSettings: jest.fn(),
}));
import { ReloadGolemSettings } from '../../../../wailsjs/go/main/App';

const testRevision = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const model = (over: Record<string, unknown> = {}) => ({
  role: 'agent-m',
  modelName: 'qwen3-coder-30b',
  provider: 'llama-swap',
  type: 'dense',
  effectiveCapabilities: ['chat', 'stream', 'tool_call'],
  capabilityFacts: {
    caps: ['chat', 'stream', 'tool_call'],
    knownCaps: ['chat', 'generate', 'stream', 'embed', 'tool_call', 'thinking', 'insert'],
  },
  exposedCapabilities: ['chat', 'stream', 'tool_call'],
  thinkMode: 'auto',
  routedUseCases: ['agent'],
  hasThinkTags: false,
  hasSlots: false,
  removable: false,
  ...over,
});

const readyProjection = {
  state: 'ready',
  sourceOrigin: 'user_config',
  revision: testRevision,
  readOnly: false,
  editable: true,
  routes: [{ useCase: 'agent', role: 'agent-m' }],
  models: [model()],
  providers: [
    {
      name: 'llama-swap',
      endpoint: 'http://127.0.0.1:9292/v1',
      classification: 'local',
      apiFormat: 'openai-compat',
      credentialState: 'none',
    },
  ],
  diagnostics: [],
};

const emptyProjection = (state: string, sourceOrigin: string) => ({
  state,
  sourceOrigin,
  readOnly: false,
  editable: false,
  routes: [],
  models: [],
  providers: [],
  diagnostics: [],
});

const resolve = (projection: unknown, busy = false) =>
  (ReloadGolemSettings as jest.Mock).mockResolvedValue({ busy, projection });

describe('GolemConfigWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolve(readyProjection);
  });

  it('loads once on mount and renders the masthead verdict, source, and revision', async () => {
    render(<GolemConfigWorkspace onClose={() => {}} />);

    // Queried by test id, not by the `banner` role: the real surface renders
    // inside the shell's <main>, where a <header> is a section header.
    const masthead = await screen.findByTestId('golem-config-masthead');
    expect(within(masthead).getByRole('heading', { name: 'Golem Configuration' })).toBeVisible();
    expect(within(masthead).getByText('Ready')).toBeInTheDocument();
    expect(within(masthead).getByText('User configuration directory')).toBeInTheDocument();
    expect(within(masthead).getByText(`rev ${testRevision.slice(0, 12)}`)).toHaveAttribute(
      'title',
      testRevision
    );
    expect(ReloadGolemSettings).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the heading when the tab opens', async () => {
    render(<GolemConfigWorkspace onClose={() => {}} />);
    await screen.findByRole('heading', { name: 'Golem Configuration' });
    expect(screen.getByRole('heading', { name: 'Golem Configuration' })).toHaveFocus();
  });

  it('renders a provider strip with endpoint, classification, format, and key state', async () => {
    render(<GolemConfigWorkspace onClose={() => {}} />);

    const row = await screen.findByTestId('provider-row-llama-swap');
    expect(within(row).getByText('llama-swap')).toBeInTheDocument();
    expect(within(row).getByText('http://127.0.0.1:9292/v1')).toBeInTheDocument();
    expect(within(row).getByText('Local')).toBeInTheDocument();
    expect(within(row).getByText('openai-compat')).toBeInTheDocument();
    expect(within(row).getByText('No key')).toBeInTheDocument();
  });

  it('renders a routing strip joining the use case to its model and provider', async () => {
    render(<GolemConfigWorkspace onClose={() => {}} />);

    const row = await screen.findByTestId('route-row-agent');
    expect(within(row).getByText('agent')).toBeInTheDocument();
    expect(within(row).getByText('llama-swap')).toBeInTheDocument();
    expect(within(row).getByText('qwen3-coder-30b')).toBeInTheDocument();
    expect(within(row).getByText('auto')).toBeInTheDocument();
    expect(within(row).getByText('Ready')).toBeInTheDocument();
  });

  it('marks a route with no resolvable model as No model', async () => {
    resolve({
      ...readyProjection,
      routes: [
        { useCase: 'agent', role: 'agent-m' },
        { useCase: 'embedding', role: 'ghost' },
      ],
    });
    render(<GolemConfigWorkspace onClose={() => {}} />);

    const row = await screen.findByTestId('route-row-embedding');
    expect(within(row).getByText('No model')).toBeInTheDocument();
  });

  it('marks a route whose exposed capabilities miss the use-case floor as Incompatible', async () => {
    resolve({
      ...readyProjection,
      models: [model({ exposedCapabilities: ['chat', 'stream'] })],
    });
    render(<GolemConfigWorkspace onClose={() => {}} />);

    const row = await screen.findByTestId('route-row-agent');
    expect(within(row).getByText('Incompatible')).toBeInTheDocument();
  });

  it('lists defined models that no use case routes to', async () => {
    resolve({
      ...readyProjection,
      models: [
        model(),
        model({
          role: 'spare',
          modelName: 'nomic-embed',
          routedUseCases: [],
          exposedCapabilities: ['embed'],
          thinkMode: '',
        }),
      ],
    });
    render(<GolemConfigWorkspace onClose={() => {}} />);

    const row = await screen.findByTestId('defined-model-row-spare');
    expect(within(row).getByText('nomic-embed')).toBeInTheDocument();
    expect(screen.getByText('Defined models')).toBeInTheDocument();
    expect(screen.queryByTestId('defined-model-row-agent-m')).not.toBeInTheDocument();
  });

  it('names each section prerequisite while the configuration is Missing', async () => {
    resolve({
      ...emptyProjection('missing', 'none'),
      diagnostics: [{ code: 'config_missing', subjectKind: '', subjectName: '', blocking: true }],
    });
    render(<GolemConfigWorkspace onClose={() => {}} />);

    expect(await screen.findByText(/Add a provider first/)).toBeInTheDocument();
    expect(screen.getByText(/Add a provider, then assign a model/)).toBeInTheDocument();
    expect(screen.getByText('No models.json was found at any discovery location.')).toBeVisible();
  });

  it('explains that editing is unavailable while Limited', async () => {
    resolve({
      ...readyProjection,
      state: 'limited',
      readOnly: true,
      diagnostics: [
        { code: 'duplicate_keys', subjectKind: 'provider', subjectName: 'hosted', blocking: false },
      ],
    });
    render(<GolemConfigWorkspace onClose={() => {}} />);

    expect(
      await screen.findByText(/Editing is unavailable while this configuration is Limited/)
    ).toBeInTheDocument();
    // Limited keeps the runtime entities visible.
    expect(screen.getByTestId('provider-row-llama-swap')).toBeInTheDocument();
    expect(
      screen.getByText(/Duplicate JSON keys make this configuration read-only\./)
    ).toBeInTheDocument();
    expect(screen.getByText('provider hosted')).toBeInTheDocument();
  });

  it('explains that editing is unavailable while Invalid and offers Refresh', async () => {
    resolve({
      ...emptyProjection('invalid', 'env'),
      diagnostics: [{ code: 'json_invalid', subjectKind: '', subjectName: '', blocking: true }],
    });
    render(<GolemConfigWorkspace onClose={() => {}} />);

    expect(
      await screen.findByText(/Editing is unavailable: this configuration could not be loaded/)
    ).toBeInTheDocument();
    expect(screen.getByText('The configuration file is not valid JSON.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('names the diagnostic subject by kind, never by name alone', async () => {
    resolve({
      ...readyProjection,
      // Transport order is blocking, then code, then subject kind and name.
      diagnostics: [
        {
          code: 'agent_capabilities_insufficient',
          subjectKind: 'use_case',
          subjectName: 'agent',
          blocking: true,
        },
        {
          code: 'provider_endpoint_unsupported',
          subjectKind: 'provider',
          subjectName: 'agent',
          blocking: true,
        },
      ],
    });
    render(<GolemConfigWorkspace onClose={() => {}} />);

    expect(await screen.findByText('provider agent')).toBeInTheDocument();
    expect(screen.getByText('use case agent')).toBeInTheDocument();
  });

  it('shows the busy notice for an explicit Refresh only', async () => {
    resolve(readyProjection, true);
    render(<GolemConfigWorkspace onClose={() => {}} />);
    await screen.findByTestId('provider-row-llama-swap');
    expect(screen.queryByText(/Golem is busy/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/Golem is busy/)).toHaveAttribute('role', 'status');
  });

  it('announces the state verdict in a live region', async () => {
    render(<GolemConfigWorkspace onClose={() => {}} />);
    await screen.findByTestId('provider-row-llama-swap');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Configuration Ready. Source User configuration directory.'
    );
  });

  it('disables Refresh while a load is in flight', async () => {
    let settle!: (value: unknown) => void;
    (ReloadGolemSettings as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((r) => {
          settle = r;
        })
    );
    render(<GolemConfigWorkspace onClose={() => {}} />);
    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    expect(refresh).toBeDisabled();

    settle({ busy: false, projection: readyProjection });
    await screen.findByTestId('provider-row-llama-swap');
    expect(refresh).toBeEnabled();
  });

  it('drops a response that lands after unmount', async () => {
    let settle!: (value: unknown) => void;
    (ReloadGolemSettings as jest.Mock).mockImplementation(
      () =>
        new Promise((r) => {
          settle = r;
        })
    );
    const { unmount } = render(<GolemConfigWorkspace onClose={() => {}} />);
    unmount();
    settle({ busy: false, projection: readyProjection });
    await waitFor(() => expect(ReloadGolemSettings).toHaveBeenCalledTimes(1));
  });

  it('offers a bounded message and Retry when the call is rejected', async () => {
    (ReloadGolemSettings as jest.Mock).mockRejectedValue('Golem is unavailable.');
    render(<GolemConfigWorkspace onClose={() => {}} />);

    expect(await screen.findByText('Golem is unavailable.')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });

    resolve(readyProjection);
    await userEvent.click(retry);
    expect(await screen.findByTestId('provider-row-llama-swap')).toBeInTheDocument();
  });

  it('turns a malformed payload into the fixed contract error', async () => {
    resolve({ state: 'weird' });
    render(<GolemConfigWorkspace onClose={() => {}} />);
    expect(await screen.findByText('Golem returned an unexpected response.')).toBeInTheDocument();
  });

  it('closes through the masthead Close action', async () => {
    const onClose = jest.fn();
    render(<GolemConfigWorkspace onClose={onClose} />);
    await screen.findByTestId('provider-row-llama-swap');

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders no Apply bar and no editing controls in the read-only first paint', async () => {
    render(<GolemConfigWorkspace onClose={() => {}} />);
    await screen.findByTestId('provider-row-llama-swap');

    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });
});

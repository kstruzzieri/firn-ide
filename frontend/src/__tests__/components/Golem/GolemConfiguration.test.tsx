import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GolemConfiguration } from '../../../components/Golem/GolemConfiguration';
import { __resetGolemStore, useGolemStore } from '../../../stores/golemStore';

jest.mock('../../../../wailsjs/go/main/App', () => ({
  ReloadGolemSettings: jest.fn(),
  CancelGolemRun: jest.fn(),
  RunGolemTurn: jest.fn(),
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
      hasThinkTags: false,
      hasSlots: false,
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
    expect(screen.getByText('User configuration directory')).toBeInTheDocument();
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(ReloadGolemSettings).toHaveBeenCalledTimes(1);
  });

  // Group by provider in the PROVIDERS list's own order, then role-alpha. The
  // projection arrives in its contract order — ascending by role, interleaved
  // across providers — so the rendered order proves a real render-time regroup.
  // The same rule runs on the workspace's Defined models and the route picker.
  it('groups model cards by provider in the providers order, role-alpha within', async () => {
    const base = readyProjection.models[0];
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: {
        ...readyProjection,
        routes: [],
        // Transport order: ascending by role, so the providers interleave.
        models: [
          { ...base, role: 'a-hosted', provider: 'hosted', routedUseCases: [] },
          { ...base, role: 'a-local', provider: 'zeta-local', routedUseCases: [] },
          { ...base, role: 'b-hosted', provider: 'hosted', routedUseCases: [] },
          { ...base, role: 'b-local', provider: 'zeta-local', routedUseCases: [] },
        ],
        providers: [
          readyProjection.providers[0],
          { ...readyProjection.providers[0], name: 'zeta-local' },
        ],
      },
    });
    render(<GolemConfiguration onClose={() => {}} />);

    await screen.findByText('a-hosted');
    const models = screen.getByRole('region', { name: 'Models' });
    expect(
      within(models)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('[class*="roleChip"]')?.textContent)
    ).toEqual(['a-hosted', 'b-hosted', 'a-local', 'b-local']);
  });

  it('chips the use cases a model serves, and nothing for an unrouted one', async () => {
    const base = readyProjection.models[0];
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: {
        ...readyProjection,
        models: [
          { ...base, role: 'agent-m', routedUseCases: ['agent', 'chat'] },
          { ...base, role: 'spare-m', routedUseCases: [] },
        ],
      },
    });
    render(<GolemConfiguration onClose={() => {}} />);

    const routed = await screen.findByTestId('routed-agent-m');
    expect(within(routed).getByText('agent')).toBeInTheDocument();
    expect(within(routed).getByText('chat')).toBeInTheDocument();
    expect(screen.queryByTestId('routed-spare-m')).not.toBeInTheDocument();
  });

  // Keith's order: what runs the models, then what routes to them, then the
  // models themselves.
  it('reads Providers, then Roles, then Models', async () => {
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('wire-model');

    expect(
      screen.getAllByRole('region').map((section) => section.getAttribute('aria-label'))
    ).toEqual(['Providers', 'Role routing', 'Models']);
  });

  it.each([
    ['providers', 'Providers'],
    ['roles', 'Roles'],
    ['models', 'Models'],
  ])('collapses and reopens the %s section', async (id, label) => {
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('wire-model');

    const section = screen.getByTestId(`section-${id}`) as HTMLDetailsElement;
    expect(section.open).toBe(true); // every group starts expanded

    await userEvent.click(within(section).getByText(label));
    expect(section.open).toBe(false);

    await userEvent.click(within(section).getByText(label));
    expect(section.open).toBe(true);
  });

  it('collapses each provider group inside Models independently', async () => {
    const base = readyProjection.models[0];
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: {
        ...readyProjection,
        routes: [],
        models: [
          { ...base, role: 'a-hosted', provider: 'hosted', routedUseCases: [] },
          { ...base, role: 'a-local', provider: 'zeta-local', routedUseCases: [] },
        ],
        providers: [
          readyProjection.providers[0],
          { ...readyProjection.providers[0], name: 'zeta-local' },
        ],
      },
    });
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('a-hosted');

    const hosted = screen.getByTestId('models-hosted') as HTMLDetailsElement;
    const local = screen.getByTestId('models-zeta-local') as HTMLDetailsElement;

    await userEvent.click(within(hosted).getByText('hosted'));
    expect(hosted.open).toBe(false);
    expect(local.open).toBe(true); // its sibling is untouched
    expect(screen.getByTestId('section-models')).toHaveAttribute('open'); // so is the section
  });

  // Keyboard operability comes from using a real <summary> rather than a styled
  // div: it is in the tab order, and the browser activates it on Enter/Space.
  // jsdom implements the click activation but not that key synthesis, so the
  // reachable-and-activatable half is what can honestly be asserted here.
  it('makes every section toggle a real, focusable summary', async () => {
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('wire-model');

    for (const [id, label] of [
      ['providers', 'Providers'],
      ['roles', 'Roles'],
      ['models', 'Models'],
    ]) {
      const section = screen.getByTestId(`section-${id}`);
      const summary = within(section).getByText(label);
      // A real summary, and the direct child of its details — which is what
      // puts it in the tab order and binds Enter/Space to the toggle.
      expect(summary.tagName).toBe('SUMMARY');
      expect(summary.parentElement).toBe(section);
      summary.focus();
      expect(summary).toHaveFocus();
    }

    const providers = screen.getByTestId('section-providers') as HTMLDetailsElement;
    await userEvent.click(within(providers).getByText('Providers'));
    expect(providers.open).toBe(false);
  });

  it('mount-reload busy renders the snapshot silently (no busy notice)', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: true,
      projection: readyProjection,
    });
    render(<GolemConfiguration onClose={() => {}} />);
    expect(await screen.findByText('wire-model')).toBeInTheDocument();
    expect(screen.queryByText(/Golem is busy/)).not.toBeInTheDocument();
  });

  it('announces configuration state changes after Refresh', async () => {
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('wire-model');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Configuration Ready. Source User configuration directory.');

    (ReloadGolemSettings as jest.Mock).mockResolvedValueOnce({
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
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() =>
      expect(status).toHaveTextContent('Configuration Invalid. Source Environment override.')
    );
  });

  it('explicit Refresh while busy shows the inline busy notice', async () => {
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('wire-model');
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: true,
      projection: readyProjection,
    });
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(await screen.findByText(/Golem is busy/)).toHaveAttribute('role', 'status');
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
        readOnly: true,
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
      screen.getByText(/Duplicate JSON keys make this configuration read-only\./)
    ).toBeInTheDocument();
    expect(screen.getByText('provider hosted')).toBeInTheDocument();
    expect(screen.getByText('Notice')).toBeInTheDocument();
  });

  it('moves focus to the heading on mount', async () => {
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('wire-model');
    expect(screen.getByRole('heading', { name: /configuration/i })).toHaveFocus();
  });

  it('names the diagnostic subject by kind so identical names stay distinguishable', async () => {
    (ReloadGolemSettings as jest.Mock).mockResolvedValue({
      busy: false,
      projection: {
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
      },
    });
    render(<GolemConfiguration onClose={() => {}} />);

    expect(await screen.findByText('provider agent')).toBeInTheDocument();
    expect(screen.getByText('use case agent')).toBeInTheDocument();
  });

  it('opens the app-global configuration tab from the masthead', async () => {
    __resetGolemStore();
    render(<GolemConfiguration onClose={() => {}} />);
    await screen.findByText('wire-model');

    await userEvent.click(screen.getByRole('button', { name: 'Open configuration' }));

    expect(useGolemStore.getState().configTabOpen).toBe(true);
    expect(useGolemStore.getState().configTabFocused).toBe(true);
  });
});

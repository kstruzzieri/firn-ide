/**
 * #490: the Golem model row, its picker and the Shared configuration card,
 * driven through the real workspace over the projection Firn emits for the
 * design's hybrid-cc profile (internal/ai/testdata/golem_model_row, pinned by
 * golem_model_row_test.go). The request Use model sends is pinned in the same
 * directory, and the Go test proves the planner writes the expected document
 * for it.
 */

import fs from 'fs';
import path from 'path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GolemConfigWorkspace } from '../../../components/GolemConfig/GolemConfigWorkspace';

jest.mock('../../../wails/bindings', () => ({
  ReloadGolemSettings: jest.fn(),
  ApplyGolemSettings: jest.fn(),
  CreateGolemSettings: jest.fn(),
  ConfirmGolemSettingsApply: jest.fn(),
  CancelGolemSettingsApply: jest.fn(),
  ConfirmGolemDestinationGrants: jest.fn(),
  PrepareGolemDestinationGrants: jest.fn(),
  ListGolemProfiles: jest.fn(),
  LoadGolemProfile: jest.fn(),
}));
import {
  ApplyGolemSettings,
  ConfirmGolemSettingsApply,
  ListGolemProfiles,
  PrepareGolemDestinationGrants,
  ReloadGolemSettings,
} from '../../../wails/bindings';

const fixtureDir = path.resolve(__dirname, '../../../../../internal/ai/testdata/golem_model_row');
const readFixture = <T,>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')) as T;

interface Reload {
  busy: boolean;
  projection: Record<string, unknown> & { revision: string };
}
const hybrid = (): Reload => readFixture<Reload>('hybrid-cc.reload.json');
const pinnedRequest = () => readFixture<{ changes: unknown[] }>('hybrid-cc.use-glm.request.json');

/** Roles hybrid-cc authors whose names are not also use-case names. */
const ROLE_ONLY_NAMES = [
  'general',
  'judge',
  'fast',
  'coding',
  'lightweight',
  'cc-agent',
  'cc-coder',
  'cc-pro',
  'cc-review',
  'cc-grok',
  'cc-luna',
  'cc-flash',
  'cc-mimo',
];

const lastApply = () => (ApplyGolemSettings as jest.Mock).mock.calls.at(-1)?.[0];

async function mount(reload: Reload = hybrid()): Promise<void> {
  (ReloadGolemSettings as jest.Mock).mockResolvedValue(reload);
  render(<GolemConfigWorkspace onClose={() => {}} />);
  await screen.findByTestId('provider-row-llamacpp');
}

const changeButton = () => screen.getByRole('button', { name: 'Change Golem model' });
const sharedToggle = () => screen.getByRole('button', { name: /^Shared configuration/ });
const picker = () => document.getElementById('golem-model-picker')!;
const golemCard = () => screen.getByRole('region', { name: 'Golem model' });

async function openPicker(): Promise<HTMLElement> {
  await userEvent.click(changeButton());
  return picker();
}

/** The option whose model name node reads `name`. */
function optionNamed(list: HTMLElement, name: string): HTMLElement {
  const option = within(list)
    .getAllByRole('option')
    .find((candidate) => within(candidate).queryByText(name) !== null);
  if (option === undefined) throw new Error(`no option named ${name}`);
  return option;
}

const optionNames = (list: HTMLElement): string[] =>
  within(list)
    .getAllByRole('option')
    .map((option) => option.querySelector('[data-model-name]')?.textContent ?? '');

async function tickApplyAnywayIfAsked(scope: HTMLElement): Promise<void> {
  const box = within(scope).queryByRole('checkbox', { name: 'Apply anyway' });
  if (box !== null) await userEvent.click(box);
}

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  (ListGolemProfiles as jest.Mock).mockResolvedValue({ status: 'loaded', profiles: [] });
});

describe('the Golem model row', () => {
  it('opens on the model Golem runs, with no role named outside Shared configuration', async () => {
    await mount();
    const card = golemCard();
    expect(within(card).getByTestId('golem-model-current').textContent).toBe(
      'qwen3.6:35b-a3b via llamacpp'
    );
    expect(within(card).getByText('Local')).toBeInTheDocument();
    expect(within(card).getByText('Runs Golem chat and commit messages.')).toBeInTheDocument();

    expect(sharedToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('7 routes in this configuration; Firn uses 1')).toBeInTheDocument();
    const body = document.getElementById(sharedToggle().getAttribute('aria-controls')!)!;
    expect(body).not.toBeVisible();

    // Golem Configuration opens on the row, above Providers; Shared
    // configuration follows Providers.
    const providers = screen.getByRole('region', { name: /Providers/ });
    expect(card.compareDocumentPosition(providers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      providers.compareDocumentPosition(sharedToggle()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const outside = document.body.cloneNode(true) as HTMLElement;
    outside.querySelector(`#${body.id}`)?.remove();
    for (const role of ROLE_ONLY_NAMES)
      expect(outside.textContent).not.toMatch(new RegExp(`(^|[^\\w-])${role}([^\\w-]|$)`));
  });

  it('is a disclosure: Change reads its state, keeps focus and folds a mounted picker', async () => {
    await mount();
    const change = changeButton();
    expect(change).toHaveAttribute('type', 'button');
    expect(change).toHaveAttribute('aria-expanded', 'false');
    expect(change).toHaveAttribute('aria-controls', 'golem-model-picker');
    expect(picker()).not.toBeVisible();

    await userEvent.click(change);
    expect(change).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(change);
    expect(picker()).toBeVisible();
    // The fold follows its toggle, so Tab reaches it next.
    expect(
      change.compareDocumentPosition(picker()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    await userEvent.click(change);
    expect(change).toHaveAttribute('aria-expanded', 'false');
    expect(picker()).toBeInTheDocument();
    expect(picker()).not.toBeVisible();
  });
});

describe('the picker', () => {
  it('lists every authored model once: who can run Golem first, the rest folded with a reason', async () => {
    await mount();
    const fold = await openPicker();
    const can = within(fold).getByRole('listbox', { name: 'Can run Golem' });
    expect(optionNames(can).sort()).toEqual(
      ['gemma4:31b', 'moonshotai/Kimi-K2.7-Code', 'qwen3.6:35b-a3b', 'zai-org/GLM-5.2'].sort()
    );
    // The current model is marked.
    expect(within(optionNamed(can, 'qwen3.6:35b-a3b')).getByText('current')).toBeInTheDocument();
    // Each card names its provider; the provider select starts on All providers.
    expect(
      within(optionNamed(can, 'zai-org/GLM-5.2')).getByText('commandcode')
    ).toBeInTheDocument();
    expect(within(fold).getByLabelText('Provider')).toHaveValue('');
    expect(
      within(within(fold).getByLabelText('Provider')).getByRole('option', { name: 'All providers' })
    ).toBeInTheDocument();

    const toggle = within(fold).getByRole('button', { name: "9 can't run Golem" });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const cannot = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(cannot).not.toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(toggle);
    expect(cannot).toBeVisible();
    const items = within(cannot).getAllByRole('listitem');
    expect(items).toHaveLength(9);
    const reasonOf = (name: string) =>
      items
        .find((item) => item.querySelector('[data-model-name]')?.textContent === name)
        ?.querySelector('[data-reason]')?.textContent;
    expect(reasonOf('qwen3-embedding:8b')).toBe("Embedding model: can't chat");
    for (const name of [
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-v4-flash',
      'moonshotai/Kimi-K3',
      'xai/grok-4.6',
      'gpt-5.6-luna',
      'xiaomi/mimo-v2.5-pro',
      'qwen3-coder-next:latest',
      'qwen3.5:9b-mtp',
    ])
      expect(reasonOf(name)).toBe('Tool support not verified');

    // 4 + 9: thirteen models, each once.
    const all = [
      ...optionNames(can),
      ...items.map((item) => item.querySelector('[data-model-name]')?.textContent),
    ];
    expect(new Set(all).size).toBe(13);
    expect(all).toHaveLength(13);
  });

  it('narrows both groups with the name filter', async () => {
    await mount();
    const fold = await openPicker();
    await userEvent.type(within(fold).getByLabelText('Filter models'), 'kimi');
    expect(optionNames(within(fold).getByRole('listbox', { name: 'Can run Golem' }))).toEqual([
      'moonshotai/Kimi-K2.7-Code',
    ]);
    expect(within(fold).getByRole('button', { name: "1 can't run Golem" })).toBeInTheDocument();
  });

  it('files gemma4:31b by the card the staged change carries, and Details shows each card', async () => {
    await mount();
    const fold = await openPicker();
    const can = within(fold).getByRole('listbox', { name: 'Can run Golem' });
    // gemma4:31b backs three cards; only one lists tool_call. The change the
    // picker stages carries that card's facts, so the entry can run Golem.
    await userEvent.click(optionNamed(can, 'gemma4:31b'));
    const details = within(fold).getByRole('button', { name: 'Details of gemma4:31b' });
    await userEvent.click(details);
    const table = document.getElementById(details.getAttribute('aria-controls')!)!;
    expect(table).toBeVisible();
    expect(within(table).getByText(/1 of 3 cards for this model says yes/)).toBeInTheDocument();

    (ApplyGolemSettings as jest.Mock).mockResolvedValue({
      status: 'diagnostics',
      diagnostics: [],
      consentOutcome: 'unchanged',
    });
    await tickApplyAnywayIfAsked(fold);
    await userEvent.click(within(fold).getByRole('button', { name: 'Use model' }));
    await waitFor(() => expect(ApplyGolemSettings).toHaveBeenCalledTimes(1));
    const [change] = lastApply().changes;
    expect(change.modelFacts.model).toBe('gemma4:31b');
    expect(change.capabilityFacts.caps).toContain('tool_call');
  });

  it('keeps Details closed until the user opens it; the summary names no source', async () => {
    await mount();
    const fold = await openPicker();
    expect(within(fold).getByTestId('golem-summary').textContent).toBe(
      'chat, stream, tool_call: yes'
    );
    const details = within(fold).getByRole('button', { name: 'Details of qwen3.6:35b-a3b' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    const table = document.getElementById(details.getAttribute('aria-controls')!)!;
    expect(table).not.toBeVisible();

    await userEvent.click(
      optionNamed(within(fold).getByRole('listbox', { name: 'Can run Golem' }), 'zai-org/GLM-5.2')
    );
    const glmDetails = within(fold).getByRole('button', { name: 'Details of zai-org/GLM-5.2' });
    expect(glmDetails).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(glmDetails);
    expect(glmDetails).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(glmDetails);
    expect(
      within(document.getElementById(glmDetails.getAttribute('aria-controls')!)!).getAllByText(
        /listed in the configuration/
      ).length
    ).toBeGreaterThan(0);
  });

  it('offers no type or Kind select', async () => {
    await mount();
    const fold = await openPicker();
    expect(within(fold).queryByLabelText('Type')).toBeNull();
    expect(within(fold).queryByLabelText(/Kind/)).toBeNull();
    expect(within(fold).getAllByRole('combobox')).toHaveLength(1); // the provider select
  });

  it('says what picking zai-org/GLM-5.2 does, in words, naming no role and no fallback', async () => {
    await mount();
    const fold = await openPicker();
    await userEvent.click(
      optionNamed(within(fold).getByRole('listbox', { name: 'Can run Golem' }), 'zai-org/GLM-5.2')
    );
    const message = within(fold).getByTestId('golem-impact');
    expect(
      within(message)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([
      'Golem chat and commit messages will use zai-org/GLM-5.2 via commandcode.',
      'The golem CLI uses this setting too when it loads the same configuration.',
      'Its fallbacks are under Shared configuration.',
    ]);
    // Not a live region.
    expect(message.closest('[aria-live]')).toBeNull();
    for (const name of [...ROLE_ONLY_NAMES, 'agent-m'])
      expect(message.textContent).not.toMatch(new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`));
  });
});

describe('Use model', () => {
  const consentRequired = () => ({
    status: 'consent_required',
    challenge: {
      token: 'challenge-token-1',
      expiresAt: Date.now() + 600_000,
      destinations: [
        {
          provider: 'commandcode',
          model: 'zai-org/GLM-5.2',
          endpoint: 'https://api.commandcode.ai/provider',
          classification: 'remote',
          provenance: ['agent'],
        },
      ],
    },
  });

  it('applies the picked model in one step, with the challenge in the picker, then returns focus to Change', async () => {
    const reload = hybrid();
    await mount(reload);
    const fold = await openPicker();
    await userEvent.click(
      optionNamed(within(fold).getByRole('listbox', { name: 'Can run Golem' }), 'zai-org/GLM-5.2')
    );
    (ApplyGolemSettings as jest.Mock).mockResolvedValue(consentRequired());
    await tickApplyAnywayIfAsked(fold);
    await userEvent.click(within(fold).getByRole('button', { name: 'Use model' }));

    await waitFor(() => expect(ApplyGolemSettings).toHaveBeenCalledTimes(1));
    const request = lastApply();
    // Only the picker's change, exactly what the route editor and Apply send.
    expect(request.changes).toEqual(pinnedRequest().changes);
    expect(request.targetRevision).toBe(reload.projection.revision);

    // The challenge shows in the picker; nothing is written until it passes.
    const confirm = await within(picker()).findByRole('button', { name: 'Confirm destination' });
    expect(picker()).toBeVisible();
    expect(ConfirmGolemSettingsApply).not.toHaveBeenCalled();

    const applied = hybrid().projection;
    (ConfirmGolemSettingsApply as jest.Mock).mockResolvedValue({
      status: 'applied',
      projection: { ...applied, revision: 'e'.repeat(64) },
    });
    await userEvent.click(confirm);
    await waitFor(() => expect(changeButton()).toHaveAttribute('aria-expanded', 'false'));
    expect(picker()).not.toBeVisible();
    await waitFor(() => expect(document.activeElement).toBe(changeButton()));
  });

  it('shows a refusal in the picker', async () => {
    await mount();
    const fold = await openPicker();
    await userEvent.click(
      optionNamed(within(fold).getByRole('listbox', { name: 'Can run Golem' }), 'zai-org/GLM-5.2')
    );
    (ApplyGolemSettings as jest.Mock).mockResolvedValue({
      status: 'conflict',
      conflict: 'target',
      consentOutcome: 'unchanged',
    });
    await tickApplyAnywayIfAsked(fold);
    await userEvent.click(within(fold).getByRole('button', { name: 'Use model' }));
    expect(
      await within(picker()).findByText(/The configuration moved while this draft was open/)
    ).toBeInTheDocument();
  });

  it('keeps a later destination check out of the picker', async () => {
    await mount();
    const fold = await openPicker();
    await userEvent.click(
      optionNamed(within(fold).getByRole('listbox', { name: 'Can run Golem' }), 'zai-org/GLM-5.2')
    );
    (ApplyGolemSettings as jest.Mock).mockResolvedValue({
      status: 'diagnostics',
      diagnostics: [
        {
          code: 'eligibility_ineligible',
          subjectKind: 'use_case',
          subjectName: 'agent',
          blocking: true,
        },
      ],
      consentOutcome: 'unchanged',
    });
    await tickApplyAnywayIfAsked(fold);
    await userEvent.click(within(fold).getByRole('button', { name: 'Use model' }));
    // The refusal's diagnostic shows in the picker, not folded away in a row.
    expect(
      await within(picker()).findByRole('list', { name: 'Why the model was not applied' })
    ).toBeInTheDocument();

    // Check destinations… is the page's own flow, not the picker's write.
    (PrepareGolemDestinationGrants as jest.Mock).mockResolvedValue(consentRequired());
    await userEvent.click(await screen.findByRole('button', { name: 'Check destinations…' }));
    const approve = await screen.findByRole('button', { name: 'Approve 1 destination' });
    expect(picker()).not.toContainElement(approve);
  });

  it('reads Done beside another staged change, and stages without writing', async () => {
    await mount();
    // Stage something else on the page first.
    await userEvent.click(screen.getByRole('button', { name: 'Edit provider llamacpp' }));
    const endpoint = screen.getByLabelText('Endpoint');
    await userEvent.clear(endpoint);
    await userEvent.type(endpoint, 'http://127.0.0.1:8091');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    const fold = await openPicker();
    await userEvent.click(
      optionNamed(within(fold).getByRole('listbox', { name: 'Can run Golem' }), 'zai-org/GLM-5.2')
    );
    await tickApplyAnywayIfAsked(fold);
    expect(within(fold).queryByRole('button', { name: 'Use model' })).toBeNull();
    await userEvent.click(within(fold).getByRole('button', { name: 'Done' }));
    expect(ApplyGolemSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByText(/2 staged changes/)).toBeInTheDocument();
  });
});

describe('Codex round 1', () => {
  it('reads Done when the agent route already holds an edit made in Shared configuration', async () => {
    await mount();
    await userEvent.click(sharedToggle());
    await userEvent.click(screen.getByRole('button', { name: 'Edit route agent' }));
    const editor = screen.getByRole('group', { name: 'Route agent' });
    await userEvent.click(within(editor).getByLabelText(/^thinking/));
    await tickApplyAnywayIfAsked(editor);
    await userEvent.click(within(editor).getByRole('button', { name: 'Done' }));

    const fold = await openPicker();
    const can = () => within(fold).getByRole('listbox', { name: 'Can run Golem' });
    await userEvent.click(optionNamed(can(), 'zai-org/GLM-5.2'));
    expect(within(fold).queryByRole('button', { name: 'Use model' })).toBeNull();
    await userEvent.click(optionNamed(can(), 'qwen3.6:35b-a3b'));
    expect(within(fold).queryByRole('button', { name: 'Use model' })).toBeNull();
    expect(ApplyGolemSettings).not.toHaveBeenCalled();
  });

  it('keeps a hand declaration staged in Shared configuration out of the picker', async () => {
    await mount();
    await userEvent.click(sharedToggle());
    await userEvent.click(screen.getByRole('button', { name: 'Edit route agent' }));
    const editor = screen.getByRole('group', { name: 'Route agent' });
    await userEvent.selectOptions(within(editor).getByLabelText('Provider'), 'commandcode');
    await userEvent.type(within(editor).getByLabelText('Filter models'), 'gpt-9');
    await userEvent.click(within(editor).getByRole('option', { name: /Declare "gpt-9"/ }));
    await userEvent.selectOptions(within(editor).getByLabelText('Type'), 'dense');
    await tickApplyAnywayIfAsked(editor);
    await userEvent.click(within(editor).getByRole('button', { name: 'Done' }));
    expect(screen.getByTestId('golem-model-current').textContent).toContain('gpt-9');

    const fold = await openPicker();
    expect(within(fold).queryByLabelText('Model name')).toBeNull();
    expect(within(fold).queryByLabelText('Type')).toBeNull();
    expect(within(fold).getByTestId('model-detail').textContent).toMatch(
      /gpt-9.*declared in Shared configuration/
    );
    expect(within(fold).queryByRole('button', { name: /Use model|Done/ })).toBeNull();
  });

  it('hands every pointer request to the agent route editor, open or not', async () => {
    await mount();
    const fold = await openPicker();
    const filter = within(fold).getByLabelText('Filter models');
    await userEvent.type(filter, 'gpt-9');
    await userEvent.click(
      within(fold).getByRole('button', { name: 'Add it in Shared configuration' })
    );
    const agentFilter = () =>
      within(screen.getByRole('group', { name: 'Route agent' })).getByLabelText('Filter models');
    expect(agentFilter()).toHaveValue('gpt-9');

    await userEvent.clear(filter);
    await userEvent.type(filter, 'gpt-10');
    await userEvent.click(
      within(fold).getByRole('button', { name: 'Add it in Shared configuration' })
    );
    await waitFor(() => expect(agentFilter()).toHaveValue('gpt-10'));
    await waitFor(() => expect(document.activeElement).toBe(agentFilter()));
  });

  it('lists a model once even when its cards carry different facts', async () => {
    const reload = hybrid();
    const models = reload.projection.models as Array<Record<string, unknown>>;
    reload.projection = {
      ...reload.projection,
      models: models.map((model) =>
        model.role === 'judge' ? { ...model, contextWindow: 8192 } : model
      ),
    };
    await mount(reload);
    const fold = await openPicker();
    const can = within(fold).getByRole('listbox', { name: 'Can run Golem' });
    expect(optionNames(can).filter((name) => name === 'gemma4:31b')).toHaveLength(1);
    await userEvent.click(optionNamed(can, 'gemma4:31b'));
    await userEvent.click(within(fold).getByRole('button', { name: 'Details of gemma4:31b' }));
    expect(within(fold).getByText(/1 of 3 cards for this model says yes/)).toBeInTheDocument();
  });
});

describe('Codex round 2: the picker and the agent route editor stay in step', () => {
  const editAgent = async () => {
    if (sharedToggle().getAttribute('aria-expanded') !== 'true')
      await userEvent.click(sharedToggle());
    if (screen.queryByRole('group', { name: 'Route agent' }) === null)
      await userEvent.click(screen.getByRole('button', { name: 'Edit route agent' }));
    return screen.getByRole('group', { name: 'Route agent' });
  };
  const can = () => within(picker()).getByRole('listbox', { name: 'Can run Golem' });

  it('never sends a Shared configuration edit the user withdrew', async () => {
    await mount();
    await openPicker();
    // Stage thinking and Think `always` on the current model in Shared configuration.
    let editor = await editAgent();
    await userEvent.click(within(editor).getByLabelText(/^thinking/));
    await userEvent.selectOptions(within(editor).getByLabelText('Think mode'), 'always');
    await tickApplyAnywayIfAsked(editor);
    await userEvent.click(within(editor).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('1 staged change')).toBeInTheDocument();
    // Walk the picker away and back.
    await userEvent.click(optionNamed(can(), 'zai-org/GLM-5.2'));
    await userEvent.click(optionNamed(can(), 'qwen3.6:35b-a3b'));
    // Withdraw the edit in Shared configuration: the draft is empty again.
    editor = await editAgent();
    await userEvent.click(within(editor).getByLabelText(/^thinking/));
    await userEvent.click(within(editor).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('group', { name: 'Route agent' })).toBeNull();
    expect(screen.queryByText(/staged change/)).toBeNull();

    // The picker holds nothing the user did not pick there.
    expect(within(picker()).queryByRole('button', { name: 'Use model' })).toBeNull();
    await userEvent.click(optionNamed(can(), 'zai-org/GLM-5.2'));
    (ApplyGolemSettings as jest.Mock).mockResolvedValue({
      status: 'diagnostics',
      diagnostics: [],
      consentOutcome: 'unchanged',
    });
    await tickApplyAnywayIfAsked(picker());
    await userEvent.click(within(picker()).getByRole('button', { name: 'Use model' }));
    await waitFor(() => expect(ApplyGolemSettings).toHaveBeenCalledTimes(1));
    expect(lastApply().changes).toEqual(pinnedRequest().changes);
  });

  it('lets the picker restore the model a Shared configuration edit replaced', async () => {
    await mount();
    await openPicker();
    const editor = await editAgent();
    await userEvent.selectOptions(within(editor).getByLabelText('Provider'), 'commandcode');
    await userEvent.click(optionNamed(within(editor).getByRole('listbox'), 'zai-org/GLM-5.2'));
    await tickApplyAnywayIfAsked(editor);
    await userEvent.click(within(editor).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('1 staged change')).toBeInTheDocument();

    // The picker reads the staged pick and can put the applied model back.
    expect(optionNamed(can(), 'zai-org/GLM-5.2')).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(optionNamed(can(), 'qwen3.6:35b-a3b'));
    await userEvent.click(within(picker()).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('1 staged change')).toBeNull();
    expect(screen.getByTestId('golem-model-current').textContent).toBe(
      'qwen3.6:35b-a3b via llamacpp'
    );
  });

  it('lets the agent route editor restore the model the picker replaced', async () => {
    await mount();
    // Something else staged, so the picker reads Done and only stages.
    await userEvent.click(screen.getByRole('button', { name: 'Edit provider llamacpp' }));
    const endpoint = screen.getByLabelText('Endpoint');
    await userEvent.clear(endpoint);
    await userEvent.type(endpoint, 'http://127.0.0.1:8091');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    let editor = await editAgent();

    await openPicker();
    await userEvent.click(optionNamed(can(), 'zai-org/GLM-5.2'));
    await tickApplyAnywayIfAsked(picker());
    await userEvent.click(within(picker()).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('2 staged changes')).toBeInTheDocument();

    // The open route editor now reads the staged pick and can put qwen back.
    editor = screen.getByRole('group', { name: 'Route agent' });
    await userEvent.selectOptions(within(editor).getByLabelText('Provider'), 'llamacpp');
    await userEvent.click(optionNamed(within(editor).getByRole('listbox'), 'qwen3.6:35b-a3b'));
    await userEvent.click(within(editor).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('1 staged change')).toBeInTheDocument();
  });
});

describe('a model the picker does not list', () => {
  it('points to Shared configuration and opens the agent route editor on that name', async () => {
    await mount();
    const fold = await openPicker();
    await userEvent.type(within(fold).getByLabelText('Filter models'), 'gpt-9');
    expect(within(fold).getByText(/Not listed\?/)).toBeInTheDocument();
    await userEvent.click(
      within(fold).getByRole('button', { name: 'Add it in Shared configuration' })
    );
    expect(sharedToggle()).toHaveAttribute('aria-expanded', 'true');
    const agentEditor = screen.getByRole('group', { name: 'Route agent' });
    const filter = within(agentEditor).getByLabelText('Filter models');
    expect(filter).toHaveValue('gpt-9');
    await waitFor(() => expect(document.activeElement).toBe(filter));
  });
});

describe('Shared configuration', () => {
  it('is a folded disclosure holding the routing table in two groups', async () => {
    await mount();
    const toggle = sharedToggle();
    expect(toggle).toHaveAttribute('type', 'button');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(toggle);

    const used = screen.getByRole('table', { name: 'Used by Firn' });
    const agentRow = within(used).getByTestId('route-row-agent');
    expect(within(agentRow).getByText('Golem chat and commit messages')).toBeInTheDocument();
    expect(within(agentRow).getByTestId('route-role').textContent).toBe('role fast');
    expect(
      within(agentRow).getByText('Firn sends only to the first; the golem CLI uses the rest')
    ).toBeInTheDocument();
    expect(within(agentRow).getByTestId('route-chain').textContent).toBe(
      'Falls back to lightweight, cc-coder, cc-pro, cc-flash, cc-mimo'
    );

    const others = screen.getByRole('table', { name: 'Other configured routes' });
    expect(within(others).queryByTestId('route-row-agent')).toBeNull();
    // An unknown key reads as its key, with no invented consumer.
    const review = within(others).getByTestId('route-row-code-review');
    expect(review.textContent).toContain('code-review');
    expect(review.textContent).not.toMatch(/CLI feature/);
    expect(within(review).getByTestId('route-chain').textContent).toBe(
      'Falls back to cc-grok, cc-luna'
    );
  });

  it("writes the picker's document through today's route editor and Apply", async () => {
    const reload = hybrid();
    await mount(reload);
    await userEvent.click(sharedToggle());
    await userEvent.click(screen.getByRole('button', { name: 'Edit route agent' }));
    const editor = screen.getByRole('group', { name: 'Route agent' });
    await userEvent.selectOptions(within(editor).getByLabelText('Provider'), 'commandcode');
    await userEvent.click(optionNamed(within(editor).getByRole('listbox'), 'zai-org/GLM-5.2'));
    await tickApplyAnywayIfAsked(editor);
    await userEvent.click(within(editor).getByRole('button', { name: 'Done' }));
    (ApplyGolemSettings as jest.Mock).mockResolvedValue({
      status: 'diagnostics',
      diagnostics: [],
      consentOutcome: 'unchanged',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(ApplyGolemSettings).toHaveBeenCalledTimes(1));
    expect(lastApply().changes).toEqual(pinnedRequest().changes);
  });
});

describe('a read-only configuration', () => {
  it('disables Change and every Shared configuration edit, with the reason as text', async () => {
    const reload = hybrid();
    reload.projection = {
      ...reload.projection,
      state: 'limited',
      readOnly: true,
      diagnostics: [
        {
          code: 'duplicate_keys',
          subjectKind: 'provider',
          subjectName: 'llamacpp',
          blocking: false,
        },
      ],
    };
    await mount(reload);
    const change = changeButton();
    expect(change).toHaveAttribute('aria-disabled', 'true');
    const reason = document.getElementById(change.getAttribute('aria-describedby')!)!;
    expect(reason).toBeVisible();
    expect(reason.textContent).toMatch(/read-only/);
    await userEvent.click(change);
    expect(change).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(sharedToggle());
    expect(screen.queryByRole('button', { name: /Edit route/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Assign/ })).toBeNull();
  });
});

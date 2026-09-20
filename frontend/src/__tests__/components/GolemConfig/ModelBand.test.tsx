import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ModelBand,
  buildModelRows,
  type ModelBandProps,
} from '../../../components/GolemConfig/ModelBand';
import { CAPABILITY_NAMES, type CapabilityName, type ModelProjection } from '../../../types/golem';
import { floorShortfalls } from '../../../types/golemConfig';

const model = (over: Partial<ModelProjection> = {}): ModelProjection => ({
  role: 'chat-role',
  modelName: 'gpt-5-mini',
  provider: 'hosted',
  type: 'dense',
  effectiveCapabilities: ['chat', 'stream'],
  capabilityFacts: { caps: ['chat', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
  exposedCapabilities: ['chat', 'stream'],
  thinkMode: '',
  routedUseCases: ['chat'],
  hasThinkTags: false,
  hasSlots: false,
  removable: false,
  ...over,
});

const agentModel = model({
  role: 'agent-role',
  modelName: 'gpt-5',
  effectiveCapabilities: ['chat', 'stream', 'tool_call'],
  capabilityFacts: { caps: ['chat', 'stream', 'tool_call'], knownCaps: [...CAPABILITY_NAMES] },
  exposedCapabilities: ['chat', 'stream', 'tool_call'],
});

const embedModel = model({
  role: 'embed-role',
  modelName: 'nomic-embed',
  effectiveCapabilities: ['embed'],
  capabilityFacts: { caps: ['embed'], knownCaps: [...CAPABILITY_NAMES] },
  exposedCapabilities: ['embed'],
});

function renderBand(over: Partial<ModelBandProps> = {}) {
  const onSelect = jest.fn();
  const onManual = jest.fn();
  const onProviderChange = jest.fn();
  const props: ModelBandProps = {
    id: 'route-editor-chat',
    useCase: 'chat',
    floor: ['chat', 'stream'] as readonly CapabilityName[],
    required: ['chat', 'stream'] as readonly CapabilityName[],
    shortfalls: (candidate) => floorShortfalls(candidate.exposedCapabilities, ['chat']),
    models: [model(), agentModel, embedModel],
    provider: 'hosted',
    providers: [
      {
        name: 'hosted',
        endpoint: 'https://api.example.com/v1',
        classification: 'remote',
        apiFormat: 'openai-compat',
        credentialState: 'available',
      },
    ],
    selected: null,
    manual: null,
    routes: [],
    owners: ['chat'],
    // A card previews against its OWN floor; a fixture that cares passes its own.
    preview: () => ({ required: [], owners: [], offered: [] }),
    onProviderChange,
    onSelect,
    onManual,
    ...over,
  };
  const view = render(<ModelBand {...props} />);
  return { ...view, onSelect, onManual, onProviderChange, props };
}

// jsdom has no layout, so Element.scrollIntoView is undefined; the band calls
// it to keep the strip on screen. Stubbing it here is also what lets the
// scroll-mitigation test assert the call.
beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const cards = () => within(screen.getByRole('listbox', { name: /Models/ })).getAllByRole('option');
const cardNamed = (name: string) =>
  cards().find((card) => within(card).queryByText(name) !== null) as HTMLElement;

// ---------------------------------------------------------------------------
// Uniform compact cards, always. Treatment 1 removes in-cell expansion: a card
// is two or three ONE-LINE rows — name, the numbers or the abilities, then the
// note or the abilities — so a grid row can never inflate and the geometry
// never moves under the cursor. The popup and the strip carry the rest.
// ---------------------------------------------------------------------------

describe('ModelBand compact cards', () => {
  it('shows name, type badge, params and context, and never capability chips', () => {
    renderBand({
      models: [model({ parameters: '30B-A3B', contextWindow: 262144 })],
      selected: model({ parameters: '30B-A3B', contextWindow: 262144 }),
    });
    const card = cardNamed('gpt-5-mini');

    expect(within(card).getByText('gpt-5-mini')).toBeVisible();
    expect(within(card).getByText('dense')).toBeVisible();
    // The metadata row after the badge, joined per the mockup — the context
    // human-scale. NO `title`: the popup this card opens on the very same hover
    // carries the exact count, and two tooltips on one target is one too many.
    expect(within(card).getByText('30B-A3B · 256K ctx')).toBeVisible();
    expect(card.querySelector('[title]')).toBeNull();
    // Even the assigned card stays compact.
    expect(within(card).queryByText('stream')).not.toBeInTheDocument();
  });

  it('keeps the exact count on a blocked card, which has no popup to carry it', async () => {
    renderBand({ models: [model(), { ...embedModel, contextWindow: 262144 }] });
    await userEvent.click(screen.getByRole('button', { name: /show it/ }));
    const blocked = cardNamed('nomic-embed');
    expect(within(blocked).getByText('256K ctx')).toHaveAttribute('title', '262144 tokens');
  });

  it('formats the detail readout context exactly like the card', () => {
    renderBand({
      models: [model({ contextWindow: 262144 })],
      selected: model({ contextWindow: 262144 }),
    });
    const strip = screen.getByTestId('model-detail');

    // One facts line in the strip head, the same line the card carries; the
    // exact count lives in the card's popup, not in two places here.
    expect(within(strip).getByText('256K ctx')).toBeVisible();
    expect(within(strip).queryByText('262144')).not.toBeInTheDocument();
    expect(within(cardNamed('gpt-5-mini')).getByText('256K ctx')).toBeVisible();
  });

  it('gives a numberless card its abilities on line 2 and the note on line 3', () => {
    renderBand({
      models: [model({ modelName: 'deepseek-v4-pro', description: 'Mid-tier generalist.' })],
    });
    const card = screen.getByRole('option', { name: /deepseek-v4-pro/ });
    expect(within(card).getByText('dense')).toBeInTheDocument();
    expect(within(card).getByText('chat stream')).toBeInTheDocument();
    expect(within(card).getByText('Mid-tier generalist.')).toBeInTheDocument();
    expect(within(card).queryByText(/used by/)).toBeNull();
    expect(card.querySelector('[title]')).toBeNull();
  });

  it('puts the numbers on line 2 and the abilities on line 3 when there is no note', () => {
    renderBand({
      models: [model({ modelName: 'gemma4:31b', parameters: '31B', contextWindow: 256000 })],
    });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    expect(within(card).getByText('31B · 256K ctx')).toBeInTheDocument();
    expect(within(card).getByText('chat stream')).toBeInTheDocument();
  });

  it('omits an absent fact entirely — no dash, no unknown, no stray separator', () => {
    // Context window undefined: the params segment stands alone.
    renderBand({ models: [model({ parameters: '30B-A3B' })] });
    const card = cardNamed('gpt-5-mini');

    expect(within(card).getByText('30B-A3B')).toBeVisible();
    expect(card.textContent).not.toMatch(/ctx|·|—|unknown/);
  });

  it('keeps the metadata row with no facts at all: the abilities take their place', () => {
    renderBand({ models: [model()] });
    const card = cardNamed('gpt-5-mini');

    expect(within(card).getByText('dense')).toBeVisible();
    // The abilities move up beside the badge — nothing stands in for the absent
    // numbers, and the card never repeats its abilities on a third line.
    expect(card.textContent).toBe('gpt-5-minidensechat stream');
  });
});

// ---------------------------------------------------------------------------
// 2D keyboard navigation across the grid
// ---------------------------------------------------------------------------

describe('ModelBand keyboard navigation', () => {
  it('moves across the grid with the arrows and selects on Enter', async () => {
    const { onSelect } = renderBand();
    act(() => cards()[0].focus());

    // Cards are role-alpha, so agent-role (gpt-5) leads and owns the tab stop.
    expect(cardNamed('gpt-5')).toHaveAttribute('tabindex', '0');
    await userEvent.keyboard('{ArrowRight}');
    expect(cardNamed('gpt-5-mini')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(cardNamed('gpt-5')).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(agentModel);
  });

  it('steps by a row with ArrowDown and ArrowUp', async () => {
    const { onSelect } = renderBand();
    act(() => cards()[0].focus());

    // jsdom reports every offsetTop as 0, so the grid measures one column and a
    // row step is a single card. In a browser it is the real column count.
    await userEvent.keyboard('{ArrowDown}');
    expect(cardNamed('gpt-5-mini')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(cardNamed('gpt-5')).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(agentModel);
  });

  it('never walks past either end of the grid', async () => {
    renderBand();
    act(() => cards()[0].focus());

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(cardNamed('gpt-5')).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    // Two eligible models here, so the last stop is the declare-free end.
    expect(cards().at(-1)).toHaveFocus();
  });

  it('never steals focus from the filter after a clamped step past the end', async () => {
    renderBand();
    act(() => cards()[0].focus());

    // A real move consumes the focus flag; the clamped step at the end must
    // not re-arm it — the stale flag used to fire on the filter's first
    // keystroke (which resets the active index) and yank focus onto the grid.
    await userEvent.keyboard('{ArrowRight}');
    expect(cardNamed('gpt-5-mini')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(cardNamed('gpt-5-mini')).toHaveFocus();

    const filter = screen.getByLabelText('Filter models');
    await userEvent.click(filter);
    await userEvent.type(filter, 'g');
    expect(filter).toHaveFocus();
  });
});

// ---------------------------------------------------------------------------
// Slice D seam (types only — no inventory call today)
// ---------------------------------------------------------------------------

describe('buildModelRows', () => {
  it('scopes rows to the provider and marks every one authored today', () => {
    const rows = buildModelRows([model(), agentModel, model({ provider: 'other' })], 'hosted');

    // Role-alpha within the provider: the shared display order.
    expect(rows.map((row) => row.model.modelName)).toEqual(['gpt-5', 'gpt-5-mini']);
    expect(rows.every((row) => row.provenance === 'authored')).toBe(true);
  });

  it('collapses roles with identical facts into one row carrying every role and note, in role order', () => {
    const rows = buildModelRows(
      [
        model({ role: 'general', modelName: 'gemma4:31b', description: 'Dense reasoning.' }),
        model({ role: 'agent', modelName: 'gemma4:31b', description: 'Agent / tool-use.' }),
        model({ role: 'judge', modelName: 'gemma4:31b' }),
      ],
      'hosted'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].model.role).toBe('general'); // first seen keeps the card's identity, as before
    expect(rows[0].roles).toEqual(['agent', 'general', 'judge']);
    expect(rows[0].descriptions).toEqual([
      { role: 'agent', description: 'Agent / tool-use.' },
      { role: 'general', description: 'Dense reasoning.' },
    ]);
  });

  it("orders a row's roles by the projection's own byte order, not UTF-16", () => {
    // Escapes on purpose: U+FF21 (FULLWIDTH LATIN CAPITAL LETTER A) is a
    // homoglyph of a plain A and would be unreadable raw, and U+1F600 (GRINNING
    // FACE) is a surrogate pair. U+FF21 sorts BEFORE U+1F600 in UTF-8 bytes
    // (EF BC A1 < F0 9F 98 80) and AFTER it in UTF-16 code units, where the pair
    // starts at D83D. Which note lands on the card rides on this, so it has to
    // be compareString's order — the same the Go projection emits.
    const rows = buildModelRows(
      [
        model({ role: 'x\uD83D\uDE00', modelName: 'gemma4:31b', description: 'Emoji role.' }),
        model({ role: 'x\uFF21', modelName: 'gemma4:31b', description: 'Fullwidth role.' }),
      ],
      'hosted'
    );
    expect(rows[0].roles).toEqual(['x\uFF21', 'x\uD83D\uDE00']);
    expect(rows[0].descriptions.map((note) => note.description)).toEqual([
      'Fullwidth role.',
      'Emoji role.',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Locked semantics carried over from the combobox picker (§4.4)
// ---------------------------------------------------------------------------

describe('ModelBand floor filter', () => {
  it('shows only models meeting the floor and names the filter', () => {
    renderBand();

    expect(screen.getByText('filter: chat · stream')).toBeVisible();
    expect(screen.getByText(/every card below can serve chat/)).toBeVisible();
    expect(cards().map((card) => within(card).getByText(/gpt|nomic/).textContent)).toEqual([
      'gpt-5',
      'gpt-5-mini',
    ]);
  });

  it('names the empty filter when the use case has no Firn floor', () => {
    renderBand({ floor: [] });
    expect(screen.getByText('filter: none')).toBeVisible();
  });

  it('reveals the hidden models with a reason chip per failing capability', async () => {
    renderBand();
    const line = screen.getByRole('button', { name: /is not eligible/ });
    expect(line).toHaveTextContent('1 model');

    await userEvent.click(line);
    const blocked = cardNamed('nomic-embed');
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(within(blocked).getByText('✕ chat')).toBeVisible();
    expect(within(blocked).getByText('✕ stream')).toBeVisible();
    expect(within(blocked).getByText('chat needs chat; chat needs stream')).toBeVisible();

    // One hidden model: the toggle agrees in number — "it", not "them".
    await userEvent.click(screen.getByRole('button', { name: /hide it/ }));
    expect(cards().some((card) => within(card).queryByText('nomic-embed') !== null)).toBe(false);
    expect(screen.getByRole('button', { name: /show it/ })).toBeInTheDocument();
  });

  it('hides a card that serves the edited use case but fails a sibling floor, naming the sibling', async () => {
    // The caller's verdict says every card governs agent too: each must carry
    // tool_call, while the headline still names only the use case being routed.
    renderBand({
      floor: ['chat', 'stream', 'tool_call'],
      required: ['chat', 'stream', 'tool_call'],
      shortfalls: (candidate) => floorShortfalls(candidate.exposedCapabilities, ['chat', 'agent']),
    });
    expect(screen.getByText('Model — every card below can serve chat')).toBeVisible();
    expect(screen.getByText('filter: chat · stream · tool_call')).toBeVisible();
    expect(cards().map((card) => within(card).getByText(/gpt|nomic/).textContent)).toEqual([
      'gpt-5',
    ]);

    await userEvent.click(screen.getByRole('button', { name: /2 models are not eligible/ }));
    const blocked = cardNamed('gpt-5-mini');
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(within(blocked).getByText('agent needs tool_call')).toBeVisible();
    expect(within(blocked).getByText('✕ tool_call')).toBeVisible();
  });

  it('asks the verdict per card, so a selector sibling can block one card only', async () => {
    // The verdict is the caller's: here gpt-5-mini's own selector serves agent.
    renderBand({
      shortfalls: (candidate) =>
        candidate.modelName === 'gpt-5-mini'
          ? [{ cap: 'tool_call', useCases: ['agent'] }]
          : floorShortfalls(candidate.exposedCapabilities, ['chat']),
    });
    expect(screen.getByText('Model — every card below can serve chat')).toBeVisible();
    expect(cards().map((card) => within(card).getByText(/gpt|nomic/).textContent)).toEqual([
      'gpt-5',
    ]);
    await userEvent.click(screen.getByRole('button', { name: /show them/ }));
    expect(within(cardNamed('gpt-5-mini')).getByText('agent needs tool_call')).toBeVisible();
    expect(
      within(cardNamed('nomic-embed')).getByText('chat needs chat; chat needs stream')
    ).toBeVisible();
  });

  it('narrows the grid as the filter is typed', async () => {
    renderBand();
    await userEvent.type(screen.getByLabelText('Filter models'), 'mini');
    // One match, plus the declare card a partial name always pins.
    expect(within(cards()[0]).getByText('gpt-5-mini')).toBeVisible();
    expect(cards()).toHaveLength(2);
    expect(cards()[1]).toHaveTextContent('Declare "mini"');
  });

  it('keeps same-named models apart when their facts differ', () => {
    const small = model({ role: 'small-role', parameters: '7b' });
    const large = model({ role: 'large-role', parameters: '70b' });
    renderBand({ models: [small, large] });

    expect(cards()).toHaveLength(2);
    expect(within(cards()[0]).getByText(/70b/)).toBeVisible();
  });
});

describe('ModelBand declare path', () => {
  it('pins a declare card for a name nothing matches and opens the facts editor', async () => {
    const { onManual } = renderBand();
    await userEvent.type(screen.getByLabelText('Filter models'), 'llama-4');

    const declare = screen.getByRole('option', { name: /Declare "llama-4"/ });
    expect(within(declare).getByText(/no exact match/)).toBeVisible();

    await userEvent.click(declare);
    // Floor caps come pre-declared; the type stays unchosen (§4.4).
    expect(onManual).toHaveBeenCalledWith(
      {
        model: 'llama-4',
        type: '',
        caps: ['chat', 'stream'],
      },
      true
    );
  });

  it('offers no declare card once the typed name matches exactly', async () => {
    renderBand();
    await userEvent.type(screen.getByLabelText('Filter models'), 'gpt-5-mini');
    expect(screen.queryByRole('option', { name: /Declare/ })).not.toBeInTheDocument();
  });

  it('renders the manual fields with the floor capabilities pre-checked and locked', () => {
    renderBand({ manual: { model: '', type: '', caps: ['chat', 'stream'] } });

    // The fieldset sits BENEATH the grid, never replacing it: Done demands a
    // provider, so its control has to stay on screen while declaring.
    expect(screen.getByRole('listbox', { name: /Models/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Provider')).toBeInTheDocument();
    const manual = screen.getByRole('group', { name: 'Enter a model manually' });
    expect(within(manual).getByLabelText('Model name')).toHaveValue('');
    expect(within(manual).getByLabelText('Type')).toHaveValue('');

    const caps = within(manual).getByRole('group', { name: 'Capabilities this model supports' });
    // Direct child of the form, then the hint and the Back button: what
    // `.manual`'s block-flow spacing rule addresses.
    expect(manual.firstElementChild?.tagName).toBe('LEGEND');
    expect(caps.parentElement).toBe(manual);
    expect(caps.nextElementSibling).toHaveTextContent("This becomes the model's card.");
    const back = caps.nextElementSibling?.nextElementSibling;
    expect(back).toHaveTextContent('Back to the model list');
    expect(back).toHaveClass('button');
    for (const locked of ['chat', 'stream']) {
      const box = within(caps).getByRole('checkbox', { name: `${locked}, required` });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    expect(within(caps).getByRole('checkbox', { name: 'tool_call' })).not.toBeChecked();
    // Same chip grammar as the route editor's exposure: wrapping groups, the
    // requirement carried by the group's name and by the chip's own.
    expect(caps.querySelector('.abilityColumns')).not.toBeNull();
    const chat = within(caps).getByRole('checkbox', { name: 'chat, required' });
    expect(chat.closest('.abilityGroup')).toHaveAccessibleName('Required by chat');
    expect(chat.nextElementSibling?.querySelector('.abilityChipName')).toHaveTextContent('chat');
  });

  it('reports every manual edit as complete facts in canonical order', async () => {
    const { onManual } = renderBand({
      manual: { model: '', type: '', caps: ['chat', 'stream'] },
    });

    await userEvent.type(screen.getByLabelText('Model name'), 'q');
    expect(onManual).toHaveBeenLastCalledWith({ model: 'q', type: '', caps: ['chat', 'stream'] });

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'moe');
    expect(onManual).toHaveBeenLastCalledWith({ model: '', type: 'moe', caps: ['chat', 'stream'] });

    await userEvent.click(screen.getByLabelText('tool_call'));
    expect(onManual).toHaveBeenLastCalledWith({
      model: '',
      type: '',
      caps: ['chat', 'stream', 'tool_call'],
    });
  });

  it('returns to the grid from the facts editor', async () => {
    const { onManual } = renderBand({
      manual: { model: 'llama-4', type: 'dense', caps: ['chat', 'stream'] },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Back to the model list' }));
    expect(onManual).toHaveBeenCalledWith(null);
  });

  it('marks the required caps of the current candidate in the declare form, locking only what is declared', async () => {
    // The candidate's selector serves agent: tool_call is required, but a
    // declaration is what the user asserts — an undeclared cap stays unchecked
    // and enabled, marked (required); a declared one locks. The band
    // still filters on chat's floor.
    const { onManual } = renderBand({
      required: ['chat', 'stream', 'tool_call'],
      owners: ['chat', 'agent'],
      manual: { model: 'gpt-5', type: '', caps: ['chat', 'stream'] },
    });
    const declared = screen.getByRole('group', { name: 'Capabilities this model supports' });
    // An unticked required chip names no requirement of its own: the REQUIRED
    // group it sits in carries that, and only a locked chip says ", required".
    const required = within(declared).getByRole('group', { name: 'Required by chat and agent' });
    expect(within(required).getByRole('checkbox', { name: 'tool_call' })).not.toBeChecked();
    expect(within(required).getByRole('checkbox', { name: 'tool_call' })).toBeEnabled();
    expect(within(required).getByRole('checkbox', { name: 'chat, required' })).toBeChecked();
    expect(within(required).getByRole('checkbox', { name: 'chat, required' })).toBeDisabled();
    expect(screen.getByText('filter: chat · stream')).toBeVisible();
    // A fresh declaration still starts from the band floor alone.
    await userEvent.type(screen.getByLabelText('Filter models'), 'llama-4');
    await userEvent.click(screen.getByRole('option', { name: /Declare "llama-4"/ }));
    expect(onManual).toHaveBeenLastCalledWith(
      {
        model: 'llama-4',
        type: '',
        caps: ['chat', 'stream'],
      },
      true
    );
  });
});

describe('ModelBand provider', () => {
  it('scopes the grid to the chosen provider and reports a change', async () => {
    const { onProviderChange } = renderBand({
      models: [model(), model({ role: 'lan-role', modelName: 'local-7b', provider: 'lan' })],
      providers: [
        {
          name: 'hosted',
          endpoint: 'https://api.example.com/v1',
          classification: 'remote',
          apiFormat: 'openai-compat',
          credentialState: 'available',
        },
        {
          name: 'lan',
          endpoint: 'http://127.0.0.1:9292/v1',
          classification: 'local',
          apiFormat: 'openai-compat',
          credentialState: 'none',
        },
      ],
    });

    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]).getByText('gpt-5-mini')).toBeVisible();

    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'lan');
    expect(onProviderChange).toHaveBeenCalledWith('lan');
  });
});

// ---------------------------------------------------------------------------
// Invariants the combobox picker guarded, restored on the band
// ---------------------------------------------------------------------------

describe('ModelBand row identity', () => {
  // `models` is one entry per ROLE. Two roles naming the same model with
  // byte-identical facts are one CHOICE, and rendering both gave two cards a
  // shared React key and a shared answer to "is this the selected one".
  it('collapses two roles that declare byte-identical facts', () => {
    const first = model({ role: 'first-role', parameters: '7b' });
    const second = model({ role: 'second-role', parameters: '7b' });
    renderBand({ models: [first, second], selected: first });

    expect(cards()).toHaveLength(1);
    expect(cards().filter((card) => card.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('keeps the dedup in the row builder, where Slice D will union too', () => {
    const rows = buildModelRows(
      [model({ role: 'first-role' }), model({ role: 'second-role' })],
      'hosted'
    );
    expect(rows).toHaveLength(1);
  });
});

describe('ModelBand announcements', () => {
  // The filter was silent to assistive tech once the old picker's live region
  // went with it.
  it('announces how many models the filter left', async () => {
    renderBand();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('2 models match this filter');

    await userEvent.type(screen.getByLabelText('Filter models'), 'mini');
    expect(status).toHaveTextContent('1 model matches this filter');
  });
});

describe('ModelBand Home and End', () => {
  // §4.7 names Home/End beside the arrows.
  it('jumps to the first and last card in the walk', async () => {
    renderBand();
    act(() => cards()[0].focus());

    await userEvent.keyboard('{End}');
    expect(cards().at(-1)).toHaveFocus();

    await userEvent.keyboard('{Home}');
    expect(cards()[0]).toHaveFocus();
  });
});

// ---------------------------------------------------------------------------
// Structural guard: jest maps CSS-module keys to themselves (identity-obj-proxy),
// so a class that exists in NO stylesheet still "works" in these tests and
// renders unstyled in the real build. This is the only place that catches it.
// ---------------------------------------------------------------------------

describe('ModelBand stylesheet coverage', () => {
  it('resolves every styles.* reference in the tree against the shared module', () => {
    const dir = path.resolve(__dirname, '../../../components/GolemConfig');
    const css = fs.readFileSync(path.join(dir, 'GolemConfig.module.css'), 'utf8');
    // Every component that imports the shared module, discovered rather than
    // listed: a new consumer joins the guard the day it is written.
    const sources = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')] as const)
      .filter(([, source]) => source.includes("from './GolemConfig.module.css'"));
    expect(sources.length).toBeGreaterThan(5);

    for (const [name, source] of sources) {
      const used = [...source.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
      const missing = [...new Set(used)].filter(
        (className) => !new RegExp(`\\.${className}[\\s,{:[]`).test(css)
      );
      expect({ file: name, missing }).toEqual({ file: name, missing: [] });
    }
  });
  // The grid is the one deliberate scroll region: bounded so the editor has a
  // predictable height, with a partial fourth row as the scroll affordance. The
  // strip must NOT be sticky — that overlaid the last card row and gave the
  // band a second scroll context fighting the workspace scroll.
  it('bounds the grid at three card rows and leaves the strip in normal flow', () => {
    const dir = path.resolve(__dirname, '../../../components/GolemConfig');
    const css = fs.readFileSync(path.join(dir, 'GolemConfig.module.css'), 'utf8');
    const grid = css.match(/\.modelGrid \{[^}]*\}/s)?.[0] ?? '';
    const detail = css.match(/\.detail \{[^}]*\}/s)?.[0] ?? '';

    expect(grid).toMatch(/--golem-card-height: 80px/);
    expect(grid).toMatch(
      /max-height: calc\(3 \* var\(--golem-card-height\) \+ 2 \* var\(--golem-grid-gap\) \+ 20px\)/
    );
    expect(grid).toMatch(/overflow-y: auto/);
    expect(detail).not.toMatch(/position: sticky/);
  });

  // rev 7 retires the strip's facts half with the checkbox grid that lived in
  // it: the capabilities are chips in a wrapping row of block groups, the facts
  // are one line in the strip head, and the card's own readout is a sentence.
  // Every rule those three replaced has to be GONE, or it goes on styling
  // something by accident the day a class name comes back.
  it('lays the ability chips out as a wrapping row of block groups, and the old strip rules are gone', () => {
    const dir = path.resolve(__dirname, '../../../components/GolemConfig');
    const css = fs.readFileSync(path.join(dir, 'GolemConfig.module.css'), 'utf8');
    const columns = css.match(/^\.abilityColumns \{[^}]*\}/ms)?.[0] ?? '';
    const group = css.match(/^\.abilityGroup \{[^}]*\}/ms)?.[0] ?? '';
    const face = css.match(/^\.abilityChipFace \{[^}]*\}/ms)?.[0] ?? '';
    const on = css.match(/^\.abilityChipInput:checked \+ \.abilityChipFace \{[^}]*\}/ms)?.[0] ?? '';
    const locked =
      css.match(/^\.abilityChipInput:checked:disabled \+ \.abilityChipFace \{[^}]*\}/ms)?.[0] ?? '';
    const readonly =
      css.match(
        /^\.abilityChips\[data-readonly\] \.abilityChipInput:checked \+ \.abilityChipFace \{[^}]*\}/ms
      )?.[0] ?? '';
    const pop = css.match(/^\.cardPop \{[^}]*\}/ms)?.[0] ?? '';

    expect(columns).toMatch(/display: flex;\s*flex-wrap: wrap/);
    expect(columns).not.toMatch(/grid/);
    expect(group).toMatch(/flex: 0 1 auto;\s*min-width: 0;\s*max-width: 100%/);
    expect(face).toMatch(/white-space: nowrap/);
    expect(css.match(/^\.abilityChipName \{[^}]*\}/ms)?.[0] ?? '').toMatch(
      /min-width: 0;\s*overflow: hidden;\s*text-overflow: ellipsis/
    );
    expect(on).toMatch(/background-color: var\(--accent\);\s*color: var\(--text-on-accent\)/);
    expect(locked).toMatch(
      /background-color: var\(--accent-dark\);\s*color: var\(--text-on-accent-dark\)/
    );
    expect(readonly).toMatch(/background-color: var\(--accent\)/);
    expect(css).toMatch(
      /\.abilityChip\[data-asserted\] \.abilityChipFace::after \{\s*content: '\*'/
    );
    expect(pop).toMatch(/position: fixed/);
    expect(pop).toMatch(/max-height: calc\(100vh - 16px\);\s*overflow: auto/);
    expect(pop).not.toMatch(/pointer-events: none/);
    // Portaled to document.body (#263 final fix I-2 / final2): it competes in
    // the root stacking context, above the in-app chrome and below the Toast
    // layer so an asynchronous alert always stays reachable over an open popup.
    expect(pop).toMatch(/z-index: 400/);
    // Cross-module guard: the popup must stay under the Toast layer, numerically
    // — not just "some value below 500" pinned by hand, which would silently
    // stop meaning anything the day either file's number moves.
    const toastCss = fs.readFileSync(
      path.resolve(__dirname, '../../../components/Toast/Toast.module.css'),
      'utf8'
    );
    const toastRoot = toastCss.match(/^\.toast \{[^}]*\}/ms)?.[0] ?? '';
    const cardPopZ = Number(pop.match(/z-index:\s*(\d+)/)?.[1]);
    const toastZ = Number(toastRoot.match(/z-index:\s*(\d+)/)?.[1]);
    expect(cardPopZ).toBeGreaterThan(0); // fails loudly if .cardPop's z-index vanishes
    expect(toastZ).toBeGreaterThan(0); // fails loudly if .toast's z-index vanishes
    expect(cardPopZ).toBeLessThan(toastZ); // named in the failure: e.g. "Received: 1000, Expected: < 500"
    // Only a card with a popup ellipsises: a blocked card and the declare card
    // have none, so their text has to wrap.
    for (const selector of ['.modelName', '.modelCardFacts'])
      expect(css).toContain(
        `.modelCard:not(.modelCardBlocked):not(.modelCardDeclare) ${selector} {`
      );
    // The note's own margin reset must not out-order the sibling spacing: equal
    // specificity, so the later rule wins and the notes need the 12px.
    expect(css.indexOf('.detailBody > * + * {')).toBeGreaterThan(css.indexOf('.detailNote {'));
    // Retired with the facts half.
    for (const gone of [
      '.capabilityGrid',
      '.detailDeclares',
      '.capChipFloor',
      '.detailStats',
      '.detailExposure',
      '.detailBody[data-split]',
      '.requiredTag',
    ])
      expect(css).not.toContain(gone);
    expect(css).not.toMatch(/@container golem-config \(max-width: 720px\)/);
    // Kept from wave 6: the strip's capability fieldset is a plain block, so a
    // legend WebKit keeps in the border area cannot swallow the spacing, and the
    // flex `.column` wrapper that used to space the halves is gone.
    const fieldset = css.match(/\.detail \.capabilities \{[^}]*\}/s)?.[0] ?? '';
    expect(fieldset).toMatch(/display: block/);
    expect(fieldset).toMatch(/border: 0/);
    expect(css).not.toMatch(/^\.column \{/m);
    expect(css).not.toMatch(/\.detail \.capabilities > legend \{/);
    // The strip body spaces its blocks itself, whichever host they sit in.
    expect(css.match(/^\.detailBody > \* \+ \* \{[^}]*\}/ms)?.[0] ?? '').toMatch(
      /margin-top: 12px/
    );
    // The declaration form spaces its own blocks the same way (Global Constraints).
    expect(css.match(/^\.detailDeclaredExposure > \* \+ \* \{[^}]*\}/ms)?.[0] ?? '').toMatch(
      /margin-top: 12px/
    );
    // The footnote wraps and sits 8px under the chips, wherever it is hosted.
    expect(css.match(/^\.capabilities > \.fieldHint \{[^}]*\}/ms)?.[0] ?? '').toMatch(
      /display: block;\s*margin-top: 8px/
    );
    // The Think row keeps its inline layout on both hosts.
    expect(
      css.match(/\.detailBody > \.field,\s*\.detailDeclaredExposure \.field \{[^}]*\}/s)?.[0] ?? ''
    ).toMatch(/flex-flow: row wrap/);
    // Kept from wave 6: the declare form's block flow and full-width Back button.
    expect(css).toMatch(/^\.manual \{\s*display: block;\s*\}/m);
    expect(css.match(/^\.manual > :not\(legend\) \+ \* \{[^}]*\}/ms)?.[0] ?? '').toMatch(
      /margin-top: 10px/
    );
    const back = css.match(/^\.manual > \.button \{[^}]*\}/ms)?.[0] ?? '';
    expect(back).toMatch(/display: flex/);
    expect(back).toMatch(/width: 100%/);
    const chrome = css.match(/^\.capabilities,\s*\.manual \{[^}]*\}/ms)?.[0] ?? '';
    expect(chrome).toMatch(/min-width: 0/);
    expect(chrome).not.toMatch(/display|gap/); // the grouped chrome rule lays nothing out
  });

  // An unchecked box was --surface-base ringed by --surface-border: two dark
  // blues, near-invisible on the panel. The ring is muted ink now.
  it('draws an unchecked box with a visible ring', () => {
    const dir = path.resolve(__dirname, '../../../components/GolemConfig');
    const css = fs.readFileSync(path.join(dir, 'GolemConfig.module.css'), 'utf8');
    const box = css.match(/^\.checkboxBox \{[^}]*\}/ms)?.[0] ?? '';
    expect(box).toMatch(/border: 1\.5px solid var\(--text-muted\)/);
  });
});

// ---------------------------------------------------------------------------
// Treatment 1: the master-detail strip, and preview-follows-focus
// ---------------------------------------------------------------------------

describe('ModelBand detail strip', () => {
  const strip = () => screen.getByTestId('model-detail');

  it('shows a one-line placeholder before anything is chosen', () => {
    renderBand();
    expect(strip()).toHaveTextContent(/No model assigned/);
    expect(strip()).toHaveAttribute('data-state', 'empty');
  });

  it('names the selection and its provider, and marks it assigned', () => {
    renderBand({ selected: agentModel });
    expect(strip()).toHaveAttribute('data-state', 'assigned');
    expect(within(strip()).getByText('gpt-5')).toBeVisible();
    expect(within(strip()).getByText(/from hosted/)).toBeVisible();
    expect(within(strip()).getByText('assigned')).toBeVisible();
    // and the card carries the same mark
    expect(within(cardNamed('gpt-5')).getByText('assigned')).toBeVisible();
  });

  it('never expands a card: its abilities are one line, never the strip chips', () => {
    renderBand({ selected: agentModel });
    const card = cardNamed('gpt-5');
    // One line, one element: the editable chips are the strip's alone.
    expect(within(card).getByText('chat stream tool_call')).toBeVisible();
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('previews the focused card without changing the assignment', async () => {
    const { onSelect } = renderBand({ selected: agentModel });
    act(() => cards()[0].focus());
    await userEvent.keyboard('{ArrowRight}');

    // The strip follows focus, read-only, and says how to commit.
    expect(strip()).toHaveAttribute('data-state', 'previewing');
    expect(within(strip()).getByText('gpt-5-mini')).toBeVisible();
    expect(within(strip()).getByText(/press Enter to choose/i)).toBeVisible();
    expect(within(strip()).queryByText('assigned')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    // The card still marked assigned is the one that IS assigned.
    expect(within(cardNamed('gpt-5')).getByText('assigned')).toBeVisible();
  });

  it('hands the strip body to the preview while previewing, and back on Escape', async () => {
    renderBand({
      selected: agentModel,
      exposure: <div data-testid="exposure">exposure for the selection</div>,
    });
    expect(within(strip()).getByTestId('exposure')).toBeVisible();

    act(() => cards()[0].focus());
    await userEvent.keyboard('{ArrowRight}');
    // Editing what you have not chosen would stage a lie, so the editor leaves
    // and the walked card reads out inert in its place.
    expect(within(strip()).queryByTestId('exposure')).not.toBeInTheDocument();
    expect(within(strip()).getByText('gpt-5-mini')).toBeVisible();
    for (const box of within(strip()).getAllByRole('checkbox')) expect(box).toBeDisabled();

    await userEvent.keyboard('{Escape}');
    expect(within(strip()).getByTestId('exposure')).toBeVisible();
  });

  it('previews a walked-onto card as inert chips with the floor it is handed, names who uses it, and prints its card and note', async () => {
    // A constant mock proves ModelBand CONSUMES `preview`; that `previewFor`
    // derives the right floor is RouteEditor's test.
    // Annotated: an unannotated literal infers string[] and fails the typed renderBand helper.
    const preview = jest.fn(
      (): ReturnType<ModelBandProps['preview']> => ({
        required: ['chat', 'stream', 'tool_call'],
        owners: ['agent'],
        offered: ['chat', 'stream', 'tool_call'],
      })
    );
    renderBand({
      routes: [{ useCase: 'chat', role: 'general' }],
      preview,
      models: [
        agentModel,
        model({ role: 'general', modelName: 'gemma4:31b', description: 'Dense reasoning.' }),
      ],
      selected: agentModel,
    });
    act(() => cards()[0].focus());
    await userEvent.keyboard('{ArrowRight}');

    const detail = strip();
    expect(detail).toHaveAttribute('data-state', 'previewing');
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ modelName: 'gemma4:31b' }));
    expect(within(detail).getByRole('group', { name: 'Required by agent' })).toBeInTheDocument();
    expect(within(detail).getByRole('checkbox', { name: 'tool_call, required' })).toBeChecked();
    for (const box of within(detail).getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(within(detail).getByText('used by chat')).toBeInTheDocument();
    expect(within(detail).getByText("gemma4:31b's card lists: chat stream")).toBeInTheDocument();
    expect(within(detail).getByText('Dense reasoning.')).toBeInTheDocument();
    expect(within(detail).queryByText(/declares/i)).toBeNull();
    expect(detail.querySelector('[data-asserted], [aria-describedby]')).toBeNull();
  });

  it("prints the assigned model's note in the strip too, every role named when there are several", () => {
    // The card ellipsises it and the popup needs a pointer: the strip is where a
    // keyboard reaches the full text, in EITHER state.
    renderBand({
      models: [
        model({ role: 'general', modelName: 'gemma4:31b', description: 'Dense reasoning.' }),
        model({ role: 'agent', modelName: 'gemma4:31b', description: 'Agent / tool-use.' }),
      ],
      selected: model({
        role: 'general',
        modelName: 'gemma4:31b',
        description: 'Dense reasoning.',
      }),
    });
    const detail = strip();
    expect(detail).toHaveAttribute('data-state', 'assigned');
    expect(within(detail).getByText('Dense reasoning.')).toBeVisible();
    expect(within(detail).getByText('Agent / tool-use.')).toBeVisible();
    // Several notes, so each says whose it is; the roles are in the row's order.
    expect([...detail.querySelectorAll('.detailNoteRole')].map((role) => role.textContent)).toEqual(
      ['agent', 'general']
    );
  });

  it('prints an assigned model with no row of its own from the model itself', () => {
    // A filter can hide the assigned card, and a reopened route can carry a
    // model this provider no longer lists: its note still belongs in the strip.
    renderBand({
      models: [model({ modelName: 'gpt-5-mini' })],
      selected: model({
        role: 'gone-role',
        modelName: 'retired-7b',
        description: 'Kept for one route.',
      }),
    });
    expect(within(strip()).getByText('Kept for one route.')).toBeVisible();
    expect(strip().querySelector('.detailNoteRole')).toBeNull(); // one note names no role
  });

  it('returns the preview to the selection on Escape', async () => {
    renderBand({ selected: agentModel });
    act(() => cards()[0].focus());
    await userEvent.keyboard('{ArrowRight}');
    expect(strip()).toHaveAttribute('data-state', 'previewing');

    await userEvent.keyboard('{Escape}');
    expect(strip()).toHaveAttribute('data-state', 'assigned');
    expect(within(strip()).getByText('gpt-5')).toBeVisible();
  });

  // The strip is in normal flow and always visible; what can be out of sight
  // is the assigned CARD, inside the bounded grid scroller.
  it('scrolls the assigned card into view within the grid', async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    const { rerender, props } = renderBand();
    expect(scrolled).toHaveLength(0); // never on first paint

    rerender(<ModelBand {...props} selected={agentModel} />);
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]).toHaveAttribute('role', 'option');
    expect(within(scrolled[0] as HTMLElement).getByText('gpt-5')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// The declare path is a first-class readout, not a dead end
// ---------------------------------------------------------------------------

describe('ModelBand declare readout', () => {
  const strip = () => screen.getByTestId('model-detail');

  it('gives a hand declaration the exposure editor too', () => {
    // RouteEditor nulls the chosen model when a declaration is made, so gating
    // the exposure half on `selected` deleted the checklist and the Think
    // control from the entire declare path.
    renderBand({
      selected: null,
      manual: { model: 'llama-4', type: 'dense', caps: ['chat', 'stream'] },
      exposure: <div data-testid="exposure">think mode and the checklist</div>,
    });

    expect(within(strip()).getByTestId('exposure')).toBeVisible();
  });

  it('wears the solid surface while declaring, not the empty placeholder', () => {
    renderBand({
      selected: null,
      manual: { model: 'llama-4', type: '', caps: ['chat', 'stream'] },
    });

    expect(strip()).toHaveAttribute('data-state', 'declaring');
    expect(strip().className).not.toMatch(/detailEmpty/);
    expect(within(strip()).getByText(/declare "llama-4"/)).toBeVisible();
  });

  it('hosts the exposure node as direct children of the strip body', () => {
    renderBand({
      selected: agentModel,
      exposure: <div className="field" data-testid="think-probe" />,
    });
    expect(within(strip()).getByText('gpt-5')).toBeVisible();
    // No wrapper between: the Think row is the `.detailBody > .field` the
    // inline-layout rule addresses, and the body is one column, never two.
    expect(screen.getByTestId('think-probe').parentElement).toHaveClass('detailBody');
  });
});

// ---------------------------------------------------------------------------
// Preview must not outlive the grid
// ---------------------------------------------------------------------------

describe('ModelBand preview lifetime', () => {
  const strip = () => screen.getByTestId('model-detail');

  it('ends the preview when focus leaves the grid', async () => {
    renderBand({ selected: agentModel });
    act(() => cards()[0].focus());
    await userEvent.keyboard('{ArrowRight}');
    expect(strip()).toHaveAttribute('data-state', 'previewing');

    // Tabbing or clicking out must not leave the hint over another model's
    // facts while the checkboxes belong to the assignment.
    await userEvent.click(screen.getByLabelText('Filter models'));
    expect(strip()).toHaveAttribute('data-state', 'assigned');
  });

  it('ends the preview when the filter is typed', async () => {
    renderBand({ selected: agentModel });
    act(() => cards()[0].focus());
    await userEvent.keyboard('{ArrowRight}');
    expect(strip()).toHaveAttribute('data-state', 'previewing');

    // The filter re-points the active index with no navigation at all.
    await userEvent.type(screen.getByLabelText('Filter models'), 'g');
    expect(strip()).toHaveAttribute('data-state', 'assigned');
  });
});

// ---------------------------------------------------------------------------
// The card popup: everything a three-line card cut short, beside the card.
// Held open by three independent facts — the pointer on the card, the pointer
// on the popup, the card's focus — each OWNED by one card, so a hold can never
// outlive its card or be inherited by the next mount.
// ---------------------------------------------------------------------------

describe('ModelBand card popup timing', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers()); // restored even when an assertion throws

  /** A 190x60 box at (left, bottom), as jsdom will never compute one. */
  const rectOf = (node: HTMLElement, left: number, bottom: number) => {
    node.getBoundingClientRect = () =>
      ({
        x: left,
        y: bottom - 60,
        left,
        top: bottom - 60,
        right: left + 190,
        bottom,
        width: 190,
        height: 60,
        toJSON: () => ({}),
      }) as DOMRect;
  };

  it('opens the popup on hover after the delay, keeps it while the pointer is on it, and closes on Escape', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({
      id: 'band',
      models: [
        model({
          role: 'agent',
          modelName: 'gemma4:31b',
          parameters: '31B',
          contextWindow: 256000,
          description: 'Agent / tool-use.',
        }),
      ],
    });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(card);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => jest.advanceTimersByTime(200));
    const pop = screen.getByRole('tooltip');
    expect(pop).toHaveAttribute('id', 'band-card-pop');
    expect(pop).toHaveTextContent('Dense');
    expect(pop).toHaveTextContent('31B parameters · 256000-token context');
    expect(pop).toHaveTextContent('chat stream');
    expect(pop).toHaveTextContent('Agent / tool-use.');
    // The portal moved the node out of the band; an id reference crosses that
    // boundary, so the card's description still resolves to it.
    expect(card).toHaveAttribute('aria-describedby', 'band-card-pop');
    expect(document.getElementById('band-card-pop')).toBe(pop);
    expect(card.closest('.band')).not.toContainElement(pop);
    await user.unhover(card);
    await user.hover(pop);
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    // Focus is on the body here: the document listener is what hears this.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes 120 ms after the pointer leaves both the card and the popup', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(card);
    act(() => jest.advanceTimersByTime(200));
    const pop = screen.getByRole('tooltip');
    await user.unhover(card);
    await user.hover(pop);
    await user.unhover(pop);
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(30));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  // Selecting a long note drags the pointer past the popup's edge with the
  // button still down; that leave is not a departure. The release decides:
  // outside the popup, the usual close; back over it, nothing.
  it('keeps the popup through a selection drag that leaves it, until the release lands outside', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(card);
    act(() => jest.advanceTimersByTime(200));
    const pop = screen.getByRole('tooltip');
    await user.unhover(card);
    await user.hover(pop);
    fireEvent.mouseLeave(pop, { buttons: 1 });
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseUp(pop, { buttons: 0 });
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(pop, { buttons: 1 });
    fireEvent.mouseUp(document.body, { buttons: 0 });
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(30));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  // Overshooting the popup's edge and releasing is how a long note gets
  // selected to its end; the DOM holding that selection has to survive the
  // release, or nothing is left to copy. The next press outside closes it.
  it('keeps the popup after an outside release while a selection is anchored inside it', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({
      id: 'band',
      models: [model({ modelName: 'gemma4:31b', description: 'Dense reasoning.' })],
    });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(card);
    act(() => jest.advanceTimersByTime(200));
    const pop = screen.getByRole('tooltip');
    await user.unhover(card);
    await user.hover(pop);
    fireEvent.mouseLeave(pop, { buttons: 1 });
    const range = document.createRange();
    range.selectNodeContents(within(pop).getByText('Dense reasoning.'));
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.isCollapsed).toBe(false);
    fireEvent.mouseUp(document.body, { buttons: 0 });
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    // A press outside is the dismissal it always was (and collapses the selection).
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
    selection.removeAllRanges();
  });

  // The kept popup must not leave the hold believing the pointer is still on
  // it: after one copy-by-overshoot, the next card's popup has to close on
  // hover-out like any other.
  it('closes the next hover popup normally after a selection was kept through a release', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({
      id: 'band',
      models: [
        model({ modelName: 'gemma4:31b', description: 'Dense reasoning.' }),
        model({ role: 'other', modelName: 'gpt-5', description: 'Hosted.' }),
      ],
    });
    const first = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(first);
    act(() => jest.advanceTimersByTime(200));
    const pop = screen.getByRole('tooltip');
    await user.unhover(first);
    await user.hover(pop);
    fireEvent.mouseLeave(pop, { buttons: 1 });
    const range = document.createRange();
    range.selectNodeContents(within(pop).getByText('Dense reasoning.'));
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(document.body, { buttons: 0 });
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    selection.removeAllRanges();

    // Raw events: user-event would also synthesise a buttonless leave on the
    // popup here, which a real pointer that dragged out and released outside
    // never sends again.
    const second = screen.getByRole('option', { name: /gpt-5/ });
    fireEvent.pointerEnter(second, { pointerType: 'mouse' });
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hosted.');
    fireEvent.pointerLeave(second, { pointerType: 'mouse' });
    act(() => jest.advanceTimersByTime(130));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  // A release that lands on another card is still the end of the selection
  // drag: that card's pending hover-open must not replace the popup the
  // selection lives in.
  it('keeps the selected popup when the release lands on another card', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({
      id: 'band',
      models: [
        model({ modelName: 'gemma4:31b', description: 'Dense reasoning.' }),
        model({ role: 'other', modelName: 'gpt-5', description: 'Hosted.' }),
      ],
    });
    const first = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(first);
    act(() => jest.advanceTimersByTime(200));
    const pop = screen.getByRole('tooltip');
    await user.unhover(first);
    await user.hover(pop);
    fireEvent.mouseLeave(pop, { buttons: 1 });
    const range = document.createRange();
    range.selectNodeContents(within(pop).getByText('Dense reasoning.'));
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    const second = screen.getByRole('option', { name: /gpt-5/ });
    fireEvent.pointerEnter(second, { pointerType: 'mouse' });
    fireEvent.mouseUp(second, { buttons: 0 });
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Dense reasoning.');
    selection.removeAllRanges();
  });

  // A drag is not a hover: crossing a card with the button down must not
  // schedule its hover-open at all, or a selection drag that lingers on it
  // past 160 ms loses the popup, and the selection, before the release.
  it("does not open another card's popup while a selection drag lingers on it", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({
      id: 'band',
      models: [
        model({ modelName: 'gemma4:31b', description: 'Dense reasoning.' }),
        model({ role: 'other', modelName: 'gpt-5', description: 'Hosted.' }),
      ],
    });
    const first = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(first);
    act(() => jest.advanceTimersByTime(200));
    const pop = screen.getByRole('tooltip');
    await user.unhover(first);
    await user.hover(pop);
    fireEvent.mouseLeave(pop, { buttons: 1 });
    const range = document.createRange();
    range.selectNodeContents(within(pop).getByText('Dense reasoning.'));
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    // jsdom has no PointerEvent (RTL's pointerEnter falls back to a bare
    // Event with no `buttons`); a MouseEvent named pointerover carries the
    // held button to React's onPointerEnter.
    const second = screen.getByRole('option', { name: /gpt-5/ });
    fireEvent(second, new MouseEvent('pointerover', { bubbles: true, buttons: 1 }));
    act(() => jest.advanceTimersByTime(400));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Dense reasoning.');
    fireEvent.mouseUp(second, { buttons: 0 });
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Dense reasoning.');
    selection.removeAllRanges();
    // Released, left and re-entered with no button: an ordinary hover opens it.
    fireEvent.pointerLeave(second, { pointerType: 'mouse' });
    fireEvent(second, new MouseEvent('pointerover', { bubbles: true, buttons: 0 }));
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hosted.');
  });

  // The popup reads the card as it stands now, not as it stood when it opened:
  // a reload that rewrites a note or a fact while the popup is up must show.
  it('shows a note that changes while the popup is open', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { rerender, props } = renderBand({
      id: 'band',
      models: [model({ modelName: 'gemma4:31b', description: 'Dense reasoning.' })],
    });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(card);
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Dense reasoning.');
    rerender(
      <ModelBand
        {...props}
        models={[model({ modelName: 'gemma4:31b', description: 'Sparse reasoning.' })]}
      />
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sparse reasoning.');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Dense reasoning.');
  });

  it('stays open while the card keeps focus after the pointer leaves, and a quick re-entry cancels the close', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    act(() => card.focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.hover(card);
    await user.unhover(card);
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toBeInTheDocument(); // focus still holds it
    act(() => card.blur());
    act(() => jest.advanceTimersByTime(60));
    await user.hover(card); // re-entry inside the 120 ms window cancels the close
    act(() => jest.advanceTimersByTime(70)); // past the original deadline, before any fresh 160 ms open could fire
    expect(screen.getByRole('tooltip')).toBeInTheDocument(); // never closed — not closed-and-reopened
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('closes when the filter removes its card', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({
      id: 'band',
      models: [
        model({ modelName: 'gemma4:31b' }),
        model({ role: 'other', modelName: 'qwen3.5:9b' }),
      ],
    });
    act(() => screen.getByRole('option', { name: /gemma4:31b/ }).focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    // Keyboard only: a pointerdown anywhere outside dismisses the popup on its
    // own, and what this pins is the card leaving the shown set.
    act(() => screen.getByLabelText('Filter models').focus());
    await user.keyboard('qwen');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('is dismissed by a pointerdown outside it, and a pointerdown inside it is not a dismissal', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(card);
    act(() => jest.advanceTimersByTime(200));
    // A pointerdown on the popup itself is a scrollbar drag or a text
    // selection on a long note, never a dismissal.
    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('tooltip') });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.pointer({ keys: '[/MouseLeft]' });

    // The popup is opaque and covers the cards under it: a press anywhere else
    // takes it away before the click lands.
    await user.pointer({ keys: '[MouseLeft>]', target: card });
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.pointer({ keys: '[/MouseLeft]' });
    // Still hovered, and it stays gone: only a fresh entry or focus reopens it.
    act(() => jest.advanceTimersByTime(500));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not open the popup for the focus a click brings, but still does for the keyboard', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { onSelect } = renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });

    await user.click(card);
    expect(onSelect).toHaveBeenCalled(); // the click still chooses the model
    expect(card).toHaveFocus();
    act(() => jest.advanceTimersByTime(500));
    expect(screen.queryByRole('tooltip')).toBeNull();

    // Programmatic or keyboard focus is not a pointer: it opens at once.
    act(() => card.blur());
    act(() => card.focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('closes when the grid scrolls out from under a HOVERED card', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    await user.hover(screen.getByRole('option', { name: /gemma4:31b/ }));
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    // The grid is the bounded scroller: re-placing onto a clipped card's rect
    // would put the popup over the band head, so this one scroll closes it.
    fireEvent.scroll(screen.getByRole('listbox', { name: /Models/ }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes when a wheel scroll clips the focused card out of the grid', () => {
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    const grid = screen.getByRole('listbox', { name: /Models/ });
    act(() => card.focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    // Focus alone is not the exemption: the card has to still BE in the grid's
    // box. Here the wheel has taken it above the top edge, so the popup would
    // be re-placed onto a clipped card, over the band head.
    rectOf(card, 20, 60);
    rectOf(grid, 0, 476);
    fireEvent.scroll(grid);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it("keeps a focused card's popup through the grid scroll that focus itself caused", () => {
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    act(() => screen.getByRole('option', { name: /gemma4:31b/ }).focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    // Focusing an off-screen card scrolls the grid to it natively (the roving
    // focus relies on that), so this scroll arrives right behind the open and
    // must not undo it. The window capture listener re-places it instead.
    fireEvent.scroll(screen.getByRole('listbox', { name: /Models/ }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('clears the pointer flag when a press is released off the card, so the next focus still opens', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({
      id: 'band',
      models: [
        model({ modelName: 'gemma4:31b' }),
        model({ role: 'other', modelName: 'qwen3.5:9b' }),
      ],
    });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    const other = screen.getByRole('option', { name: /qwen3.5:9b/ });
    act(() => card.focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    // Pressing an ALREADY focused card fires no focus event to consume the
    // flag, and the release happens over NOTHING — not over a sibling card,
    // which would have fired its own events — so the document-level release is
    // the only thing that can clear it.
    await user.pointer([
      { keys: '[MouseLeft>]', target: card },
      { target: other },
      { target: document.body },
      { keys: '[/MouseLeft]' },
    ]);
    act(() => card.blur());
    act(() => jest.advanceTimersByTime(500));
    // Nothing of the neighbour's is left open either, so the reopen below can
    // only be this card's.
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => card.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent('gemma4:31b'); // a stale flag would have suppressed this
  });

  it('takes its per-press release listener with it when the band unmounts', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');
    // try/finally: a thrown assertion below must not leak these spies into
    // later tests.
    try {
      const { unmount } = renderBand({
        id: 'band',
        models: [model({ modelName: 'gemma4:31b' })],
      });
      // Pressed and held: the release listener is live, waiting for a mouseup
      // that will never come from this component.
      await user.pointer({
        keys: '[MouseLeft>]',
        target: screen.getByRole('option', { name: /gemma4:31b/ }),
      });
      const registered = add.mock.calls.filter(([type]) => type === 'mouseup').map(([, fn]) => fn);
      expect(registered).toHaveLength(1);

      unmount();
      expect(
        remove.mock.calls.some(([type, fn]) => type === 'mouseup' && fn === registered[0])
      ).toBe(true);
      expect(() => fireEvent.mouseUp(document)).not.toThrow();
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('does not open the popup for a completed touch tap', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    // A tap dispatches pointerdown > pointerup > mousedown > focus > mouseup >
    // click (verified against user-event; a mouse press is pointerdown >
    // mousedown > focus > pointerup > mouseup > click). The compatibility
    // mousedown precedes focus in BOTH, which is why the flag hangs off it.
    await user.pointer({ keys: '[TouchA]', target: card });
    expect(card).toHaveFocus();
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => jest.advanceTimersByTime(500));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens the popup at once on focus and closes it 120 ms after blur', () => {
    // Inside the fake-timer suite: blur schedules settle(), it does not close at once.
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    act(() => card.focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => card.blur());
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(30));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('cancels a pending hover-open when its card becomes ineligible, and never opens it', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { rerender, props } = renderBand({
      id: 'band',
      shortfalls: () => [],
      models: [model({ modelName: 'gemma4:31b' })],
    });
    await user.hover(screen.getByRole('option', { name: /gemma4:31b/ }));
    act(() => jest.advanceTimersByTime(50));
    expect(jest.getTimerCount()).toBe(1); // the 160 ms open is pending — this fixture schedules nothing else
    // The draft changed under the band: the same card is now blocked (same identity, new verdict).
    rerender(
      <ModelBand {...props} shortfalls={() => [{ cap: 'tool_call', useCases: ['agent'] }]} />
    );
    expect(jest.getTimerCount()).toBe(0); // cancelled at once, not merely closed later by the connectivity check
    act(() => jest.advanceTimersByTime(500));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not let a re-mounted card inherit the focus hold its removed predecessor never released', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { rerender, props } = renderBand({
      id: 'band',
      shortfalls: () => [],
      models: [model({ modelName: 'gemma4:31b' })],
    });
    act(() => screen.getByRole('option', { name: /gemma4:31b/ }).focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    // Blocked: React removes the eligible card without firing its onBlur.
    rerender(
      <ModelBand {...props} shortfalls={() => [{ cap: 'tool_call', useCases: ['agent'] }]} />
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Eligible again: a fresh card, no focus, no hover.
    rerender(<ModelBand {...props} shortfalls={() => []} />);
    const again = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(again);
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.unhover(again);
    act(() => jest.advanceTimersByTime(130));
    expect(screen.queryByRole('tooltip')).toBeNull(); // a stale focus hold would have kept it open
  });

  it("keeps each hold with its own card: focusing B drops A's pending open, and A's focus never holds B's popup", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({
      id: 'band',
      models: [
        model({ modelName: 'gemma4:31b' }),
        model({ role: 'other', modelName: 'qwen3.5:9b' }),
      ],
    });
    const a = screen.getByRole('option', { name: /gemma4:31b/ });
    const b = screen.getByRole('option', { name: /qwen3.5:9b/ });
    await user.hover(a);
    act(() => jest.advanceTimersByTime(50));
    act(() => b.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent('qwen3.5:9b');
    act(() => jest.advanceTimersByTime(500)); // A's 160 ms timer would have fired by now
    expect(screen.getByRole('tooltip')).toHaveTextContent('qwen3.5:9b');
    await user.unhover(a);
    act(() => b.blur());
    act(() => jest.advanceTimersByTime(130));
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Focus A, hover B: B's popup shows; leaving B closes it although A still has focus.
    act(() => a.focus());
    await user.hover(b);
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toHaveTextContent('qwen3.5:9b');
    await user.unhover(b);
    act(() => jest.advanceTimersByTime(130));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('after Escape, a card that is still focused holds its reopened popup', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    act(() => card.focus());
    await user.hover(card);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.unhover(card);
    await user.hover(card); // re-entry reopens (focus alone does not, Escape asked for it closed)
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.unhover(card);
    act(() => jest.advanceTimersByTime(130));
    expect(screen.getByRole('tooltip')).toBeInTheDocument(); // still focused: the hold survived Escape
  });

  it('after Escape, a card the pointer never left holds the popup its focus reopened', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' })] });
    const card = screen.getByRole('option', { name: /gemma4:31b/ });
    await user.hover(card);
    act(() => jest.advanceTimersByTime(200));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => card.focus()); // pointer still on the card
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => card.blur());
    act(() => jest.advanceTimersByTime(130));
    expect(screen.getByRole('tooltip')).toBeInTheDocument(); // still hovered: the hold survived Escape
  });

  it("a neighbour becoming ineligible neither closes an open popup nor drops its card's holds", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { rerender, props } = renderBand({
      id: 'band',
      shortfalls: () => [],
      models: [
        model({ modelName: 'gemma4:31b' }),
        model({ role: 'other', modelName: 'qwen3.5:9b' }),
      ],
    });
    const a = screen.getByRole('option', { name: /gemma4:31b/ });
    act(() => a.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent('gemma4:31b');
    rerender(
      <ModelBand
        {...props}
        shortfalls={(candidate) =>
          candidate.modelName === 'qwen3.5:9b' ? [{ cap: 'tool_call', useCases: ['agent'] }] : []
        }
      />
    );
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toHaveTextContent('gemma4:31b');
    await user.hover(a);
    await user.unhover(a);
    act(() => jest.advanceTimersByTime(130));
    expect(screen.getByRole('tooltip')).toBeInTheDocument(); // focus hold intact
  });

  // Placement is recomputed from the anchor's rect. The grid can move a
  // SURVIVING anchor with no scroll and no resize event — a neighbour leaving,
  // a blocked card being revealed into its row — which is what `layoutKey` is
  // for. Jest's setupTests installs a no-op ResizeObserver, so nothing here
  // rides on the observer: these two cases pass only on the key.
  describe('placement', () => {
    const size = { offsetWidth: 300, offsetHeight: 200 };
    const viewport = { innerWidth: 1024, innerHeight: 768 };
    const native = (Object.keys(size) as (keyof typeof size)[]).map(
      (key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)!] as const
    );
    const nativeViewport = (Object.keys(viewport) as (keyof typeof viewport)[]).map(
      (key) => [key, Object.getOwnPropertyDescriptor(window, key)!] as const
    );

    beforeEach(() => {
      // jsdom implements no layout: every offset reads 0, and a 0-height popup
      // never flips or clamps.
      for (const [key, descriptor] of native)
        Object.defineProperty(HTMLElement.prototype, key, {
          ...descriptor,
          get: () => size[key],
        });
      for (const [key, descriptor] of nativeViewport)
        Object.defineProperty(window, key, { ...descriptor, value: viewport[key] });
    });

    afterEach(() => {
      for (const [key, descriptor] of native)
        Object.defineProperty(HTMLElement.prototype, key, descriptor);
      // The viewport is global too: 1024x768 left behind would silently seed
      // every later suite in this worker.
      for (const [key, descriptor] of nativeViewport)
        Object.defineProperty(window, key, descriptor);
    });

    it('re-places the open popup when a neighbour leaves the grid under it', () => {
      const { rerender, props } = renderBand({
        id: 'band',
        shortfalls: () => [],
        models: [
          model({ modelName: 'gemma4:31b' }),
          model({ role: 'other', modelName: 'qwen3.5:9b' }),
        ],
      });
      const b = screen.getByRole('option', { name: /qwen3.5:9b/ });
      rectOf(b, 240, 100); // column two
      act(() => b.focus());
      const pop = screen.getByRole('tooltip');
      expect(pop.style.left).toBe('240px');

      rectOf(b, 20, 100); // B slides into column one as A leaves
      rerender(
        <ModelBand
          {...props}
          shortfalls={(candidate) =>
            candidate.modelName === 'gemma4:31b' ? [{ cap: 'tool_call', useCases: ['agent'] }] : []
          }
        />
      );
      expect(screen.getByRole('tooltip')).toBe(pop); // the same popup, moved
      expect(pop.style.left).toBe('20px');
    });

    it('re-places the open popup when a revealed blocked card grows its row', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderBand({ id: 'band', models: [model({ modelName: 'gemma4:31b' }), embedModel] });
      const card = screen.getByRole('option', { name: /gemma4:31b/ });
      rectOf(card, 20, 100);
      act(() => card.focus());
      expect(screen.getByRole('tooltip').style.top).toBe('106px');

      rectOf(card, 20, 140); // the revealed card stretches the row it shares
      // Taken by the keyboard: a pointerdown would dismiss the popup, and this
      // pins the re-placement. Moving focus to the line only SCHEDULES the
      // 120 ms close, so the popup is still open at the assertion.
      const line = screen.getByRole('button', { name: /show it/ });
      act(() => line.focus());
      await user.keyboard('{Enter}');
      const pop = screen.getByRole('tooltip');
      expect(pop).toBeInTheDocument();
      expect(pop.style.top).toBe('146px');
    });
  });
});

describe('ModelBand click selection', () => {
  it('selects the model when its card is clicked', async () => {
    const { onSelect } = renderBand();
    await userEvent.click(cardNamed('gpt-5-mini'));
    expect(onSelect).toHaveBeenCalledWith(model());
  });
});

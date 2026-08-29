import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ModelBand,
  buildModelRows,
  type ModelBandProps,
} from '../../../components/GolemConfig/ModelBand';
import { CAPABILITY_NAMES, type CapabilityName, type ModelProjection } from '../../../types/golem';

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
    onProviderChange,
    onSelect,
    onManual,
    ...over,
  };
  const view = render(<ModelBand {...props} />);
  return { ...view, onSelect, onManual, onProviderChange, props };
}

const cards = () => within(screen.getByRole('listbox', { name: /Models/ })).getAllByRole('option');
const cardNamed = (name: string) =>
  cards().find((card) => within(card).queryByText(name) !== null) as HTMLElement;

// ---------------------------------------------------------------------------
// Amendment A — compact by default, one card expanded at a time
// ---------------------------------------------------------------------------

describe('ModelBand compact cards', () => {
  it('shows name, type and context window but no capability chips until selected', () => {
    renderBand({ models: [model({ contextWindow: 8192 })] });
    const card = cardNamed('gpt-5-mini');

    expect(within(card).getByText('gpt-5-mini')).toBeVisible();
    expect(within(card).getByText('dense')).toBeVisible();
    expect(within(card).getByText(/8192/)).toBeVisible();
    // The band stays compact at dozens of models: caps are the expansion.
    expect(within(card).queryByText('stream')).not.toBeInTheDocument();
  });

  it('expands the chosen card in place and collapses the previous one', async () => {
    const { rerender, props } = renderBand();

    await userEvent.click(cardNamed('gpt-5-mini'));
    expect(props.onSelect).toHaveBeenCalledWith(model());
    rerender(<ModelBand {...props} selected={model()} />);

    const first = cardNamed('gpt-5-mini');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(within(first).getByText('stream')).toBeVisible();

    await userEvent.click(cardNamed('gpt-5'));
    rerender(<ModelBand {...props} selected={agentModel} />);

    expect(within(cardNamed('gpt-5')).getByText('tool_call')).toBeVisible();
    expect(within(cardNamed('gpt-5-mini')).queryByText('stream')).not.toBeInTheDocument();
  });

  it('collapses the expansion on Escape without unselecting the model', async () => {
    const { rerender, props } = renderBand();
    await userEvent.click(cardNamed('gpt-5-mini'));
    rerender(<ModelBand {...props} selected={model()} />);
    expect(within(cardNamed('gpt-5-mini')).getByText('stream')).toBeVisible();

    await userEvent.keyboard('{Escape}');

    const card = cardNamed('gpt-5-mini');
    expect(within(card).queryByText('stream')).not.toBeInTheDocument();
    expect(card).toHaveAttribute('aria-selected', 'true'); // still the assignment
  });
});

// ---------------------------------------------------------------------------
// 2D keyboard navigation across the grid
// ---------------------------------------------------------------------------

describe('ModelBand keyboard navigation', () => {
  it('moves across the grid with the arrows and selects on Enter', async () => {
    const { onSelect } = renderBand();
    cards()[0].focus();

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
    cards()[0].focus();

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
    cards()[0].focus();

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(cardNamed('gpt-5')).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    // Two eligible models here, so the last stop is the declare-free end.
    expect(cards().at(-1)).toHaveFocus();
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
    const line = screen.getByRole('button', { name: /does not meet chat · stream/ });
    expect(line).toHaveTextContent('1 model');

    await userEvent.click(line);
    const blocked = cardNamed('nomic-embed');
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(within(blocked).getByText('✕ chat')).toBeVisible();
    expect(within(blocked).getByText('✕ stream')).toBeVisible();
    expect(within(blocked).getByText('not eligible for chat')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /show them|hide them/ }));
    expect(cards().some((card) => within(card).queryByText('nomic-embed') !== null)).toBe(false);
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
    expect(onManual).toHaveBeenCalledWith({
      model: 'llama-4',
      type: '',
      caps: ['chat', 'stream'],
    });
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
    for (const locked of ['chat', 'stream']) {
      const box = within(caps).getByLabelText(locked + ' required');
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    expect(within(caps).getByLabelText('tool_call')).not.toBeChecked();
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
    expect(status).toHaveTextContent('1 model match this filter');
  });
});

describe('ModelBand Home and End', () => {
  // §4.7 names Home/End beside the arrows.
  it('jumps to the first and last card in the walk', async () => {
    renderBand();
    cards()[0].focus();

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
  it('resolves every styles.* reference against its own module', () => {
    const dir = path.resolve(__dirname, '../../../components/GolemConfig');
    const source = fs.readFileSync(path.join(dir, 'ModelBand.tsx'), 'utf8');
    const css = fs.readFileSync(path.join(dir, 'GolemConfig.module.css'), 'utf8');

    const used = [...source.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(10);

    const missing = [...new Set(used)].filter(
      (name) => !new RegExp(`\\.${name}[\\s,{:[]`).test(css)
    );
    expect(missing).toEqual([]);
  });
});

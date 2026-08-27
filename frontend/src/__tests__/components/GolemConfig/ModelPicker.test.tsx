import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelPicker, type ModelPickerProps } from '../../../components/GolemConfig/ModelPicker';
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
  routedUseCases: ['agent'],
});

const embedModel = model({
  role: 'embed-role',
  modelName: 'nomic-embed',
  effectiveCapabilities: ['embed'],
  capabilityFacts: { caps: ['embed'], knownCaps: [...CAPABILITY_NAMES] },
  exposedCapabilities: ['embed'],
  routedUseCases: [],
});

function renderPicker(over: Partial<ModelPickerProps> = {}) {
  const onSelect = jest.fn();
  const onManual = jest.fn();
  const props: ModelPickerProps = {
    id: 'route-editor-chat',
    floor: ['chat', 'stream'] as readonly CapabilityName[],
    models: [model(), agentModel, embedModel],
    selected: '',
    manual: null,
    onSelect,
    onManual,
    ...over,
  };
  const view = render(
    <>
      <ModelPicker {...props} />
      <button type="button">After the picker</button>
    </>
  );
  return { ...view, onSelect, onManual };
}

const combobox = () => screen.getByRole('combobox', { name: 'Model' });
const open = async () => await userEvent.click(combobox());

describe('ModelPicker combobox contract', () => {
  it('declares the combobox ARIA contract and names no active option while closed', () => {
    renderPicker();
    const input = combobox();
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-controls', 'route-editor-chat-listbox');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('lists only models meeting the floor, names the filter, and counts the hidden ones', async () => {
    renderPicker();
    await open();

    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveAttribute('id', 'route-editor-chat-listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'gpt-5-mini — chat · stream',
      'gpt-5 — chat · stream · tool_call',
    ]);
    expect(screen.getByText('filter: chat · stream')).toBeInTheDocument();
    expect(screen.getByText(/1 model hidden/)).toBeInTheDocument();
  });

  // Two roles may share a model NAME while declaring different facts. Those are
  // different choices — `sameModelFacts` says so, and it is the comparison the
  // backend re-runs — so collapsing them would stage the first role's numbers
  // for whichever the user thought they clicked.
  it('keeps same-named models apart when their facts differ, and says how', async () => {
    const small = model({ role: 'small-role', parameters: '7b', contextWindow: 8192 });
    const large = model({ role: 'large-role', parameters: '70b', contextWindow: 131072 });
    const { onSelect } = renderPicker({ models: [small, large] });
    await open();

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'gpt-5-mini (7b · 8192 ctx · dense) — chat · stream',
      'gpt-5-mini (70b · 131072 ctx · dense) — chat · stream',
    ]);

    await userEvent.click(options[1]);
    expect(onSelect).toHaveBeenCalledWith(large);
  });

  it('collapses two roles that declare byte-identical facts', async () => {
    const first = model({ role: 'first-role', parameters: '7b' });
    const second = model({ role: 'second-role', parameters: '7b' });
    renderPicker({ models: [first, second] });
    await open();

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['gpt-5-mini — chat · stream']);
  });

  it('names the empty filter when the use case has no Firn floor', async () => {
    renderPicker({ floor: [] });
    await open();
    expect(screen.getByText('filter: none')).toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(3);
  });

  it('narrows the list as the input is typed', async () => {
    renderPicker();
    await userEvent.type(combobox(), 'mini');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('gpt-5-mini');
  });

  it('moves the active descendant with the arrows and jumps with Home and End', async () => {
    renderPicker();
    await open();
    const input = combobox();
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'route-editor-chat-option-0');
    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'route-editor-chat-option-1');
    await userEvent.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', 'route-editor-chat-option-0');
    await userEvent.keyboard('{End}');
    expect(input).toHaveAttribute('aria-activedescendant', 'route-editor-chat-option-1');
    await userEvent.keyboard('{Home}');
    expect(input).toHaveAttribute('aria-activedescendant', 'route-editor-chat-option-0');
    // The input never loses focus to the option it activates.
    expect(input).toHaveFocus();
  });

  it('selects the active option on Enter and restores focus to the input', async () => {
    const { onSelect } = renderPicker();
    await open();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith(agentModel);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combobox()).toHaveFocus();
  });

  it('selects on click without the pointer stealing focus from the input', async () => {
    const { onSelect } = renderPicker();
    await open();
    await userEvent.click(screen.getByRole('option', { name: /gpt-5-mini/ }));

    expect(onSelect).toHaveBeenCalledWith(model());
    expect(combobox()).toHaveFocus();
  });

  it('closes on Escape and restores focus to the input', async () => {
    renderPicker();
    await open();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    expect(combobox()).toHaveFocus();
  });

  it('closes on an outside pointer without stealing focus from the clicked target', async () => {
    renderPicker();
    await open();
    const outside = screen.getByRole('button', { name: 'After the picker' });
    await userEvent.click(outside);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it('leaves Tab to the natural focus order', async () => {
    renderPicker();
    await open();
    await userEvent.tab();

    // The footer lives in the editor's own DOM, not in the portal, so the
    // manual-entry action is the next stop rather than being skipped past.
    expect(screen.getByRole('button', { name: 'Enter a model manually' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('marks the chosen model as the selected option', async () => {
    renderPicker({ selected: 'gpt-5' });
    await open();
    expect(screen.getByRole('option', { name: /gpt-5-mini/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('option', { name: /^gpt-5 / })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('announces how many models the filter left', async () => {
    renderPicker();
    await open();
    expect(screen.getByRole('status')).toHaveTextContent('2 models match this filter');
  });

  it('says so when the floor leaves nothing to choose', async () => {
    renderPicker({ models: [embedModel] });
    await open();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText(/No defined model meets this filter/)).toBeInTheDocument();
  });
});

describe('ModelPicker manual entry', () => {
  it('closes the options popup and asks for the manual fields', async () => {
    const { onManual } = renderPicker();
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Enter a model manually' }));

    expect(onManual).toHaveBeenCalledWith({ model: '', type: '', caps: ['chat', 'stream'] });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders the manual fields with the floor capabilities pre-checked and locked', () => {
    renderPicker({ manual: { model: '', type: '', caps: ['chat', 'stream'] } });

    expect(screen.queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    const manual = screen.getByRole('group', { name: 'Enter a model manually' });
    expect(within(manual).getByLabelText('Model name')).toHaveValue('');
    expect(within(manual).getByLabelText('Type')).toHaveValue('');

    const caps = within(manual).getByRole('group', { name: 'Capabilities this model supports' });
    for (const locked of ['chat', 'stream']) {
      expect(within(caps).getByLabelText(locked)).toBeChecked();
      expect(within(caps).getByLabelText(locked)).toBeDisabled();
    }
    expect(within(caps).getByLabelText('tool_call')).not.toBeChecked();
    expect(within(caps).getByLabelText('tool_call')).toBeEnabled();
  });

  it('reports every manual edit as complete facts', async () => {
    const { onManual } = renderPicker({
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
      // Canonical order, never click order: the transport refuses anything else.
      caps: ['chat', 'stream', 'tool_call'],
    });
  });

  it('returns to the list and restores focus to the combobox input', async () => {
    const { rerender, onManual } = renderPicker({
      manual: { model: 'llama-4', type: 'dense', caps: ['chat', 'stream'] },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Back to the model list' }));
    expect(onManual).toHaveBeenCalledWith(null);

    rerender(
      <>
        <ModelPicker
          id="route-editor-chat"
          floor={['chat', 'stream']}
          models={[model()]}
          selected=""
          manual={null}
          onSelect={jest.fn()}
          onManual={onManual}
        />
        <button type="button">After the picker</button>
      </>
    );
    expect(combobox()).toHaveFocus();
  });
});

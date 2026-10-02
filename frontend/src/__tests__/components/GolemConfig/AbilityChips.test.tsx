import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AbilityChips } from '../../../components/GolemConfig/AbilityChips';

const base = {
  id: 'x',
  legend: 'Capabilities exposed to reasoning — from deepseek-v4-pro',
  // Shuffled on purpose: the REQUIRED group must read in CAPABILITY_NAMES'
  // canonical order (chat, stream, tool_call) regardless of this array's order.
  required: ['tool_call', 'chat', 'stream'] as const,
  owners: ['agent', 'chat'],
  declared: ['chat', 'generate', 'stream'] as const,
  model: 'deepseek-v4-pro',
};

describe('AbilityChips', () => {
  it('groups the floor under REQUIRED BY the owners and the rest under OPTIONAL, canonical inside each', () => {
    render(<AbilityChips {...base} selected={['chat', 'generate', 'stream', 'tool_call']} />);
    const required = screen.getByRole('group', { name: 'Required by agent and chat' });
    const optional = screen.getByRole('group', { name: 'Optional' });
    expect(
      within(required)
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('data-cap'))
    ).toEqual(['chat', 'stream', 'tool_call']);
    expect(
      within(optional)
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('data-cap'))
    ).toEqual(['generate', 'embed', 'thinking', 'insert']);
    expect(screen.getByRole('group', { name: base.legend })).toBeInTheDocument();
    // data-oncard follows `declared` (chat, generate, stream), independent of
    // whether the chip is required, selected, locked or asserted.
    expect(
      screen.getByRole('checkbox', { name: 'chat, required' }).closest('label')
    ).toHaveAttribute('data-oncard');
    expect(screen.getByRole('checkbox', { name: 'generate' }).closest('label')).toHaveAttribute(
      'data-oncard'
    );
    expect(
      screen.getByRole('checkbox', { name: 'stream, required' }).closest('label')
    ).toHaveAttribute('data-oncard');
    expect(
      screen.getByRole('checkbox', { name: "tool_call, not on the model's card" }).closest('label')
    ).not.toHaveAttribute('data-oncard');
    expect(screen.getByRole('checkbox', { name: 'embed' }).closest('label')).not.toHaveAttribute(
      'data-oncard'
    );
  });

  it('locks a required chip the card lists once it is on, and names the reason', () => {
    render(<AbilityChips {...base} selected={['chat', 'stream']} />);
    expect(screen.getByRole('checkbox', { name: 'chat, required' })).toBeDisabled();
    // Required but off: enabled, so the user can assert it — and its name says only what it is.
    expect(screen.getByRole('checkbox', { name: 'tool_call' })).toBeEnabled();
  });

  // The lock is the card's, not the tick's: a required chip turned on by hand
  // is an assertion the user may take back (Done still refuses a floor miss).
  it('leaves a hand-asserted required chip enabled, so the assertion can be undone', async () => {
    const onToggle = jest.fn();
    render(
      <AbilityChips {...base} selected={['chat', 'stream', 'tool_call']} onToggle={onToggle} />
    );
    const chip = screen.getByRole('checkbox', { name: "tool_call, not on the model's card" });
    expect(chip).toBeChecked();
    expect(chip).toBeEnabled();
    expect(chip.closest('label')).toHaveAttribute(
      'title',
      "Required by agent and chat. Turned on by hand, not on deepseek-v4-pro's card — unverified"
    );
    await userEvent.click(chip);
    expect(onToggle).toHaveBeenLastCalledWith('tool_call', false);
  });

  // The declaration form's chips ARE the card, so there every selected
  // required chip is the floor the declaration must carry: locked.
  it('locks every selected required chip in the declaration form', () => {
    render(
      <AbilityChips {...base} declared={[]} selected={['chat', 'stream']} mode="declaration" />
    );
    expect(screen.getByRole('checkbox', { name: 'chat, required' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'stream, required' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'tool_call' })).toBeEnabled();
  });

  it('footnotes a selected chip the card does not list', () => {
    render(<AbilityChips {...base} selected={['chat', 'stream', 'tool_call']} />);
    const chip = screen.getByRole('checkbox', {
      name: "tool_call, not on the model's card",
    });
    expect(chip.closest('label')).toHaveAttribute('data-asserted');
    expect(chip).toHaveAttribute('aria-describedby', 'x-footnote');
    expect(chip.closest('label')).toHaveAttribute(
      'title',
      "Required by agent and chat. Turned on by hand, not on deepseek-v4-pro's card — unverified"
    );
    expect(document.getElementById('x-footnote')).toHaveTextContent(
      "* Turned on by hand, not on deepseek-v4-pro's card: tool_call. Golem does not check; if the model cannot really do it, the routes that need it fail when they try."
    );
  });

  it('shows no footnote while every selected chip is on the card', () => {
    render(<AbilityChips {...base} selected={['chat', 'stream']} />);
    expect(document.getElementById('x-footnote')).toBeNull();
  });

  it('marks a chip that differs from the baseline', () => {
    render(
      <AbilityChips
        {...base}
        selected={['chat', 'stream', 'embed']}
        baseline={['chat', 'stream']}
      />
    );
    expect(
      screen.getByRole('checkbox', { name: "embed, not on the model's card" }).closest('label')
    ).toHaveAttribute('data-changed');
    expect(
      screen.getByRole('checkbox', { name: 'chat, required' }).closest('label')
    ).not.toHaveAttribute('data-changed');
  });

  it('reports one toggle for a click on the drawn face, and one for Space on the input', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    render(<AbilityChips {...base} selected={['chat', 'stream']} onToggle={onToggle} />);
    // The face is aria-hidden decoration inside the <label>: the label forwards
    // the click to its input exactly once (no double toggle).
    const face = screen
      .getByRole('checkbox', { name: 'generate' })
      .closest('label')!
      .querySelector('.abilityChipFace')!;
    await user.click(face);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenLastCalledWith('generate', true);
    screen.getByRole('checkbox', { name: 'embed' }).focus();
    await user.keyboard(' ');
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenLastCalledWith('embed', true);
  });

  it('is inert as a preview: disabled, unmarked, no footnote, nothing described', () => {
    render(
      <AbilityChips {...base} selected={['chat', 'stream', 'tool_call']} baseline={[]} readOnly />
    );
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toBeDisabled();
      expect(box).not.toHaveAttribute('aria-describedby');
    }
    expect(document.querySelector('[data-asserted], [data-changed], [title]')).toBeNull();
    expect(document.getElementById('x-footnote')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'tool_call, required' })).toBeChecked();
    // data-oncard is not a "live" mark like data-asserted/data-changed: it stays
    // under readOnly, only the marks/titles/describedby/footnote are suppressed.
    expect(
      screen.getByRole('checkbox', { name: 'chat, required' }).closest('label')
    ).toHaveAttribute('data-oncard');
  });

  it('collapses to one group with no floor', () => {
    render(<AbilityChips {...base} required={[]} owners={[]} selected={['chat']} />);
    expect(screen.queryByRole('group', { name: /Required/ })).toBeNull();
    expect(screen.getByRole('group', { name: 'Capabilities' })).toBeInTheDocument();
  });

  it('falls back to plain "Required" in a chip title when owners is empty, matching the group legend', () => {
    // In practice owners is never empty when required is non-empty — this
    // pins symmetry with the group legend's own '' -> 'Required' fallback,
    // not a live bug.
    render(<AbilityChips {...base} owners={[]} selected={['chat']} />);
    expect(screen.getByRole('checkbox', { name: 'tool_call' }).closest('label')).toHaveAttribute(
      'title',
      'Required'
    );
  });

  it('never footnotes in declaration mode', () => {
    render(
      <AbilityChips {...base} mode="declaration" declared={[]} selected={['chat', 'embed']} />
    );
    expect(document.getElementById('x-footnote')).toBeNull();
    expect(document.querySelector('[data-asserted]')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'embed' })).toBeChecked();
  });
});

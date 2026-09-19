import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AbilityChips } from '../../../components/GolemConfig/AbilityChips';

const base = {
  id: 'x',
  legend: 'Capabilities exposed to reasoning — from deepseek-v4-pro',
  required: ['chat', 'stream', 'tool_call'] as const,
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
  });

  it('locks a required chip once it is on, and names the reason', () => {
    render(<AbilityChips {...base} selected={['chat', 'stream']} />);
    expect(screen.getByRole('checkbox', { name: 'chat, required' })).toBeDisabled();
    // Required but off: enabled, so the user can assert it — and its name says only what it is.
    expect(screen.getByRole('checkbox', { name: 'tool_call' })).toBeEnabled();
  });

  it('footnotes a selected chip the card does not list', () => {
    render(<AbilityChips {...base} selected={['chat', 'stream', 'tool_call']} />);
    const chip = screen.getByRole('checkbox', {
      name: "tool_call, required, not on the model's card",
    });
    expect(chip.closest('label')).toHaveAttribute('data-asserted');
    expect(chip).toHaveAttribute('aria-describedby', 'x-footnote');
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
  });

  it('collapses to one group with no floor', () => {
    render(<AbilityChips {...base} required={[]} owners={[]} selected={['chat']} />);
    expect(screen.queryByRole('group', { name: /Required/ })).toBeNull();
    expect(screen.getByRole('group', { name: 'Capabilities' })).toBeInTheDocument();
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

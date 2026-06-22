import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorThemePicker } from '../../components/StatusBar/EditorThemePicker';
import { useIDEStore } from '../../stores/ideStore';
import { SYNTAX_THEMES } from '../../components/Editor/codemirror/palettes';

describe('EditorThemePicker', () => {
  beforeEach(() => {
    localStorage.clear();
    useIDEStore.getState().setEditorSyntaxTheme('abyssal');
  });

  it('shows the active theme label and is collapsed by default', () => {
    render(<EditorThemePicker />);
    const trigger = screen.getByRole('button', { name: 'Editor theme' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Abyssal Current');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens a listbox of all themes on click, marking the active one', () => {
    render(<EditorThemePicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Editor theme' }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(SYNTAX_THEMES.length);
    const selected = options.find((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveTextContent('Abyssal Current');
  });

  it('selecting an option updates the store and closes the menu', () => {
    render(<EditorThemePicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Editor theme' }));
    fireEvent.click(screen.getByText('Tropic Coral Reef'));
    expect(useIDEStore.getState().editorSyntaxTheme).toBe('reef');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('restores focus to the trigger when closed with Escape', () => {
    render(<EditorThemePicker />);
    const trigger = screen.getByRole('button', { name: 'Editor theme' });
    fireEvent.click(trigger);

    const selected = screen.getByRole('option', { selected: true });
    expect(selected).toHaveFocus();

    fireEvent.keyDown(selected, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('restores focus to the trigger after keyboard selection', () => {
    render(<EditorThemePicker />);
    const trigger = screen.getByRole('button', { name: 'Editor theme' });
    fireEvent.click(trigger);

    const reef = screen.getByText('Tropic Coral Reef');
    reef.focus();
    fireEvent.keyDown(reef, { key: 'Enter' });

    expect(useIDEStore.getState().editorSyntaxTheme).toBe('reef');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes the menu when keyboard focus leaves the picker', async () => {
    const user = userEvent.setup();
    render(
      <>
        <EditorThemePicker />
        <button type="button">After picker</button>
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editor theme' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.tab();

    expect(screen.getByRole('button', { name: 'After picker' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

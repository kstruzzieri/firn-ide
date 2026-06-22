import { render, screen, fireEvent } from '@testing-library/react';
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
    const trigger = screen.getByLabelText('Editor theme');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Abyssal Current');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens a listbox of all themes on click, marking the active one', () => {
    render(<EditorThemePicker />);
    fireEvent.click(screen.getByLabelText('Editor theme'));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(SYNTAX_THEMES.length);
    const selected = options.find((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveTextContent('Abyssal Current');
  });

  it('selecting an option updates the store and closes the menu', () => {
    render(<EditorThemePicker />);
    fireEvent.click(screen.getByLabelText('Editor theme'));
    fireEvent.click(screen.getByText('Tropic Coral Reef'));
    expect(useIDEStore.getState().editorSyntaxTheme).toBe('reef');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { EditorThemePicker } from '../../components/StatusBar/EditorThemePicker';
import { useIDEStore } from '../../stores/ideStore';
import { SYNTAX_THEMES } from '../../components/Editor/codemirror/palettes';

describe('EditorThemePicker', () => {
  beforeEach(() => {
    localStorage.clear();
    useIDEStore.getState().setEditorSyntaxTheme('abyssal');
  });

  it('renders all themes and reflects the active one', () => {
    render(<EditorThemePicker />);
    const select = screen.getByLabelText('Editor theme') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.options).toHaveLength(SYNTAX_THEMES.length);
    expect(select.value).toBe('abyssal');
  });

  it('changing the select updates the store', () => {
    render(<EditorThemePicker />);
    const select = screen.getByLabelText('Editor theme');
    fireEvent.change(select, { target: { value: 'reef' } });
    expect(useIDEStore.getState().editorSyntaxTheme).toBe('reef');
  });
});

import styles from './EditorThemePicker.module.css';
import { useEditorSyntaxTheme, useIDEStore } from '../../stores/ideStore';
import { SYNTAX_THEMES, isSyntaxThemeId } from '../../components/Editor/codemirror/palettes';

/**
 * Compact editor-theme selector for the status bar. Global app state, so it is
 * always rendered (independent of whether a file is open).
 */
export function EditorThemePicker() {
  const active = useEditorSyntaxTheme();
  const setTheme = useIDEStore((state) => state.setEditorSyntaxTheme);

  return (
    <label className={styles.picker}>
      <span className={styles.srOnly}>Editor theme</span>
      <select
        aria-label="Editor theme"
        className={styles.select}
        value={active}
        onChange={(event) => {
          const value = event.target.value;
          if (isSyntaxThemeId(value)) setTheme(value);
        }}
      >
        {SYNTAX_THEMES.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.label}
          </option>
        ))}
      </select>
    </label>
  );
}

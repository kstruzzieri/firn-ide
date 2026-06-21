import styles from './EditorThemePicker.module.css';
import { useEditorSyntaxTheme, useIDEStore } from '../../stores/ideStore';
import {
  SYNTAX_THEMES,
  SYNTAX_THEME_BY_ID,
  isSyntaxThemeId,
} from '../../components/Editor/codemirror/palettes';

/**
 * Compact editor-theme selector for the status bar. Global app state, so it is
 * always rendered (independent of whether a file is open).
 */
export function EditorThemePicker() {
  const active = useEditorSyntaxTheme();
  const setTheme = useIDEStore((state) => state.setEditorSyntaxTheme);
  const activeLabel = SYNTAX_THEME_BY_ID.get(active)?.label;

  return (
    <div className={styles.picker}>
      <select
        aria-label="Editor theme"
        title={activeLabel}
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
    </div>
  );
}

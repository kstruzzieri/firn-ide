import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './EditorThemePicker.module.css';
import { useEditorSyntaxTheme, useIDEStore } from '../../stores/ideStore';
import {
  SYNTAX_THEMES,
  SYNTAX_THEME_BY_ID,
  type SyntaxThemeId,
} from '../../components/Editor/codemirror/palettes';

/**
 * Editor-theme selector for the status bar. A custom popover (not a native
 * `<select>`, which the OS height-clips into a scrollbar when anchored at the
 * bottom of the window) so the full theme list always expands upward. Global app
 * state, so it is always rendered regardless of whether a file is open.
 */
export function EditorThemePicker() {
  const active = useEditorSyntaxTheme();
  const setTheme = useIDEStore((state) => state.setEditorSyntaxTheme);
  const activeLabel = SYNTAX_THEME_BY_ID.get(active)?.label ?? active;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Close on click outside the picker.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open, close]);

  // Move focus to the active option when the menu opens.
  useEffect(() => {
    if (!open) return;
    const index = SYNTAX_THEMES.findIndex((theme) => theme.id === active);
    optionRefs.current[Math.max(0, index)]?.focus();
  }, [open, active]);

  const choose = useCallback(
    (id: SyntaxThemeId) => {
      setTheme(id);
      close(true);
    },
    [close, setTheme]
  );

  const moveFocus = (from: number, delta: number) => {
    const count = SYNTAX_THEMES.length;
    optionRefs.current[(from + delta + count) % count]?.focus();
  };

  return (
    <div
      className={styles.picker}
      ref={containerRef}
      onBlur={(event) => {
        if (!open) return;
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        close();
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        aria-label="Editor theme"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={activeLabel}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={styles.triggerLabel}>{activeLabel}</span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <ul className={styles.menu} role="listbox" aria-label="Editor theme" tabIndex={-1}>
          {SYNTAX_THEMES.map((theme, index) => {
            const selected = theme.id === active;
            return (
              <li
                key={theme.id}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
                onClick={() => choose(theme.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    choose(theme.id);
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveFocus(index, 1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveFocus(index, -1);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    close(true);
                  }
                }}
              >
                <span className={styles.check} aria-hidden="true">
                  {selected ? '✓' : ''}
                </span>
                {theme.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

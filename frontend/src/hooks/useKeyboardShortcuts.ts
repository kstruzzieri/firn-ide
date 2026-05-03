import { useEffect } from 'react';
import { useOpenFolder } from './useOpenFolder';
import { isMac } from '../utils/platform';
import { useIDEStore, type NavigationLocation } from '../stores/ideStore';
import { navigateToEditorLocation } from '../utils/editorNavigation';

/**
 * Registers global keyboard shortcuts for the IDE.
 * Call this hook exactly ONCE at the app level (e.g., in IDEShell).
 */
export function useKeyboardShortcuts() {
  const { openFolder } = useOpenFolder();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mac = isMac();
      const modifier = mac ? e.metaKey : e.ctrlKey;

      // Cmd+O / Ctrl+O — Open folder
      if (modifier && e.key === 'o') {
        e.preventDefault();
        openFolder();
        return;
      }

      // Cmd+[ / Cmd+] on macOS, Alt+Left / Alt+Right elsewhere — editor navigation history.
      const isBack = mac
        ? e.metaKey && (e.key === '[' || e.code === 'BracketLeft')
        : e.altKey && e.key === 'ArrowLeft';
      const isForward = mac
        ? e.metaKey && (e.key === ']' || e.code === 'BracketRight')
        : e.altKey && e.key === 'ArrowRight';

      if (isBack || isForward) {
        const state = useIDEStore.getState();
        const current = currentEditorLocation(state);
        if (!current) return;

        const target = isBack ? state.goBack(current) : state.goForward(current);
        if (!target) return;

        e.preventDefault();
        navigateToEditorLocation(target.fileId, target.line, target.column);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openFolder]);
}

function currentEditorLocation(
  state: ReturnType<typeof useIDEStore.getState>
): NavigationLocation | null {
  const fileId = state.activeFileId;
  if (!fileId) return null;

  const cursor = state.cursorPositions[fileId] ?? state.cursorPosition;
  return {
    fileId,
    line: cursor.line,
    column: cursor.column,
  };
}

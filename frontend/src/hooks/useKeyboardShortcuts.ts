import { useEffect } from 'react';
import { useOpenFolder } from './useOpenFolder';
import { isMac } from '../utils/platform';

/**
 * Registers global keyboard shortcuts for the IDE.
 * Call this hook exactly ONCE at the app level (e.g., in IDEShell).
 */
export function useKeyboardShortcuts() {
  const { openFolder } = useOpenFolder();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = isMac() ? e.metaKey : e.ctrlKey;

      // Cmd+O / Ctrl+O — Open folder
      if (modifier && e.key === 'o') {
        e.preventDefault();
        openFolder();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openFolder]);
}

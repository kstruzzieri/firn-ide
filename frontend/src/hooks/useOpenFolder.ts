import { useCallback, useRef } from 'react';
import { useIDEStore } from '../stores/ideStore';
import { OpenFolderDialog } from '../../wailsjs/go/main/App';
import { WindowSetTitle } from '../../wailsjs/runtime/runtime';

/**
 * Shared hook for opening a folder via the native dialog.
 * Handles: native picker -> workspace state -> window title.
 *
 * Directory tree fetching is NOT done here — it's handled reactively by
 * `useDirectoryTree` which watches `workspace.path` changes.
 *
 * This hook only provides the `openFolder` action — it does NOT register
 * keyboard shortcuts. Use `useKeyboardShortcuts` once at the app level for that.
 */
export function useOpenFolder() {
  const setWorkspace = useIDEStore((state) => state.setWorkspace);
  const isOpeningRef = useRef(false);

  const openFolder = useCallback(async () => {
    // Guard against concurrent invocations (e.g., rapid double-click)
    if (isOpeningRef.current) return;
    isOpeningRef.current = true;

    try {
      const folderPath = await OpenFolderDialog();

      // User cancelled
      if (!folderPath) return;

      // Extract folder name from path
      const separator = folderPath.includes('\\') ? '\\' : '/';
      const folderName = folderPath.split(separator).pop() || folderPath;

      // Set workspace — this triggers useDirectoryTree to fetch the tree
      setWorkspace({ name: folderName, path: folderPath });

      // Update window title
      WindowSetTitle(`${folderName} — Firn`);
    } catch (err) {
      console.error('Failed to open folder:', err);
      useIDEStore
        .getState()
        .showToast(
          `Failed to open folder: ${err instanceof Error ? err.message : 'Unknown error'}`,
          'error'
        );
    } finally {
      isOpeningRef.current = false;
    }
  }, [setWorkspace]);

  return { openFolder };
}

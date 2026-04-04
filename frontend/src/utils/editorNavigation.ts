/**
 * Shared editor navigation utilities.
 *
 * Centralizes "open file if needed, then navigate to location" logic
 * so Problems panel, definition navigation, and other consumers
 * share a single code path instead of duplicating file-open flows.
 */

import { useIDEStore, type EditorFile } from '../stores/ideStore';
import { ReadFile } from '../../wailsjs/go/main/App';
import { createEditorFile } from './editorFile';
import { getFileNameFromPath, pathsReferToSameFile, toNativeLocalPath } from './lspUri';

/**
 * Opens a file in the editor if it isn't already open, and activates its tab.
 * Returns the EditorFile on success, or null if the file could not be read.
 */
export async function ensureEditorFileOpen(path: string): Promise<EditorFile | null> {
  const store = useIDEStore.getState();
  const localPath = toNativeLocalPath(path);

  // Already open — just activate and return
  const existing = store.openFiles.find((f) => pathsReferToSameFile(f.id, localPath));
  if (existing) {
    store.setActiveFile(existing.id);
    return existing;
  }

  // Read and open
  try {
    const content = await ReadFile(localPath);
    if (content.isBinary) {
      store.showToast(`Cannot open binary file: ${getFileNameFromPath(localPath)}`, 'error');
      return null;
    }

    const file = createEditorFile(localPath, content);
    store.openFile(file);
    return file;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    store.showToast(`Failed to open file: ${message}`, 'error');
    return null;
  }
}

/**
 * Opens a file (if needed), activates the tab, and requests a cursor jump
 * to the given 1-based line and column.
 */
export async function navigateToEditorLocation(
  path: string,
  line: number,
  column: number
): Promise<void> {
  const file = await ensureEditorFileOpen(path);
  if (!file) return;

  useIDEStore.getState().requestEditorNavigation(file.id, line, column);
}

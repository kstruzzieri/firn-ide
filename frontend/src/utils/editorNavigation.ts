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
import { flushWorkingTreeEdit } from './fileWrites';
import { getFileNameFromPath, pathsReferToSameFile, toNativeLocalPath } from './lspUri';

interface EditorNavigationOptions {
  shouldApply?: () => boolean;
}

function shouldApplyNavigation(options?: EditorNavigationOptions): boolean {
  return options?.shouldApply?.() ?? true;
}

/**
 * Opens a file in the editor if it isn't already open, and activates its tab.
 * Returns the EditorFile on success, or null if the file could not be read.
 */
export async function ensureEditorFileOpen(
  path: string,
  options?: EditorNavigationOptions
): Promise<EditorFile | null> {
  const localPath = toNativeLocalPath(path);

  try {
    await flushWorkingTreeEdit(localPath);
  } catch {
    return null; // the pending write already surfaced its save error
  }

  // Already open — just activate and return
  const existing = useIDEStore
    .getState()
    .openFiles.find((f) => pathsReferToSameFile(f.id, localPath));
  if (existing) {
    if (!shouldApplyNavigation(options)) return null;
    useIDEStore.getState().setActiveFile(existing.id);
    return existing;
  }

  // Read and open
  try {
    const content = await ReadFile(localPath);
    if (!shouldApplyNavigation(options)) return null;

    if (content.isBinary) {
      useIDEStore
        .getState()
        .showToast(`Cannot open binary file: ${getFileNameFromPath(localPath)}`, 'error');
      return null;
    }

    const file = createEditorFile(localPath, content);
    useIDEStore.getState().openFile(file);
    return file;
  } catch (err) {
    if (!shouldApplyNavigation(options)) return null;

    const message = err instanceof Error ? err.message : 'Unknown error';
    useIDEStore.getState().showToast(`Failed to open file: ${message}`, 'error');
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
  column: number,
  options?: EditorNavigationOptions
): Promise<void> {
  const file = await ensureEditorFileOpen(path, options);
  if (!file) return;
  if (!shouldApplyNavigation(options)) return;

  useIDEStore.getState().requestEditorNavigation(file.id, line, column);
}

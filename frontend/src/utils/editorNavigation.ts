/**
 * Shared editor navigation utilities.
 *
 * Centralizes "open file if needed, then navigate to location" logic
 * so Problems panel, definition navigation, and other consumers
 * share a single code path instead of duplicating file-open flows.
 */

import { useIDEStore, type EditorFile } from '../stores/ideStore';
import { useGitStore } from '../stores/gitStore';
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
    useGitStore.getState().setEditorFocus('file');
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
    useGitStore.getState().setEditorFocus('file');
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
  // Register the navigation BEFORE the tab is activated when the file is already
  // open. Activating a tab runs the editor's file-switch effect, which restores
  // a background tab's remembered scroll position; if the navigation is already
  // pending when that runs, the editor skips the scroll restore and lets this
  // jump own the viewport. Setting it only afterwards (which a not-yet-open file
  // must do, since its id doesn't exist until it opens) loses the jump for an
  // already-open background tab — the file switches but the target line stays
  // off-screen. A not-yet-open file has no cached scroll, so ordering is moot
  // there and the post-open request below covers it.
  const localPath = toNativeLocalPath(path);
  const existing = useIDEStore
    .getState()
    .openFiles.find((f) => pathsReferToSameFile(f.id, localPath));
  if (existing && shouldApplyNavigation(options)) {
    useIDEStore.getState().requestEditorNavigation(existing.id, line, column);
  }

  const file = await ensureEditorFileOpen(path, options);
  if (!file) return;
  if (!shouldApplyNavigation(options)) return;

  // Freshly opened file (or a re-request after an interrupted open): the id was
  // not known before activation, so request the jump now.
  if (!existing) {
    useIDEStore.getState().requestEditorNavigation(file.id, line, column);
  }
}

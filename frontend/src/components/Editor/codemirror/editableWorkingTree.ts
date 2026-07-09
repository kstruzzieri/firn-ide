/**
 * Editable working-tree side of the git diff viewer (issue #169).
 *
 * The working tree is the only side of a diff that is a live file rather than a
 * revision snapshot, so it is the only side the user may edit — and only in an
 * unstaged diff, where the right pane shows the working tree (in a staged diff
 * the right pane is the index snapshot). Edits route to a single source of
 * truth: the open editor buffer if the file is open (the diff already reads that
 * buffer), else straight to disk. Extracted from GitDiffView so the persist +
 * update-listener wiring is unit-testable without a live CodeMirror view.
 */
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { WriteFile } from '../../../../wailsjs/go/main/App';
import { useIDEStore } from '../../../stores/ideStore';
import type { DiffSession } from '../../../stores/gitStore';
import { pathsReferToSameFile } from '../../../utils/lspUri';

/** Debounce for the disk-write path so typing doesn't hammer the filesystem
 * (and the watcher-driven git refresh) on every keystroke. The open-buffer path
 * is already debounced by autosave. Keyed by path (not a single timer): the
 * debounce outlives the view, so switching diffs before a pending write fires
 * must not drop the previous file's edit. */
const DISK_WRITE_DEBOUNCE_MS = 400;
const diskWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Whether the working-tree (right) pane of this diff is editable: only an
 * unstaged, textual, in-size diff qualifies. Staged (HEAD → index), binary, and
 * too-large diffs stay read-only on both sides.
 */
export function isWorkingTreeEditable(session: DiffSession): boolean {
  return session.context === 'unstaged' && !session.binary && !session.truncated;
}

/**
 * Persist an edit to the working-tree side of a diff. If the file is open in the
 * editor, route the edit through its buffer so the editor and the diff stay a
 * single source of truth — autosave then debounces the write to disk and the
 * FS-watcher-driven git refresh repaints the diff.
 */
export function persistWorkingTreeEdit(session: DiffSession, content: string): void {
  const openFile = useIDEStore
    .getState()
    .openFiles.find((f) => pathsReferToSameFile(f.path, session.absPath));
  if (openFile) {
    // A rebuilt merge view re-emits its initial doc as a change; ignore edits
    // that match the buffer so a saved file is not needlessly marked dirty.
    if (openFile.content === content) return;
    useIDEStore.getState().updateFileContent(openFile.id, content);
    return;
  }

  // File not open in the editor: write straight to disk, preserving the
  // working-tree file's detected encoding/line endings. Debounced so a burst of
  // keystrokes yields one write; the FS-watcher-driven git refresh then re-reads
  // disk and repaints the diff, so no explicit refresh is needed here.
  const { absPath, path, worktreeEncoding, worktreeLineEndings } = session;
  const existing = diskWriteTimers.get(absPath);
  if (existing) clearTimeout(existing);
  diskWriteTimers.set(
    absPath,
    setTimeout(() => {
      diskWriteTimers.delete(absPath);
      void WriteFile(
        absPath,
        content,
        worktreeEncoding ?? 'utf-8',
        worktreeLineEndings ?? '',
        false
      ).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        useIDEStore.getState().showToast(`Failed to save ${path}: ${message}`, 'error');
      });
    }, DISK_WRITE_DEBOUNCE_MS)
  );
}

/**
 * A CodeMirror extension for the working-tree pane that persists edits as they
 * happen. Attach it to the right pane only, and only when the diff is editable
 * (see isWorkingTreeEditable). Non-doc updates (scroll, selection, folding) are
 * ignored so only real edits write back.
 */
export function workingTreeEditListener(session: DiffSession): Extension {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged) {
      persistWorkingTreeEdit(session, update.state.doc.toString());
    }
  });
}

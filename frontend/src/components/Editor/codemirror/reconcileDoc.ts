/**
 * Reconcile a view's document to `nextContent` using a minimal
 * common-prefix/suffix splice, marked as NOT undoable. Used for external
 * content changes (file reload) on the active or a just-restored cached file,
 * so a disk change never lands on the user's undo stack. No-op if unchanged.
 */
import { EditorView } from '@codemirror/view';
import { Annotation, Transaction } from '@codemirror/state';

/** Identifies authoritative external content updates so they are not persisted as user edits. */
export const externalDocUpdate = Annotation.define<boolean>();

export function reconcileDoc(view: EditorView, nextContent: string): void {
  const cur = view.state.doc.toString();
  if (cur === nextContent) return;

  let start = 0;
  const minLen = Math.min(cur.length, nextContent.length);
  while (start < minLen && cur[start] === nextContent[start]) start++;

  let endCur = cur.length;
  let endNext = nextContent.length;
  while (endCur > start && endNext > start && cur[endCur - 1] === nextContent[endNext - 1]) {
    endCur--;
    endNext--;
  }

  view.dispatch({
    changes: { from: start, to: endCur, insert: nextContent.slice(start, endNext) },
    annotations: [Transaction.addToHistory.of(false), externalDocUpdate.of(true)],
  });
}

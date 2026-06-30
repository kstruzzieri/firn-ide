import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';

import { reconcileDoc } from '../../../components/Editor/codemirror/reconcileDoc';

function makeView(doc: string, extensions: Extension[] = []): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: [history(), ...extensions] }),
  });
}

describe('reconcileDoc', () => {
  it('is a no-op when content already matches', () => {
    const view = makeView('hello');
    reconcileDoc(view, 'hello');
    expect(view.state.doc.toString()).toBe('hello');
  });

  it('updates the document to the new content', () => {
    const view = makeView('hello world');
    reconcileDoc(view, 'hello brave world');
    expect(view.state.doc.toString()).toBe('hello brave world');
  });

  it('applies a minimal splice (preserves the common prefix/suffix region)', () => {
    // Only the middle differs; from/to should bound just the changed region.
    let changedFrom = -1;
    let changedTo = -1;
    const view = makeView('abcXYZdef', [
      EditorState.transactionFilter.of((tr) => {
        tr.changes.iterChanges((fromA, toA) => {
          changedFrom = fromA;
          changedTo = toA;
        });
        return tr;
      }),
    ]);
    reconcileDoc(view, 'abc123def');
    expect(changedFrom).toBe(3);
    expect(changedTo).toBe(6);
  });

  it('does not add the external change to undo history', () => {
    const view = makeView('original');
    reconcileDoc(view, 'reloaded from disk');
    // No prior user edit + non-undoable reconcile => nothing to undo.
    const didUndo = undo(view);
    expect(didUndo).toBe(false);
    expect(view.state.doc.toString()).toBe('reloaded from disk');
  });
});

import { EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';

// CodeMirrorEditor transitively imports the Wails-generated App module (ESM,
// untransformed by ts-jest); mock it so the module graph loads under jsdom.
jest.mock('../../../../wailsjs/go/main/App', () => ({}));
jest.mock('../../../../wailsjs/runtime/runtime', () => ({ WindowSetTitle: jest.fn() }));

import { reconcileDoc } from '../../../components/Editor/CodeMirrorEditor';

function makeView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: [history()] }),
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
    const view = makeView('abcXYZdef');
    // Only the middle differs; from/to should bound just the changed region.
    let changedFrom = -1;
    let changedTo = -1;
    view.dispatch = (...specs: (TransactionSpec | TransactionSpec[])[]) => {
      const first = specs[0];
      const spec = Array.isArray(first) ? first[0] : first;
      const changes = spec?.changes as { from: number; to?: number } | undefined;
      changedFrom = changes?.from ?? -1;
      changedTo = changes?.to ?? -1;
    };
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

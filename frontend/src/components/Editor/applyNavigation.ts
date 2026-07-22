import { EditorView } from '@codemirror/view';
import type { EditorNavigationRequest } from '../../stores/ideStore';

/**
 * Move the cursor to a navigation target and scroll it into view.
 *
 * Lives in its own module (rather than inside CodeMirrorEditor) so it can be
 * unit tested without the component's heavy CodeMirror mock, and so the
 * component file only exports React components (fast-refresh friendly).
 */
export function applyNavigation(view: EditorView, nav: EditorNavigationRequest): void {
  const lineNum = Math.min(nav.line, view.state.doc.lines);
  if (lineNum <= 0) return;
  const line = view.state.doc.line(lineNum);
  const col = Math.min((nav.column ?? 1) - 1, line.length);
  const pos = line.from + col;

  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  });
  view.focus();

  // When the target file was just opened, its EditorState was swapped into the
  // shared view in this same commit and the new document has not been measured
  // yet. CodeMirror resolves `scrollIntoView: true` on its next measure against
  // estimated line geometry, so a match far down the file is left off-screen
  // (the cursor lands correctly, but the viewport doesn't move). Re-assert the
  // scroll on the next animation frame — by then the new document is laid out,
  // so the target line's real offset is known. rAF runs outside CodeMirror's
  // update cycle, where dispatching is safe (unlike requestMeasure callbacks).
  // Guards: bail if the view was torn down, if the doc no longer reaches the
  // line, or if a rapid file switch / follow-up navigation has moved the
  // selection off pos — so we never yank a view the user has moved on to.
  requestAnimationFrame(() => {
    if (!view.dom.isConnected) return;
    if (view.state.doc.lines < lineNum) return;
    if (view.state.selection.main.head !== pos) return;
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  });
}

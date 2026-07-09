/**
 * Per-hunk staging gutter for the diff viewer. Renders a stage/unstage button
 * at each git hunk's new-side start line in the right pane, backed by the
 * store's applyHunk (git apply --cached). The hunk set is fixed for a given
 * diff session, so the markers are static — a fresh session rebuilds the pane.
 */
import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import { RangeSet, type Extension } from '@codemirror/state';
import type { git } from '../../../../wailsjs/go/models';
import { useGitStore, type DiffContext } from '../../../stores/gitStore';

/**
 * How a hunk control behaves in a given diff context. An 'unstaged' diff
 * (index → working tree) stages its hunks into the index; a 'staged' diff
 * (HEAD → index) unstages them (git apply --reverse).
 */
export function hunkStagingAction(context: DiffContext): { reverse: boolean; label: string } {
  return context === 'staged'
    ? { reverse: true, label: 'Unstage hunk' }
    : { reverse: false, label: 'Stage hunk' };
}

/**
 * The clickable gutter button for one hunk. Extracted from the GutterMarker so
 * the click → applyHunk wiring is testable without a live CodeMirror view.
 */
export function createHunkButton(hunk: git.Hunk, context: DiffContext): HTMLButtonElement {
  const { reverse, label } = hunkStagingAction(context);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cm-hunkStageBtn';
  btn.textContent = reverse ? '−' : '+';
  btn.title = label;
  btn.setAttribute('aria-label', `${label} at line ${hunk.newStart}`);
  // stopPropagation so the click doesn't reach the editor's own gutter/selection
  // handlers; preventDefault so the read-only view doesn't try to focus.
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void useGitStore.getState().applyHunk(hunk.patch, reverse);
  });
  return btn;
}

class HunkMarker extends GutterMarker {
  constructor(
    private readonly hunk: git.Hunk,
    private readonly context: DiffContext
  ) {
    super();
  }
  override toDOM(): Node {
    return createHunkButton(this.hunk, this.context);
  }
}

/**
 * A gutter for the right pane carrying a stage/unstage button at each hunk's
 * new-side start line. Returns nothing when there are no hunks (untracked,
 * binary, too-large, or clean diffs) so the pane stays plain.
 */
export function hunkStagingGutter(hunks: git.Hunk[], context: DiffContext): Extension {
  if (hunks.length === 0) return [];
  return gutter({
    class: 'cm-hunkGutter',
    markers: (view: EditorView) => {
      const doc = view.state.doc;
      const ranges = hunks
        .filter((h) => h.newStart >= 1 && h.newStart <= doc.lines)
        .map((h) => new HunkMarker(h, context).range(doc.line(h.newStart).from));
      return RangeSet.of(ranges, true); // true = sort; hunks are already ascending
    },
  });
}

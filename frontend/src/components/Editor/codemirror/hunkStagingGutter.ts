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
import { diffLines } from '../../../utils/lineDiff';

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
 * Which hunk controls stay valid while the pane holds unsaved edits, and on
 * which line each now sits. A hunk's patch applies to the *index*, so a local
 * edit only invalidates the hunks whose snapshot lines it touches — the rest
 * stay stageable, with their anchors shifted past inserted/removed lines. This
 * keeps untouched +/− buttons from flickering away on every keystroke or
 * popup revert while the debounced save/refresh is in flight.
 */
export function visibleHunks(
  hunks: git.Hunk[],
  cleanContent: string,
  currentContent: string
): { hunk: git.Hunk; line: number }[] {
  if (currentContent === cleanContent) return hunks.map((h) => ({ hunk: h, line: h.newStart }));
  // Local edits as line ranges: [fromA, toA) in snapshot coords, [fromB, toB)
  // in on-screen coords (0-based, exclusive).
  const edits = diffLines(cleanContent, currentContent);
  const out: { hunk: git.Hunk; line: number }[] = [];
  for (const h of hunks) {
    const start = h.newStart - 1;
    const end = start + h.newLines;
    let offset = 0;
    let stale = false;
    for (const e of edits) {
      if (e.fromA < end && e.toA > start) {
        stale = true;
        break;
      }
      if (e.toA <= start) offset += e.toB - e.fromB - (e.toA - e.fromA);
    }
    if (!stale) out.push({ hunk: h, line: h.newStart + offset });
  }
  return out;
}

/**
 * A gutter for the right pane carrying a stage/unstage button at each hunk's
 * new-side start line. Returns nothing when there are no hunks (untracked,
 * binary, too-large, or clean diffs) so the pane stays plain.
 */
export function hunkStagingGutter(
  hunks: git.Hunk[],
  context: DiffContext,
  cleanContent?: string
): Extension {
  if (hunks.length === 0) return [];
  return gutter({
    class: 'cm-hunkGutter',
    markers: (view: EditorView) => {
      const doc = view.state.doc;
      // An editable pane can diverge from the git snapshot before its debounced
      // save/refresh. Keep the controls whose patches are still valid (shifted
      // to their on-screen lines) and hide only the ones the edits touched.
      const visible =
        cleanContent === undefined
          ? hunks.map((h) => ({ hunk: h, line: h.newStart }))
          : visibleHunks(hunks, cleanContent, doc.toString());
      const ranges = visible
        .filter(({ line }) => line >= 1 && line <= doc.lines)
        .map(({ hunk, line }) => new HunkMarker(hunk, context).range(doc.line(line).from));
      if (ranges.length === 0) return RangeSet.empty;
      return RangeSet.of(ranges, true); // true = sort; hunks are already ascending
    },
  });
}

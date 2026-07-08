/**
 * Git change gutter: added/modified/deleted line markers against a HEAD
 * baseline pushed in via setGitBaseline, plus next/previous change commands
 * (Mod-Alt-Shift-ArrowDown/Up, the JetBrains-style bindings).
 */
import {
  EditorView,
  gutter,
  GutterMarker,
  keymap,
  showTooltip,
  type Tooltip,
} from '@codemirror/view';
import { StateEffect, StateField, RangeSet, type Extension } from '@codemirror/state';
import {
  diffLines,
  gitLineMarkers,
  inlineWordDiff,
  revertHunkChange,
  splitLines,
  type GitLineMarker,
  type LineHunk,
} from '../../../utils/lineDiff';

/** Above this doc size the gutter goes dormant; diffing every keystroke on
 * huge files is not worth a decoration. Matches the backend diffable cap. */
const maxGutterDocBytes = 1 << 20;

export const setGitBaseline = StateEffect.define<string | null>();

interface GitGutterState {
  baseline: string | null;
  markers: GitLineMarker[];
}

const gitGutterField = StateField.define<GitGutterState>({
  create: () => ({ baseline: null, markers: [] }),
  update(value, tr) {
    let baseline = value.baseline;
    let baselineChanged = false;
    for (const effect of tr.effects) {
      if (effect.is(setGitBaseline)) {
        baseline = effect.value;
        baselineChanged = true;
      }
    }
    if (!baselineChanged && !tr.docChanged) return value;
    if (baseline === null || tr.newDoc.length > maxGutterDocBytes) {
      return { baseline, markers: [] };
    }
    return { baseline, markers: gitLineMarkers(baseline, tr.newDoc.toString()) };
  },
});

class ChangeMarker extends GutterMarker {
  constructor(private readonly type: GitLineMarker['type']) {
    super();
  }
  override elementClass = '';
  override toDOM(): Node {
    const el = document.createElement('div');
    el.className = `cm-gitGutterMarker cm-gitGutter-${this.type}`;
    return el;
  }
  override eq(other: ChangeMarker): boolean {
    return other.type === this.type;
  }
}

const markerInstances = {
  added: new ChangeMarker('added'),
  modified: new ChangeMarker('modified'),
  deleted: new ChangeMarker('deleted'),
};

function buildMarkerSet(view: EditorView): RangeSet<GutterMarker> {
  const { markers } = view.state.field(gitGutterField);
  const doc = view.state.doc;
  const ranges = [];
  for (const m of markers) {
    if (m.line > doc.lines) continue;
    const pos = doc.line(m.line).from;
    ranges.push(markerInstances[m.type].range(pos));
  }
  return RangeSet.of(ranges, true);
}

function markerLines(view: EditorView): number[] {
  return [...new Set(view.state.field(gitGutterField).markers.map((m) => m.line))].sort(
    (a, b) => a - b
  );
}

function gotoChange(view: EditorView, direction: 1 | -1): boolean {
  const lines = markerLines(view);
  if (lines.length === 0) return false;
  const current = view.state.doc.lineAt(view.state.selection.main.head).number;
  const target =
    direction === 1
      ? (lines.find((l) => l > current) ?? lines[0])
      : ([...lines].reverse().find((l) => l < current) ?? lines[lines.length - 1]);
  const pos = view.state.doc.line(target).from;
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  return true;
}

export const gotoNextGitChange = (view: EditorView) => gotoChange(view, 1);
export const gotoPrevGitChange = (view: EditorView) => gotoChange(view, -1);

// --- Hunk peek/revert popup (JetBrains-style change marker click) ---

/** Finds the hunk whose gutter marker sits on the given 1-based current line. */
function hunkForLine(baseline: string, current: string, line: number): LineHunk | null {
  const lineCount = splitLines(current).length;
  for (const h of diffLines(baseline, current)) {
    if (h.fromB === h.toB) {
      // Deletion: marker anchors to the line following the removal point.
      if (line === Math.max(1, Math.min(h.fromB + 1, lineCount))) return h;
    } else if (line >= h.fromB + 1 && line <= h.toB) {
      return h;
    }
  }
  return null;
}

const setHunkTooltip = StateEffect.define<Tooltip | null>();

const hunkTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    // Any edit (including the revert itself) invalidates the hunk, so drop it.
    if (tr.docChanged) value = null;
    for (const effect of tr.effects) {
      if (effect.is(setHunkTooltip)) value = effect.value;
    }
    return value;
  },
  provide: (f) => showTooltip.from(f),
});

/** The current working-tree text for a hunk's B-range, or '' for a pure deletion. */
function currentHunkText(view: EditorView, hunk: LineHunk): string {
  if (hunk.toB <= hunk.fromB) return '';
  const doc = view.state.doc;
  return doc.sliceString(doc.line(hunk.fromB + 1).from, doc.line(hunk.toB).to);
}

/** Renders a unified inline word-diff of baseline vs working tree into `pre`:
 * unchanged text plain, removed words struck red, added words green — so both
 * sides are visible and distinct (JetBrains-style inline diff). */
function renderInlineDiff(pre: HTMLElement, oldText: string, newText: string): void {
  for (const segment of inlineWordDiff(oldText, newText)) {
    if (segment.type === 'same') {
      pre.appendChild(document.createTextNode(segment.text));
      continue;
    }
    const span = document.createElement('span');
    span.className = segment.type === 'del' ? 'firn-git-diff-del' : 'firn-git-diff-ins';
    span.textContent = segment.text;
    pre.appendChild(span);
  }
}

/** Builds the peek/revert popup anchored at the hunk's first current line. */
function makeHunkTooltip(baseline: string, hunk: LineHunk, pos: number): Tooltip {
  return {
    pos,
    above: false,
    arrow: false,
    create(view) {
      const dom = document.createElement('div');
      dom.className = 'firn-git-hunk';

      const oldText = splitLines(baseline).slice(hunk.fromA, hunk.toA).join('\n');
      const body = document.createElement('div');
      body.className = 'firn-git-hunk-body';
      const pre = document.createElement('pre');
      pre.className = 'firn-git-hunk-diff';
      renderInlineDiff(pre, oldText, currentHunkText(view, hunk));
      body.appendChild(pre);
      dom.appendChild(body);

      const actions = document.createElement('div');
      actions.className = 'firn-git-hunk-actions';

      const revert = document.createElement('button');
      revert.className = 'firn-git-hunk-action';
      revert.type = 'button';
      revert.textContent = 'Revert';
      revert.title = 'Revert this change to HEAD';
      revert.addEventListener('click', (e) => {
        e.preventDefault();
        view.dispatch({
          changes: revertHunkChange(view.state.doc.toString(), baseline, hunk),
        });
        view.focus();
      });
      actions.appendChild(revert);

      dom.appendChild(actions);
      return { dom };
    },
  };
}

/** Opens the peek/revert popup for the change gutter cell that was clicked. */
function openHunkTooltip(view: EditorView, lineFrom: number): boolean {
  const { baseline } = view.state.field(gitGutterField);
  if (baseline === null) return false;
  const current = view.state.doc.toString();
  const line = view.state.doc.lineAt(lineFrom).number;
  const hunk = hunkForLine(baseline, current, line);
  if (hunk === null) return false;
  view.dispatch({ effects: setHunkTooltip.of(makeHunkTooltip(baseline, hunk, lineFrom)) });
  return true;
}

/** Dismisses an open peek popup when the click lands outside it (and outside
 * the change gutter, whose own handler opens/replaces the popup). */
const dismissHunkTooltipOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (view.state.field(hunkTooltipField) === null) return false;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.firn-git-hunk') || target?.closest('.cm-gitGutter')) return false;
    view.dispatch({ effects: setHunkTooltip.of(null) });
    return false;
  },
});

export function gitGutterExtension(): Extension {
  return [
    gitGutterField,
    hunkTooltipField,
    gutter({
      class: 'cm-gitGutter',
      markers: buildMarkerSet,
      domEventHandlers: {
        mousedown(view, block) {
          return openHunkTooltip(view, block.from);
        },
      },
    }),
    dismissHunkTooltipOnClick,
    keymap.of([
      { key: 'Mod-Alt-Shift-ArrowDown', run: gotoNextGitChange },
      { key: 'Mod-Alt-Shift-ArrowUp', run: gotoPrevGitChange },
    ]),
  ];
}

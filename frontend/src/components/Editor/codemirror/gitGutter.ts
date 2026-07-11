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
import { highlightTree } from '@lezer/highlight';
import { highlightingFor, language } from '@codemirror/language';
import {
  commonIndent,
  diffLines,
  gitLineMarkers,
  inlineWordDiff,
  revertChangeIsSafe,
  revertHunkChange,
  revertLineChange,
  splitLines,
  type GitLineMarker,
  type LineHunk,
} from '../../../utils/lineDiff';
import { useIDEStore } from '../../../stores/ideStore';

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

/** Text plus a per-character syntax class array kept in lockstep with it. */
interface HighlightedText {
  text: string;
  classes: string[];
}

/** Per-character syntax classes for `text`, parsed with the view's own
 * language and mapped through its active highlight style (highlightingFor), so
 * popup tokens get exactly the classes — and therefore colors — the main
 * editor canvas uses. Empty when the view has no language.
 * ponytail: parses the full text on every popup open; cache per baseline if it
 * ever shows on profiles (files are capped at 1MB upstream). */
function charClasses(view: EditorView, text: string): string[] {
  const classes: string[] = new Array<string>(text.length).fill('');
  const lang = view.state.facet(language);
  if (!lang) return classes;
  const tree = lang.parser.parse(text);
  highlightTree(tree, { style: (tags) => highlightingFor(view.state, tags) }, (from, to, cls) => {
    for (let i = from; i < to; i++) classes[i] = cls;
  });
  return classes;
}

/** Slices the 0-based line range [fromLine, toLine) out of a highlighted full
 * text, keeping text and classes aligned. Empty for an empty range. */
function sliceLines(full: HighlightedText, fromLine: number, toLine: number): HighlightedText {
  if (fromLine >= toLine) return { text: '', classes: [] };
  const lines = splitLines(full.text);
  let start = 0;
  for (let i = 0; i < fromLine && i < lines.length; i++) start += lines[i].length + 1;
  let end = start;
  for (let i = fromLine; i < toLine && i < lines.length; i++) end += lines[i].length + 1;
  end = Math.min(end - 1, full.text.length);
  return { text: full.text.slice(start, end), classes: full.classes.slice(start, end) };
}

/** Strips `indent` from the start of each line, dropping the same characters
 * from the class array so highlighting stays aligned. */
function stripIndent(ht: HighlightedText, indent: string): HighlightedText {
  if (!indent) return ht;
  const outText: string[] = [];
  const outClasses: string[] = [];
  let pos = 0;
  for (const line of ht.text.split('\n')) {
    const drop = line.startsWith(indent) ? indent.length : 0;
    outText.push(line.slice(drop));
    for (let i = pos + drop; i < pos + line.length; i++) outClasses.push(ht.classes[i] ?? '');
    outClasses.push(''); // the joining '\n'
    pos += line.length + 1;
  }
  outClasses.pop();
  return { text: outText.join('\n'), classes: outClasses };
}

/** Appends `text` to `parent` as syntax-colored runs, reading each character's
 * class from `classes` starting at `offset`. With `markNewlines`, each line
 * break also gets a faint return glyph — inside a del/ins segment the break
 * itself is part of the change (an added or removed line) and would otherwise
 * be invisible. */
function appendHighlighted(
  parent: HTMLElement,
  text: string,
  classes: string[],
  offset: number,
  markNewlines = false
): void {
  let runClass = classes[offset] ?? '';
  let run = '';
  const flush = () => {
    if (!run) return;
    if (runClass) {
      const span = document.createElement('span');
      span.className = runClass;
      span.textContent = run;
      parent.appendChild(span);
    } else {
      parent.appendChild(document.createTextNode(run));
    }
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    if (markNewlines && text[i] === '\n') {
      flush();
      const glyph = document.createElement('span');
      glyph.className = 'firn-git-diff-newline';
      glyph.textContent = '↵';
      parent.appendChild(glyph);
      parent.appendChild(document.createTextNode('\n'));
      runClass = classes[offset + i + 1] ?? '';
      continue;
    }
    const cls = classes[offset + i] ?? '';
    if (cls !== runClass) {
      flush();
      runClass = cls;
    }
    run += text[i];
  }
  flush();
}

/** Renders a unified inline word-diff of baseline vs working tree into `pre`:
 * removed words struck red, added words green, and every side syntax-colored —
 * both sides visible and distinct (JetBrains-style inline diff). The class
 * arrays ride along each side's text, so token colors stay coherent across the
 * del/ins seams. */
function renderInlineDiff(pre: HTMLElement, oldSide: HighlightedText, newSide: HighlightedText) {
  let oi = 0;
  let ni = 0;
  for (const segment of inlineWordDiff(oldSide.text, newSide.text)) {
    if (segment.type === 'same') {
      appendHighlighted(pre, segment.text, newSide.classes, ni);
      oi += segment.text.length;
      ni += segment.text.length;
      continue;
    }
    const span = document.createElement('span');
    span.className = segment.type === 'del' ? 'firn-git-diff-del' : 'firn-git-diff-ins';
    if (segment.type === 'del') {
      appendHighlighted(span, segment.text, oldSide.classes, oi, true);
      oi += segment.text.length;
    } else {
      appendHighlighted(span, segment.text, newSide.classes, ni, true);
      ni += segment.text.length;
    }
    pre.appendChild(span);
  }
}

/** Builds the peek/revert popup anchored at the hunk's first current line.
 * `clickedLine` (1-based, current doc) picks the line a single-line revert
 * applies to. */
function makeHunkTooltip(
  baseline: string,
  hunk: LineHunk,
  pos: number,
  clickedLine: number
): Tooltip {
  return {
    pos,
    above: false,
    arrow: false,
    create(view) {
      const dom = document.createElement('div');
      dom.className = 'firn-git-hunk';

      // Highlight both sides as FULL documents — a hunk fragment parsed alone
      // loses its surrounding context (a struct field outside its struct stops
      // being a type) and drops colors the canvas shows — then slice the hunk
      // out and strip the shared indent, classes riding along. Reverts still
      // use the raw baseline text.
      const currentText = view.state.doc.toString();
      const oldRaw = sliceLines(
        { text: baseline, classes: charClasses(view, baseline) },
        hunk.fromA,
        hunk.toA
      );
      const newRaw = sliceLines(
        { text: currentText, classes: charClasses(view, currentText) },
        hunk.fromB,
        hunk.toB
      );
      const indent = commonIndent(oldRaw.text, newRaw.text);
      const body = document.createElement('div');
      body.className = 'firn-git-hunk-body';
      const pre = document.createElement('pre');
      pre.className = 'firn-git-hunk-diff';
      renderInlineDiff(pre, stripIndent(oldRaw, indent), stripIndent(newRaw, indent));
      body.appendChild(pre);
      dom.appendChild(body);

      const actions = document.createElement('div');
      actions.className = 'firn-git-hunk-actions';

      // Dispatch a revert with the cursor moved to the change site: the pane
      // may never have had a selection (gutter-only interaction leaves it at
      // doc start), and the focus() below scrolls to the cursor — without the
      // anchor the view would jump to the top of the file. The safety rail
      // refuses any change wider than the displayed hunk's line window — that
      // means the hunk's coordinates no longer match the document (stale
      // baseline or similar) and applying it could destroy unrelated content.
      const applyRevert = (change: { from: number; to: number; insert: string }) => {
        const docNow = view.state.doc.toString();
        if (!revertChangeIsSafe(change, hunk, docNow)) {
          useIDEStore
            .getState()
            .showToast(
              `Revert blocked: change [${change.from}, ${change.to}] escapes hunk ` +
                `lines ${hunk.fromB + 1}-${hunk.toB} (doc ${docNow.length} chars, ` +
                `baseline ${baseline.length} chars) — please report this`,
              'error'
            );
          return;
        }
        view.dispatch({ changes: change, selection: { anchor: change.from } });
        view.focus();
      };

      // Single-line revert, when the clicked line maps to a baseline line and
      // the hunk covers more than that one line (otherwise it equals Revert).
      const lineChange = revertLineChange(currentText, baseline, hunk, clickedLine);
      if (lineChange && hunk.toB - hunk.fromB > 1) {
        const revertLine = document.createElement('button');
        revertLine.className = 'firn-git-hunk-action';
        revertLine.type = 'button';
        revertLine.textContent = 'Revert Line';
        revertLine.title = `Revert only line ${clickedLine}`;
        revertLine.addEventListener('click', (e) => {
          e.preventDefault();
          applyRevert(lineChange);
        });
        actions.appendChild(revertLine);
      }

      const revert = document.createElement('button');
      revert.className = 'firn-git-hunk-action';
      revert.type = 'button';
      revert.textContent = 'Revert';
      revert.title = 'Revert this change';
      revert.addEventListener('click', (e) => {
        e.preventDefault();
        applyRevert(revertHunkChange(view.state.doc.toString(), baseline, hunk));
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
  view.dispatch({ effects: setHunkTooltip.of(makeHunkTooltip(baseline, hunk, lineFrom, line)) });
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

/**
 * Git change gutter: added/modified/deleted line markers against a HEAD
 * baseline pushed in via setGitBaseline, plus next/previous change commands
 * (Mod-Alt-Shift-ArrowDown/Up, the JetBrains-style bindings).
 */
import { gutter, GutterMarker, keymap, type EditorView } from '@codemirror/view';
import { StateEffect, StateField, RangeSet, type Extension } from '@codemirror/state';
import { gitLineMarkers, type GitLineMarker } from '../../../utils/lineDiff';

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

export function gitGutterExtension(): Extension {
  return [
    gitGutterField,
    gutter({
      class: 'cm-gitGutter',
      markers: buildMarkerSet,
    }),
    keymap.of([
      { key: 'Mod-Alt-Shift-ArrowDown', run: gotoNextGitChange },
      { key: 'Mod-Alt-Shift-ArrowUp', run: gotoPrevGitChange },
    ]),
  ];
}

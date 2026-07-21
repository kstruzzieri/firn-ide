import {
  ChangeDesc,
  Compartment,
  EditorState,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import { acceptCompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  invertedEffects,
  indentWithTab,
  isolateHistory,
  redo,
  undo,
} from '@codemirror/commands';
import { foldKeymap } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { Decoration, EditorView, keymap, WidgetType } from '@codemirror/view';
import type { git } from '../../../../wailsjs/go/models';
import type { MergeDecision, TextMergeSession } from '../../../stores/gitStore';
import { DEFAULT_SYNTAX_THEME_ID, type SyntaxThemeId } from './palettes';
import { inFileSearchExtensions, inFileSearchKeymap } from './search';
import { buildTheme } from './theme';

export type MergeChoice = Exclude<MergeDecision, 'M'>;
export type MergeOrder = 'current-first' | 'incoming-first';
export type MergeDirection = 1 | -1;

export interface MarkerBlockRange {
  from: number;
  to: number;
}

export interface MappedMergeRegion extends MarkerBlockRange {
  index: number;
  trailingNewline?: boolean;
}

export interface MergeResolutionState {
  activeIndex: number | null;
  decisions: Record<number, MergeDecision>;
  order: MergeOrder;
}

function normalizeDocument(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

/** The marker lines are part of the replaced block; their following newline is not. */
export function markerBlockRange(
  content: string,
  startLine: number,
  endLine: number
): MarkerBlockRange {
  return markerBlockRanges(content, [{ startLine, endLine }])[0];
}

/** Maps marker line pairs after one document-wide line-start scan. */
export function markerBlockRanges(
  content: string,
  regions: readonly Pick<git.ConflictRegion, 'startLine' | 'endLine'>[]
): MarkerBlockRange[] {
  const lineStarts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') lineStarts.push(index + 1);
  }
  return regions.map(({ startLine, endLine }) => {
    if (startLine < 1 || endLine < startLine || endLine > lineStarts.length) {
      throw new RangeError(`Invalid conflict marker lines ${startLine}-${endLine}`);
    }
    return {
      from: lineStarts[startLine - 1],
      to: endLine === lineStarts.length ? content.length : lineStarts[endLine] - 1,
    };
  });
}

/** Finds the next still-unresolved region, wrapping at either end. */
export function nextUnresolved(
  decisions: Record<number, MergeDecision>,
  regionCount: number,
  current: number | null,
  direction: MergeDirection = 1
): number | null {
  if (regionCount === 0) return null;
  const start = current === null ? (direction === 1 ? -1 : 0) : current;
  for (let offset = 1; offset <= regionCount; offset += 1) {
    const candidate = (start + direction * offset + regionCount) % regionCount;
    if (decisions[candidate] === undefined) return candidate;
  }
  return null;
}

export function resolutionLines(
  region: git.ConflictRegion,
  choice: MergeChoice,
  order: MergeOrder
): string[] {
  if (choice === 'C') return region.ours;
  if (choice === 'I') return region.theirs;
  return order === 'current-first'
    ? [...region.ours, ...region.theirs]
    : [...region.theirs, ...region.ours];
}

/** Regions touched by document changes in pre-transaction coordinates. */
export function changedRegionIndexes(
  regions: readonly MappedMergeRegion[],
  changes: readonly MarkerBlockRange[]
): number[] {
  return regions
    .filter(({ from, to, trailingNewline }) =>
      changes.some((change) =>
        change.from === change.to
          ? from === to
            ? change.from === from
            : change.from >= from && (trailingNewline ? change.from < to : change.from <= to)
          : change.from < to && change.to > from
      )
    )
    .map(({ index }) => index);
}

class MergeRegionRange extends RangeValue {
  override startSide = -1;
  override endSide = 1;

  constructor(
    readonly index: number,
    readonly trailingNewline: boolean
  ) {
    super();
  }

  override eq(other: RangeValue): boolean {
    return other instanceof MergeRegionRange && other.index === this.index;
  }
}

interface ResolutionFieldState extends MergeResolutionState {
  ranges: RangeSet<MergeRegionRange>;
  frozen: boolean;
}

interface DecisionEffect {
  index: number;
  decision?: MergeDecision;
}

function rangeSnapshot(ranges: RangeSet<MergeRegionRange>): MappedMergeRegion[] {
  const snapshot: MappedMergeRegion[] = [];
  ranges.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    snapshot.push({ index: value.index, from, to, trailingNewline: value.trailingNewline });
  });
  return snapshot;
}

function rangesIn(state: ResolutionFieldState): MappedMergeRegion[] {
  return rangeSnapshot(state.ranges);
}

function rangeSetFromSnapshot(snapshot: readonly MappedMergeRegion[]): RangeSet<MergeRegionRange> {
  return RangeSet.of(
    snapshot.map(({ index, from, to, trailingNewline }) =>
      new MergeRegionRange(index, trailingNewline === true).range(from, to)
    ),
    true
  );
}

/** Keeps an insertion at the following-line boundary outside its conflict range. */
function mapRanges(
  ranges: RangeSet<MergeRegionRange>,
  changes: ChangeDesc
): RangeSet<MergeRegionRange> {
  const boundaryInsertions = new Map<number, number>();
  const before = rangeSnapshot(ranges);
  changes.iterChangedRanges((fromA: number, toA: number, fromB: number, toB: number) => {
    if (fromA !== toA) return;
    for (const range of before) {
      if (range.from < range.to && range.trailingNewline && range.to === fromA) {
        boundaryInsertions.set(
          range.index,
          (boundaryInsertions.get(range.index) ?? 0) + toB - fromB
        );
      }
    }
  }, true);
  const mapped = ranges.map(changes);
  if (boundaryInsertions.size === 0) return mapped;
  const mappedByIndex = new Map(rangeSnapshot(mapped).map((range) => [range.index, range]));
  return RangeSet.of(
    before.map((original) => {
      const range = mappedByIndex.get(original.index)!;
      return new MergeRegionRange(original.index, original.trailingNewline === true).range(
        range.from,
        range.to - (boundaryInsertions.get(original.index) ?? 0)
      );
    }),
    true
  );
}

function appendSide(parent: HTMLElement, label: string, lines: string[]): void {
  const side = document.createElement('section');
  side.className = 'cm-mergeResolution-side';
  const heading = document.createElement('div');
  heading.className = 'cm-mergeResolution-sideLabel';
  heading.textContent = label;
  const body = document.createElement('pre');
  body.className = 'cm-mergeResolution-lines';
  body.textContent = lines.length === 0 ? '(deletes this block)' : lines.join('\n');
  side.append(heading, body);
  parent.appendChild(side);
}

class MergeResolutionWidget extends WidgetType {
  constructor(
    private readonly region: git.ConflictRegion,
    private readonly index: number,
    private readonly active: boolean,
    private readonly order: MergeOrder,
    private readonly labels: TextMergeSession['labels'],
    private readonly readOnly: boolean,
    private readonly frozen: boolean,
    private readonly act: (view: EditorView, index: number, choice: MergeChoice | 'M') => void,
    private readonly activate: (view: EditorView, index: number) => void
  ) {
    super();
  }

  override eq(other: MergeResolutionWidget): boolean {
    return (
      other.index === this.index &&
      other.active === this.active &&
      other.order === this.order &&
      other.region === this.region &&
      other.frozen === this.frozen
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const currentLabel = `CURRENT — ${this.labels.ours.label}`;
    const incomingLabel = `INCOMING — ${this.labels.theirs.label}`;
    if (!this.active) {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'cm-mergeResolution-strip';
      root.dataset.regionIndex = String(this.index);
      root.disabled = this.frozen;
      root.setAttribute(
        'aria-label',
        `Open conflict ${this.index + 1}: ${currentLabel} / ${incomingLabel}`
      );
      root.textContent = `Conflict ${this.index + 1}: ${currentLabel} / ${incomingLabel}`;
      root.addEventListener('click', (event) => {
        event.preventDefault();
        if (this.frozen) return;
        this.activate(view, this.index);
      });
      return root;
    }

    const root = document.createElement('section');
    root.className = 'cm-mergeResolution-card cm-mergeResolution-active';
    root.dataset.regionIndex = String(this.index);

    const title = document.createElement('div');
    title.className = 'cm-mergeResolution-title';
    title.textContent = `Conflict ${this.index + 1}`;
    root.appendChild(title);
    appendSide(root, currentLabel, this.region.ours);
    appendSide(root, incomingLabel, this.region.theirs);

    const actions = document.createElement('div');
    actions.className = 'cm-mergeResolution-actions';
    const button = (label: string, choice: MergeChoice | 'M') => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'cm-mergeResolution-action';
      element.dataset.decision = choice;
      element.textContent = label;
      element.disabled = this.readOnly || this.frozen;
      element.addEventListener('click', (event) => {
        event.preventDefault();
        if (this.readOnly || this.frozen) return;
        this.act(view, this.index, choice);
      });
      actions.appendChild(element);
    };
    button('Take Current', 'C');
    button('Take Incoming', 'I');
    button('Take Both', 'B');
    const order = document.createElement('button');
    order.type = 'button';
    order.className = 'cm-mergeResolution-order';
    order.textContent = this.order === 'current-first' ? 'Current first' : 'Incoming first';
    order.disabled = this.readOnly || this.frozen;
    order.addEventListener('click', (event) => {
      event.preventDefault();
      if (this.readOnly || this.frozen) return;
      view.dispatch({
        effects: setMergeOrder.of(
          this.order === 'current-first' ? 'incoming-first' : 'current-first'
        ),
      });
      view.focus();
    });
    actions.appendChild(order);
    button('Edit manually', 'M');
    root.appendChild(actions);
    return root;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const setMergeDecision = StateEffect.define<DecisionEffect>();
const setMergeActive = StateEffect.define<number | null>();
const setMergeOrder = StateEffect.define<MergeOrder>();
const setMergeFrozen = StateEffect.define<boolean>();
const restoreMergeRanges = StateEffect.define<MappedMergeRegion[]>({
  // History maps stored effects through a ChangeDesc before replaying them. RangeSet moves each
  // snapshot record without coalescing identities; ambiguous shared insertions are rejected
  // below, while iterChangedRanges keeps the following-line boundary rule during remapping.
  map: (snapshot, changes) => rangeSnapshot(mapRanges(rangeSetFromSnapshot(snapshot), changes)),
});

function hasMergeStateEffect(effects: readonly StateEffect<unknown>[]): boolean {
  return effects.some((effect) => effect.is(setMergeDecision) || effect.is(restoreMergeRanges));
}

function hasAmbiguousSharedInsertion(
  regions: readonly MappedMergeRegion[],
  changes: readonly MarkerBlockRange[]
): boolean {
  return changes.some((change) => {
    if (change.from !== change.to) return false;
    const touched = new Set(changedRegionIndexes(regions, [change]));
    return (
      touched.size > 1 &&
      regions.some((region) => touched.has(region.index) && region.from === region.to)
    );
  });
}

function stateSnapshot(state: ResolutionFieldState): MergeResolutionState {
  return { activeIndex: state.activeIndex, decisions: state.decisions, order: state.order };
}

function transactionChanges(tr: {
  changes: {
    iterChanges: (f: (from: number, to: number) => void, individual?: boolean) => void;
  };
}): MarkerBlockRange[] {
  const changes: MarkerBlockRange[] = [];
  tr.changes.iterChanges((from, to) => changes.push({ from, to }), true);
  return changes;
}

function resolutionExtension(
  session: TextMergeSession,
  onStateChange?: (state: MergeResolutionState) => void
): { extension: Extension[]; field: StateField<ResolutionFieldState> } {
  const document = normalizeDocument(session.content);
  const markerRanges = markerBlockRanges(document, session.regions);
  const regionRanges = session.regions.map((region, index) => {
    const range = markerRanges[index];
    const trailingNewline = document[range.to] === '\n';
    return new MergeRegionRange(index, trailingNewline).range(
      range.from,
      range.to + (trailingNewline ? 1 : 0)
    );
  });
  const activate = (view: EditorView, index: number) => activateRegion(view, field, index);
  const apply = (view: EditorView, index: number, choice: MergeChoice | 'M') =>
    applyResolution(view, field, session, index, choice);

  const field = StateField.define<ResolutionFieldState>({
    create: () => ({
      ranges: RangeSet.of(regionRanges, true),
      decisions: { ...session.decisions },
      activeIndex: nextUnresolved(session.decisions, session.regions.length, null, 1),
      order: 'current-first',
      frozen: false,
    }),
    update(value, tr) {
      let ranges = tr.docChanged ? mapRanges(value.ranges, tr.changes) : value.ranges;
      let decisions = value.decisions;
      let activeIndex = value.activeIndex;
      let order = value.order;
      let frozen = value.frozen;
      for (const effect of tr.effects) {
        if (effect.is(restoreMergeRanges)) {
          ranges = rangeSetFromSnapshot(effect.value);
        } else if (effect.is(setMergeDecision)) {
          decisions = { ...decisions };
          if (effect.value.decision === undefined) delete decisions[effect.value.index];
          else decisions[effect.value.index] = effect.value.decision;
        } else if (effect.is(setMergeActive)) {
          activeIndex = effect.value;
        } else if (effect.is(setMergeOrder)) {
          order = effect.value;
        } else if (effect.is(setMergeFrozen)) {
          frozen = effect.value;
        }
      }
      return { ranges, decisions, activeIndex, order, frozen };
    },
    provide: (field) => [
      EditorState.readOnly.from(field, (value) => session.readOnly || value.frozen),
      EditorView.editable.from(field, (value) => !session.readOnly && !value.frozen),
      EditorView.decorations.from(field, (value) => {
        const decorations = rangesIn(value)
          .filter(({ index }) => value.decisions[index] === undefined)
          .map(({ from, to, index }) =>
            Decoration.replace({
              block: true,
              widget: new MergeResolutionWidget(
                session.regions[index],
                index,
                value.activeIndex === index,
                value.order,
                session.labels,
                session.readOnly,
                value.frozen,
                apply,
                activate
              ),
            }).range(from, to)
          );
        return Decoration.set(decorations, true);
      }),
    ],
  });

  return {
    field,
    extension: [
      field,
      EditorState.transactionFilter.of((tr) => {
        const frozen = tr.startState.field(field).frozen;
        if (!frozen) return tr;
        return tr.docChanged ||
          tr.effects.some((effect) => effect.is(setMergeDecision) || effect.is(setMergeOrder))
          ? []
          : tr;
      }),
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || hasMergeStateEffect(tr.effects)) return tr;
        const state = tr.startState.field(field);
        const mapped = rangesIn(state);
        const changes = transactionChanges(tr);
        if (hasAmbiguousSharedInsertion(mapped, changes)) return [];
        const touched = changedRegionIndexes(mapped, changes);
        return touched.some((index) => state.decisions[index] === undefined) ? [] : tr;
      }),
      EditorState.transactionExtender.of((tr) => {
        if (!tr.docChanged || hasMergeStateEffect(tr.effects)) return null;
        const touched = changedRegionIndexes(
          rangesIn(tr.startState.field(field)),
          transactionChanges(tr)
        );
        return touched.length === 0
          ? null
          : { effects: touched.map((index) => setMergeDecision.of({ index, decision: 'M' })) };
      }),
      invertedEffects.of((tr) => {
        const before = tr.startState.field(field);
        const decisionEffects = tr.effects.flatMap((effect) => {
          if (!effect.is(setMergeDecision)) return [];
          return [
            setMergeDecision.of({
              index: effect.value.index,
              decision: before.decisions[effect.value.index],
            }),
          ];
        });
        return [
          ...(tr.docChanged ? [restoreMergeRanges.of(rangeSnapshot(before.ranges))] : []),
          ...decisionEffects,
          ...(tr.effects.some((effect) => effect.is(setMergeDecision)) &&
          tr.effects.some((effect) => effect.is(setMergeActive))
            ? [setMergeActive.of(before.activeIndex)]
            : []),
        ];
      }),
      EditorView.updateListener.of((update) => {
        if (update.transactions.length > 0)
          onStateChange?.(stateSnapshot(update.state.field(field)));
      }),
    ],
  };
}

export interface MergeResolutionEditor {
  view: EditorView;
  getResult: () => string;
  getState: () => MergeResolutionState;
  undo: () => boolean;
  redo: () => boolean;
  setFrozen: (frozen: boolean) => void;
  setTheme: (themeId: SyntaxThemeId) => void;
  next: (direction?: MergeDirection) => boolean;
  activate: (index: number) => boolean;
  destroy: () => void;
}

/** Mounts the Result-spine editor with native history and the normal editor keymaps. */
export function createMergeResolutionEditor(
  parent: HTMLElement,
  session: TextMergeSession,
  options: {
    extensions?: Extension[];
    onStateChange?: (state: MergeResolutionState) => void;
    syntaxThemeId?: SyntaxThemeId;
  } = {}
): MergeResolutionEditor {
  const support = resolutionExtension(session, options.onStateChange);
  const theme = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: normalizeDocument(session.content),
      extensions: [
        theme.of(buildTheme(options.syntaxThemeId ?? DEFAULT_SYNTAX_THEME_ID)),
        history(),
        ...inFileSearchExtensions(),
        ...support.extension,
        keymap.of([
          {
            key: 'F7',
            run: (target) => navigate(target, support.field, session.regions.length, 1),
            shift: (target) => navigate(target, support.field, session.regions.length, -1),
          },
          { key: 'Mod-1', run: (target) => choose(target, support.field, session, 'C') },
          { key: 'Mod-2', run: (target) => choose(target, support.field, session, 'I') },
          { key: 'Mod-3', run: (target) => choose(target, support.field, session, 'B') },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...inFileSearchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
          { key: 'Tab', run: acceptCompletion },
          indentWithTab,
        ]),
        ...(options.extensions ?? []),
      ],
    }),
  });
  const read = () => view.state.field(support.field);
  return {
    view,
    getResult: () => view.state.doc.toString(),
    getState: () => stateSnapshot(read()),
    undo: () => {
      if (read().frozen) return false;
      const changed = undo(view);
      if (changed) view.focus();
      return changed;
    },
    redo: () => {
      if (read().frozen) return false;
      const changed = redo(view);
      if (changed) view.focus();
      return changed;
    },
    setFrozen: (frozen) => view.dispatch({ effects: setMergeFrozen.of(frozen) }),
    setTheme: (themeId) => view.dispatch({ effects: theme.reconfigure(buildTheme(themeId)) }),
    next: (direction = 1) => navigate(view, support.field, session.regions.length, direction),
    activate: (index) => activateRegion(view, support.field, index),
    destroy: () => view.destroy(),
  };
}

function navigate(
  view: EditorView,
  field: StateField<ResolutionFieldState>,
  regionCount: number,
  direction: MergeDirection
): boolean {
  const current = view.state.field(field);
  const index = nextUnresolved(current.decisions, regionCount, current.activeIndex, direction);
  if (index === null) return false;
  return activateRegion(view, field, index);
}

function activateRegion(
  view: EditorView,
  field: StateField<ResolutionFieldState>,
  index: number
): boolean {
  const range = rangesIn(view.state.field(field)).find((item) => item.index === index);
  if (!range) return false;
  view.dispatch({
    effects: setMergeActive.of(index),
    selection: { anchor: range.from },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function applyResolution(
  view: EditorView,
  field: StateField<ResolutionFieldState>,
  session: TextMergeSession,
  index: number,
  choice: MergeChoice | 'M'
): boolean {
  if (session.readOnly) return false;
  const state = view.state.field(field);
  if (state.frozen) return false;
  const range = rangesIn(state).find((item) => item.index === index);
  const region = session.regions[index];
  if (!range || !region || state.decisions[index] !== undefined) return false;
  // Manual starts from both real sides, preserving every line for the user to edit.
  const decision: MergeDecision = choice === 'M' ? 'M' : choice;
  const lines = resolutionLines(region, choice === 'M' ? 'B' : choice, state.order);
  const insert = `${lines.join('\n')}${lines.length > 0 && range.trailingNewline ? '\n' : ''}`;
  const decisions = { ...state.decisions, [index]: decision };
  const activeIndex =
    choice === 'M' ? index : nextUnresolved(decisions, session.regions.length, index, 1);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    effects: [setMergeDecision.of({ index, decision }), setMergeActive.of(activeIndex)],
    annotations: isolateHistory.of('full'),
    ...(choice === 'M' ? { selection: { anchor: range.from }, scrollIntoView: true } : {}),
  });
  view.focus();
  if (choice !== 'M' && activeIndex !== null) activateRegion(view, field, activeIndex);
  return true;
}

function choose(
  view: EditorView,
  field: StateField<ResolutionFieldState>,
  session: TextMergeSession,
  choice: MergeChoice
): boolean {
  const state = view.state.field(field);
  const index = state.activeIndex;
  if (index === null) return false;
  return applyResolution(view, field, session, index, choice);
}

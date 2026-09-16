/**
 * Pure model of a route edit's distance from what its row holds, consumed by
 * RouteEditor's footer. Keith's wave-6 live gate: an edit undone by hand looked
 * no different from a pending one, and Done/Cancel never said what they would
 * change. `pendingOf` names what Done would stage that the row does not hold;
 * the editor is dirty exactly when that list is non-empty. One derivation
 * (`facetsOf`) feeds it and the test oracle `snapshotOf`: every facet that
 * differs is named by a clause (the model's identity facets share one), and
 * routeEdit.test.ts pins that biconditional. A new stageable field belongs in
 * `facetsOf` first, then in `pendingOf`'s wording.
 */
import type { CapabilityName, ModelProjection, ModelType, ThinkMode } from '../../types/golem';
import { modelFactsOf } from '../../types/golemConfig';
import { formatContextWindow } from '../../utils/formatContextWindow';

/** A hand-declared model: authoritative facts, not detected ones (§4.4). */
export interface ManualModel {
  model: string;
  /** Required before staging; `''` is "not chosen yet", never a default. */
  type: ModelType | '';
  caps: CapabilityName[];
}

/** The editor's state: a chosen provider, a model from the list OR a hand declaration, and the rest. */
export interface Seed {
  provider: string;
  defined: ModelProjection | null;
  manual: ManualModel | null;
  exposed: CapabilityName[];
  think: ThinkMode;
  ackUnknown: boolean;
  ackDrops: boolean;
}

/**
 * What a compact card says beside its type tag: the numbers that tell two
 * same-named models apart. The TYPE is its own tag, so it is not in here.
 * Context reads human-scale ("256K ctx"); the exact count travels in the
 * facts span's title. Dimensions stay raw — small numbers, different unit.
 */
export const factsLine = (model: ModelProjection): string =>
  [
    model.parameters,
    model.contextWindow === undefined
      ? undefined
      : `${formatContextWindow(model.contextWindow)} ctx`,
    model.dimensions === undefined ? undefined : `${model.dimensions} dim`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');

export const TYPE_LABEL: Record<ModelType, string> = {
  dense: 'Dense',
  moe: 'Mixture of experts',
  embedding: 'Embedding',
};

export const THINK_LABEL: Record<ThinkMode, string> = {
  '': 'Default',
  none: 'None',
  always: 'Always',
  toggle: 'Toggle',
  auto: 'Auto',
};

/**
 * The Think mode Done would stage: a mode is meaningless without the
 * capability that justifies it, so the select's value counts only while
 * `thinking` is exposed. Unticking `thinking` clears it; re-ticking finds it
 * where it was left.
 */
const effectiveThink = (seed: Seed): ThinkMode =>
  seed.exposed.includes('thinking') ? seed.think : '';

/**
 * Which side of the comparison a seed stands on. The editor's state is read
 * as what Done would STAGE; the baseline as what the ROW holds — raw, because
 * a row can hold a Think mode behind an unexposed `thinking` (go-llm ties the
 * two nowhere), and Done then clears it: `Think mode: cleared (was Auto)` before a
 * single edit is the honest reading, not a clean footer.
 */
export type Side = 'stage' | 'row';

/**
 * What Done would stage, as comparable fields. The model is its FACTS, never
 * its role: two roles on one selector are one picker card, and re-picking it
 * changes nothing. `facts` holds the raw numbers that tell two same-named
 * list models apart (parameters, context, dimensions) — raw, because the
 * formatted line collapses 256000 and 262144 into one "256K ctx". Whether the
 * model is a hand declaration is NOT a facet: a declaration that repeats a
 * list model's facts and capabilities stages the same payload, so it reads as
 * clean; provenance only words a clause once something differs.
 */
interface EditFacets {
  provider: string;
  model: string;
  type: ModelType | '';
  facts: string;
  /** The declared capability set; empty while no model is chosen. */
  caps: CapabilityName[];
  exposed: CapabilityName[];
  think: ThinkMode;
  ackUnknown: boolean;
  ackDrops: boolean;
}

const facetsOf = (seed: Seed, side: Side): EditFacets => {
  const facts = seed.defined === null ? null : modelFactsOf(seed.defined);
  // A list model that carries none of the optional facts reads exactly like a
  // hand declaration of it: both stage {provider, model, type}.
  const optional = facts === null ? [] : [facts.parameters, facts.contextWindow, facts.dimensions];
  return {
    provider: seed.provider,
    model: facts?.model ?? seed.manual?.model ?? '',
    type: facts?.type ?? seed.manual?.type ?? '',
    facts: optional.some((value) => value !== undefined)
      ? JSON.stringify(optional.map((value) => value ?? null))
      : '',
    caps: seed.manual?.caps ?? seed.defined?.capabilityFacts.caps ?? [],
    exposed: seed.exposed,
    think: side === 'stage' ? effectiveThink(seed) : seed.think,
    ackUnknown: seed.ackUnknown,
    ackDrops: seed.ackDrops,
  };
};

/** One side as a comparable string — the test oracle for `pendingOf`'s emptiness. */
export const snapshotOf = (seed: Seed, side: Side): string => JSON.stringify(facetsOf(seed, side));

const shown = (value: string): string => value || '—';
/** The declare form's own Type label, or the placeholder while none is chosen. */
const typeLabel = (type: ModelType | ''): string => (type === '' ? '—' : TYPE_LABEL[type]);

/**
 * How a same-named model is told apart in the summary: a hand declaration by
 * its provenance, a list model by its facts line — or, when two list models'
 * lines read alike (256000 and 262144 are both "256K ctx"), by the raw counts.
 */
const identityText = (seed: Seed, exact: boolean): string => {
  // Only reached with a model on both sides (equal, non-empty names).
  if (seed.defined === null) return 'declared by hand';
  if (!exact) return shown(factsLine(seed.defined));
  const facts = modelFactsOf(seed.defined);
  return shown(
    [
      facts.parameters,
      facts.contextWindow === undefined ? undefined : `${facts.contextWindow} ctx`,
      facts.dimensions === undefined ? undefined : `${facts.dimensions} dim`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · ')
  );
};

/** `Label: + a, b` and `Label: − c` clauses for one capability set against its baseline, canonical order kept. */
const setDelta = (
  label: string,
  now: readonly CapabilityName[],
  was: readonly CapabilityName[]
): string[] => {
  const added = now.filter((cap) => !was.includes(cap));
  const removed = was.filter((cap) => !now.includes(cap));
  return [
    ...(added.length > 0 ? [`${label}: + ${added.join(', ')}`] : []),
    ...(removed.length > 0 ? [`${label}: − ${removed.join(', ')}`] : []),
  ];
};

/**
 * What Done would stage from `now` that the row (`was`) does not hold, in
 * words, each clause named for its control: `Control: value (was value)` for
 * a single value (the Model clause prefixes the shared name when only the
 * facts differ), `Control: + a, b` and `Control: − c` for a checklist (one
 * clause per side it gains or loses), `Control: acknowledged` / `not
 * acknowledged` for a tick. In the order Provider, Model (with Declares riding
 * on it), Type, Capabilities, Think mode, then the acknowledgements. Empty
 * exactly when `snapshotOf(now, 'stage')` equals `snapshotOf(was, 'row')`.
 */
export const pendingOf = (now: Seed, was: Seed): string[] => {
  const a = facetsOf(now, 'stage');
  const b = facetsOf(was, 'row');
  const pending: string[] = [];
  if (a.provider !== b.provider)
    pending.push(`Provider: ${shown(a.provider)} (was ${shown(b.provider)})`);
  // One model on both sides means the same provider AND name: only then can
  // its facts, declaration or type differ on their own. Another provider's
  // same-named model is another model, and the Provider clause says so.
  const sameModel = a.provider === b.provider && a.model === b.model;
  if (a.model !== b.model) {
    pending.push(`Model: ${shown(a.model)} (was ${shown(b.model)})`);
  } else if (sameModel && a.facts !== b.facts) {
    // The same name, other facts: two list models the picker tells apart, or
    // a hand declaration standing in for one. Exact counts when the lines
    // would read alike.
    const exact = identityText(now, false) === identityText(was, false);
    pending.push(`Model: ${a.model} ${identityText(now, exact)} (was ${identityText(was, exact)})`);
  } else if (sameModel) {
    // The same model, other declared capabilities: a hand declaration edited,
    // or the picker's one card for a selector carrying another role's resolved
    // set. (Another model's capabilities are its own; the Model clause covers them.)
    pending.push(...setDelta('Declares', a.caps, b.caps));
  }
  // A type stands alone only for the declare form's own select, like Declares.
  if (sameModel && a.type !== b.type)
    pending.push(`Type: ${typeLabel(a.type)} (was ${typeLabel(b.type)})`);
  pending.push(...setDelta('Capabilities', a.exposed, b.exposed));
  if (a.think !== b.think) {
    // The select reads "Default" while it is on screen; once `thinking` is
    // unticked there is no select, and Done clears the mode.
    const nowLabel = now.exposed.includes('thinking') ? THINK_LABEL[a.think] : 'cleared';
    // A row holding no model shows no Think either.
    const wasLabel = b.model === '' ? '—' : THINK_LABEL[b.think];
    pending.push(`Think mode: ${nowLabel} (was ${wasLabel})`);
  }
  if (a.ackUnknown !== b.ackUnknown)
    pending.push(a.ackUnknown ? 'Apply anyway: acknowledged' : 'Apply anyway: not acknowledged');
  if (a.ackDrops !== b.ackDrops)
    pending.push(a.ackDrops ? 'Removal: acknowledged' : 'Removal: not acknowledged');
  return pending;
};

/**
 * Pure model of a route edit's distance from what its row holds, consumed by
 * RouteEditor's footer. Keith's wave-6 live gate: an edit undone by hand looked
 * no different from a pending one, and Done/Cancel never said what they would
 * change. `snapshotOf` decides whether anything differs; `pendingOf` says what.
 * Both read ONE derivation (`facetsOf`), and `pendingOf` names a clause for
 * every facet in it, so the footer and its summary cannot disagree
 * (routeEdit.test.ts pins that biconditional).
 */
import type { CapabilityName, ModelProjection, ModelType, ThinkMode } from '../../types/golem';
import { modelFactsOf } from '../../types/golemConfig';
import { formatContextWindow } from '../../utils/formatContextWindow';
import type { ManualModel } from './ModelBand';

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
export const effectiveThink = (seed: Seed): ThinkMode =>
  seed.exposed.includes('thinking') ? seed.think : '';

/**
 * What Done would stage, as comparable fields. The model is its FACTS, never
 * its role: two roles on one selector are one picker card, and re-picking it
 * changes nothing. `detail` is what tells two same-named list models apart
 * (parameters, context, dimensions); `declared` is whether the model is a hand
 * declaration, since that alone changes the capability facts Done sends.
 */
interface EditFacets {
  provider: string;
  model: string;
  type: ModelType | '';
  detail: string;
  declared: boolean;
  /** The declared capability set, `null` while no model is chosen. */
  caps: CapabilityName[] | null;
  exposed: CapabilityName[];
  think: ThinkMode;
  ackUnknown: boolean;
  ackDrops: boolean;
}

const facetsOf = (seed: Seed): EditFacets => {
  const facts = seed.defined === null ? null : modelFactsOf(seed.defined);
  return {
    provider: seed.provider,
    model: facts?.model ?? seed.manual?.model ?? '',
    type: facts?.type ?? seed.manual?.type ?? '',
    detail: seed.defined === null ? '' : factsLine(seed.defined),
    declared: seed.manual !== null,
    caps: seed.manual?.caps ?? seed.defined?.capabilityFacts.caps ?? null,
    exposed: seed.exposed,
    think: effectiveThink(seed),
    ackUnknown: seed.ackUnknown,
    ackDrops: seed.ackDrops,
  };
};

/** The editor's state as one comparable string: what Done would stage, minus the derivations. */
export const snapshotOf = (seed: Seed): string => JSON.stringify(facetsOf(seed));

const shown = (value: string): string => value || '—';

/** `+ a, b` and `− c` clauses for one capability set against its baseline, canonical order kept. */
const setDelta = (
  prefix: string,
  now: readonly CapabilityName[],
  was: readonly CapabilityName[]
): string[] => {
  const added = now.filter((cap) => !was.includes(cap));
  const removed = was.filter((cap) => !now.includes(cap));
  return [
    ...(added.length > 0 ? [`${prefix}+ ${added.join(', ')}`] : []),
    ...(removed.length > 0 ? [`${prefix}− ${removed.join(', ')}`] : []),
  ];
};

/**
 * What differs from the baseline, in words, in the order the editor lays the
 * controls out. Empty exactly when `snapshotOf` agrees for both seeds.
 */
export const pendingOf = (now: Seed, was: Seed): string[] => {
  const a = facetsOf(now);
  const b = facetsOf(was);
  const pending: string[] = [];
  if (a.provider !== b.provider)
    pending.push(`Provider ${shown(a.provider)} (was ${shown(b.provider)})`);
  if (a.model !== b.model) {
    pending.push(`Model ${shown(a.model)} (was ${shown(b.model)})`);
  } else if (a.declared !== b.declared) {
    // The same name from the other source: a hand declaration sends its own
    // capability facts, a list model the projection's. (A declaration whose
    // name is still empty reads with the placeholder.)
    pending.push(
      a.declared
        ? `Model ${shown(a.model)} declared by hand`
        : `Model ${shown(a.model)} from the list`
    );
  } else if (a.detail !== b.detail) {
    // Two list models of one name: the picker tells them apart by their facts.
    pending.push(`Model ${a.model} ${shown(a.detail)} (was ${shown(b.detail)})`);
  } else if (a.caps !== null && b.caps !== null) {
    // The same model, its declaration edited: only a hand declaration can be.
    // (Another model's facts are its own; the Model clause already says so.)
    pending.push(...setDelta('Declares ', a.caps, b.caps));
  }
  if (a.type !== b.type) pending.push(`Type ${shown(a.type)} (was ${shown(b.type)})`);
  pending.push(...setDelta('', a.exposed, b.exposed));
  if (a.think !== b.think) {
    // The select reads "Default" while it is on screen; once `thinking` is
    // unticked there is no select, and Done clears the mode.
    const nowLabel = now.exposed.includes('thinking') ? THINK_LABEL[a.think] : 'cleared';
    pending.push(`Think ${nowLabel} (was ${THINK_LABEL[b.think]})`);
  }
  if (a.ackUnknown !== b.ackUnknown)
    pending.push(a.ackUnknown ? 'Apply anyway acknowledged' : 'Apply anyway withdrawn');
  if (a.ackDrops !== b.ackDrops)
    pending.push(a.ackDrops ? 'Removal acknowledged' : 'Removal acknowledgement withdrawn');
  return pending;
};

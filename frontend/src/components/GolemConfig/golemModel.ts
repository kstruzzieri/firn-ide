/**
 * #490: what the Golem model row and its picker say about a model, in words.
 *
 * The picker's groups come from ONE function, `golemModelVerdict`, over the
 * per-card verdict the agent route editor already computes (`shortfalls`:
 * agent's floor plus whatever else the change would gate). #493 pins that
 * verdict to Apply's gates with a shared fixture; it reuses this function.
 */

import {
  CAPABILITY_NAMES,
  type CapabilityName,
  type ModelProjection,
  type ProviderClassification,
} from '../../types/golem';
import { USE_CASE_FLOORS, type FloorShortfall } from '../../types/golemConfig';

/** The use case Golem chat and commit messages run through. */
export const GOLEM_USE_CASE = 'agent';

/** What a model must do to run Golem: agent's floor. */
export const GOLEM_FLOOR: readonly CapabilityName[] = USE_CASE_FLOORS.get(GOLEM_USE_CASE) ?? [];

export type GolemModelVerdict = { eligible: true } | { eligible: false; reason: string };

/**
 * Whether a card can run Golem, and if not, why, as visible text. A missing
 * `tool_call` is "not verified", never "no": nothing in this slice can check a
 * model, and a card that does not list it may still support it.
 */
export function golemModelVerdict(
  model: ModelProjection,
  short: readonly FloorShortfall[]
): GolemModelVerdict {
  if (short.length === 0) return { eligible: true };
  if (model.type === 'embedding') return { eligible: false, reason: "Embedding model: can't chat" };
  const missing = new Set(short.map(({ cap }) => cap));
  const reason = CAPABILITY_NAMES.filter((cap) => missing.has(cap))
    .map((cap) =>
      cap === 'tool_call'
        ? 'Tool support not verified'
        : cap === 'chat' || cap === 'stream'
          ? `Can't ${cap}`
          : `Missing ${cap}`
    )
    .join(' · ');
  return { eligible: false, reason };
}

/**
 * The detail strip's one-line summary over Golem's floor: a needed answer
 * that is not a plain yes leads, then the yeses grouped. It names no source.
 */
export function golemSummary(exposed: readonly CapabilityName[]): string {
  const yes = GOLEM_FLOOR.filter((cap) => exposed.includes(cap));
  const parts = GOLEM_FLOOR.filter((cap) => !exposed.includes(cap)).map((cap) =>
    cap === 'tool_call' ? 'tool_call: not verified' : `${cap}: no`
  );
  if (yes.length > 0) parts.push(`${yes.join(', ')}: yes`);
  return parts.join(' · ');
}

/** One row of Details: a capability, the answer and where it came from. */
export interface CapabilityAnswer {
  cap: CapabilityName;
  yes: boolean;
  source: string;
  /** Set when this model's cards disagree: how many of them answer yes. */
  agreement?: string;
}

/**
 * Details for a card: every capability, its answer, and its source. Until
 * slice 3 the only sources are the file ("listed in the configuration") and
 * the model type. `cards` are every card naming the same model; where they
 * disagree, the line says how many answer yes, without naming a role.
 */
export function capabilityAnswers(
  card: ModelProjection,
  cards: readonly ModelProjection[]
): CapabilityAnswer[] {
  const listed = card.capabilityOverride !== undefined;
  return CAPABILITY_NAMES.map((cap) => {
    const yes = card.capabilityFacts.caps.includes(cap);
    const source = listed
      ? yes
        ? 'listed in the configuration'
        : 'not listed in the configuration'
      : `from its type, ${card.type}`;
    const yeses = cards.filter((other) => other.capabilityFacts.caps.includes(cap)).length;
    return yeses === 0 || yeses === cards.length
      ? { cap, yes, source }
      : {
          cap,
          yes,
          source,
          agreement: `${yeses} of ${cards.length} cards for this model ${yeses === 1 ? 'says' : 'say'} yes`,
        };
  });
}

/** The chat panel's own badge words for where a model runs. */
export const CLASSIFICATION_LABEL: Record<ProviderClassification, string> = {
  local: 'Local',
  remote: 'Remote',
  unknown: 'Unknown',
};

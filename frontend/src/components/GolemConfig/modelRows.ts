import {
  CAPABILITY_NAMES,
  compareString,
  type CapabilityName,
  type ModelProjection,
} from '../../types/golem';
import { orderModelsForDisplay } from '../../utils/golemModelOrder';

/** Capability arrays cross the transport in CAPABILITY_NAMES order or not at all. */
export const canonicalCaps = (caps: Iterable<CapabilityName>): CapabilityName[] => {
  const wanted = new Set(caps);
  return CAPABILITY_NAMES.filter((cap) => wanted.has(cap));
};

/**
 * Where a row came from. Today every row is `authored` — the models the
 * document already defines.
 *
 * SLICE D SEAM (contract b241d01): `RefreshInventory` results union in here as
 * `discovered` rows, behind the band header's reserved refresh slot and never
 * implicitly. `ProbeToolCall` then resolves a discovered row's tri-state
 * `tool_call` fact. No inventory call exists yet, and this type is the only
 * thing that anticipates one — the row builder below is the single place that
 * union will land, so nothing else in the band has to learn about provenance.
 */
export type ModelProvenance = 'authored' | 'discovered';

export interface ModelRow {
  model: ModelProjection;
  provenance: ModelProvenance;
  /** Every role the card collapses, sorted; the card is a MODEL, its roles ride along. */
  roles: string[];
  /** The roles' notes, in role order — the card shows the first, the popup and the strip all. */
  descriptions: { role: string; description: string }[];
}

/** The tuple `sameModelFacts` compares, flattened — the identity of a card. */
export const rowKey = (model: ModelProjection): string =>
  [
    model.provider,
    model.modelName,
    model.type,
    model.parameters ?? '',
    model.contextWindow ?? 0,
    model.dimensions ?? 0,
  ].join('\u0000');

/**
 * The band's rows for one provider, in the shared display order. One builder,
 * so Slice D adds discovered models in a single place.
 *
 * `models` carries one entry per ROLE, so two roles naming the same model with
 * byte-identical facts arrive twice. The band picks a MODEL, not a role, so
 * they collapse to one card here — otherwise they would share a React key and
 * both answer to `sameModel`, marking two cards selected at once. The roles
 * and their notes ride along on the row: the card, the popup and the strip all
 * read a MODEL that several roles may name.
 *
 * Roles are globally unique (pinned by `internal/ai/settings_test.go`), so the
 * by-role lookup below is unambiguous; two roles that share provider+name but
 * differ in facts are different cards and never share a row.
 */
export function buildModelRows(models: readonly ModelProjection[], provider: string): ModelRow[] {
  const byKey = new Map<string, ModelRow>();
  for (const model of models) {
    if (model.provider !== provider) continue;
    const row = byKey.get(rowKey(model));
    if (row === undefined)
      byKey.set(rowKey(model), {
        model,
        provenance: 'authored',
        roles: [model.role],
        descriptions: [],
      });
    else row.roles.push(model.role);
  }
  const byRole = new Map(
    models.filter((model) => model.provider === provider).map((model) => [model.role, model])
  );
  for (const row of byKey.values()) {
    // The projection's own order (UTF-8 bytes), not UTF-16: which note the card
    // shows and which role heads the strip both ride on it.
    row.roles.sort(compareString);
    row.descriptions = row.roles.flatMap((role) => {
      const description = byRole.get(role)?.description;
      return description === undefined ? [] : [{ role, description }];
    });
  }
  return orderModelsForDisplay(
    [...byKey.values()].map((row) => row.model),
    []
  ).map((model) => byKey.get(rowKey(model))!);
}

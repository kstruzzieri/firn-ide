/**
 * The inline model band (#263 spec §4.4/§4.7, picker revamp Variant 3).
 *
 * The editor row GROWS instead of overlaying: provider select, filter field and
 * a card grid sit full width above the exposure editor. Nothing floats, nothing
 * clips, nothing needs a portal — the models, the declare path and the
 * hidden-by-floor set are all permanently visible surfaces. That replaces the
 * combobox-plus-portal picker, whose popup could not stay attached to its input.
 *
 * Cards are COMPACT by default (name, type, context window). Choosing one
 * expands it in place to show its declared capabilities and collapses whichever
 * was open before, so the band stays readable at dozens of models.
 *
 * Everything here is a filter and a pre-check. The backend independently
 * re-derives eligibility and refuses a model that does not meet the affected
 * requirements, so nothing below is authoritative.
 */

import { useEffect, useRef, useState } from 'react';
import {
  CAPABILITY_NAMES,
  MODEL_TYPES,
  type CapabilityName,
  type ModelProjection,
  type ModelType,
  type ProviderProjection,
} from '../../types/golem';
import { orderModelsForDisplay } from '../../utils/golemModelOrder';
import styles from './GolemConfig.module.css';

const TYPE_LABEL: Record<ModelType, string> = {
  dense: 'Dense',
  moe: 'Mixture of experts',
  embedding: 'Embedding',
};

/** A hand-declared model: authoritative facts, not detected ones (§4.4). */
export interface ManualModel {
  model: string;
  /** Required before staging; `''` is "not chosen yet", never a default. */
  type: ModelType | '';
  caps: CapabilityName[];
}

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
}

/** The tuple `sameModelFacts` compares, flattened — the identity of a card. */
const rowKey = (model: ModelProjection): string =>
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
 * both answer to `sameModel`, marking two cards selected at once.
 */
export function buildModelRows(models: readonly ModelProjection[], provider: string): ModelRow[] {
  const seen = new Set<string>();
  const unique = models.filter((model) => {
    if (model.provider !== provider) return false;
    const key = rowKey(model);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return orderModelsForDisplay(unique, []).map((model) => ({
    model,
    provenance: 'authored' as const,
  }));
}

const sameModel = (a: ModelProjection | null, b: ModelProjection): boolean =>
  a !== null && rowKey(a) === rowKey(b);

/**
 * What a compact card says beside its type tag: the numbers that tell two
 * same-named models apart. The TYPE is its own tag, so it is not in here.
 */
const factsLine = (model: ModelProjection): string =>
  [
    model.parameters,
    model.contextWindow === undefined ? undefined : `${model.contextWindow} ctx`,
    model.dimensions === undefined ? undefined : `${model.dimensions} dim`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');

const missingFloor = (model: ModelProjection, floor: readonly CapabilityName[]): CapabilityName[] =>
  floor.filter((cap) => !model.exposedCapabilities.includes(cap));

export interface ModelBandProps {
  /** DOM id root; the grid is `<id>-grid` and its cards `<id>-card-N`. */
  id: string;
  useCase: string;
  /** The use case's Firn floor; these capabilities are the filter. */
  floor: readonly CapabilityName[];
  /** Every model the document defines, across providers. */
  models: readonly ModelProjection[];
  provider: string;
  providers: readonly ProviderProjection[];
  /** The chosen model, or null. The MODEL, not its name: two rows can share one. */
  selected: ModelProjection | null;
  /** Non-null while the declare fieldset is open. */
  manual: ManualModel | null;
  onProviderChange: (provider: string) => void;
  onSelect: (model: ModelProjection) => void;
  onManual: (manual: ManualModel | null) => void;
}

export function ModelBand({
  id,
  useCase,
  floor,
  models,
  provider,
  providers,
  selected,
  manual,
  onProviderChange,
  onSelect,
  onManual,
}: ModelBandProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  /**
   * Only the CHOSEN card can be open, so the expansion is derived rather than
   * stored: one flag says whether the user has collapsed it. Mirroring the
   * selection into state instead would mean an effect that writes state during
   * render — a cascading render, and two sources for one truth.
   */
  const [collapsed, setCollapsed] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  /** True only for the render that follows a keyboard move. */
  const navigatedRef = useRef(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const gridId = `${id}-grid`;

  const rows = buildModelRows(models, provider);
  const eligible = rows.filter((row) => missingFloor(row.model, floor).length === 0);
  const blocked = rows.filter((row) => missingFloor(row.model, floor).length > 0);

  const needle = query.trim().toLowerCase();
  const matches = eligible.filter((row) => row.model.modelName.toLowerCase().includes(needle));
  const exact = eligible.some((row) => row.model.modelName.toLowerCase() === needle);
  /** A typed name nothing matches pins the declare card as the grid's last stop. */
  const declaring = needle !== '' && !exact;

  // Navigable stops: the matching cards, then the declare card. Blocked cards
  // are shown for their REASON, never chosen, so they stay out of the walk.
  const stops = matches.length + (declaring ? 1 : 0);
  const activeIndex = stops === 0 ? -1 : Math.min(active, stops - 1);

  /**
   * How many cards sit on one grid row, measured from the laid-out cards —
   * `auto-fill` decides the count, so it cannot be derived from the data.
   * jsdom reports every offset as 0, which collapses this to one column and
   * makes a row step equal a single card.
   */
  const columns = (): number => {
    const cards = [...(gridRef.current?.children ?? [])].filter(
      (card): card is HTMLElement =>
        card instanceof HTMLElement && card.getAttribute('role') === 'option'
    );
    if (cards.length < 2) return 1;
    const top = cards[0].offsetTop;
    let count = 1;
    while (count < cards.length && cards[count].offsetTop === top) count += 1;
    return count;
  };

  const choose = (model: ModelProjection) => {
    setCollapsed(false);
    onSelect(model);
  };

  const chooseAt = (index: number) => {
    const row = matches[index];
    if (row !== undefined) {
      choose(row.model);
      return;
    }
    if (declaring) onManual({ model: query.trim(), type: '', caps: canonicalCaps(floor) });
  };

  /** One edit of the hand-declared facts; null-safe because the fieldset only
   *  renders while `manual` is non-null. */
  const patch = (next: Partial<ManualModel>) => {
    if (manual !== null) onManual({ ...manual, ...next });
  };

  const moveTo = (index: number) => {
    navigatedRef.current = true;
    setActive(Math.min(stops - 1, Math.max(0, index)));
  };

  const onGridKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setCollapsed(true);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeIndex >= 0) chooseAt(activeIndex);
      return;
    }
    if (stops === 0) return;
    // §4.7 names Home/End alongside the arrows.
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveTo(event.key === 'Home' ? 0 : stops - 1);
      return;
    }
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() }[
      event.key
    ];
    if (step === undefined) return;
    event.preventDefault();
    moveTo(activeIndex + step);
  };

  /**
   * Roving focus: the active card IS the tab stop, so navigating has to move
   * real focus with it — otherwise the focus ring sits on the card the user
   * left, Tab re-enters the grid instead of leaving it, and a screen reader is
   * told nothing. Guarded by the nav flag so first paint never steals focus.
   */
  useEffect(() => {
    if (!navigatedRef.current) return;
    navigatedRef.current = false;
    gridRef.current?.querySelector<HTMLElement>('[data-active]')?.focus();
  }, [activeIndex]);

  // Leaving the declare fieldset returns the caret to the filter it was opened
  // from (§4.4).
  const wasManual = useRef(manual !== null);
  useEffect(() => {
    if (wasManual.current && manual === null) filterRef.current?.focus();
    wasManual.current = manual !== null;
  }, [manual]);

  const filterLabel = floor.length === 0 ? 'filter: none' : `filter: ${floor.join(' · ')}`;

  return (
    <div className={styles.band}>
      <div className={styles.bandHead}>
        <span className={styles.fieldLabel}>{`Model — every card below can serve ${useCase}`}</span>
        <span className={styles.bandFilter}>{filterLabel}</span>
        <span className={styles.grow} />
        {/* SLICE D: the "Refresh list" affordance lands here, explicit-only
            (RefreshInventory, contract b241d01). Nothing renders today. */}
        <span className={styles.bandRefreshSlot} />
      </div>

      <div className={styles.bandRow}>
        <label className={styles.srOnly} htmlFor={`${id}-provider`}>
          Provider
        </label>
        <select
          className={`${styles.input} ${styles.bandProvider}`}
          id={`${id}-provider`}
          value={provider}
          onChange={(event) => onProviderChange(event.target.value)}
        >
          <option value="">Choose a provider</option>
          {providers.map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.name}
            </option>
          ))}
        </select>
        <label className={styles.srOnly} htmlFor={`${id}-filter`}>
          Filter models
        </label>
        <input
          ref={filterRef}
          className={styles.input}
          id={`${id}-filter`}
          autoComplete="off"
          placeholder="Filter models — or type a new name to declare it"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
      </div>

      <div
        ref={gridRef}
        id={gridId}
        role="listbox"
        aria-label={`Models for ${useCase}`}
        className={styles.modelGrid}
        onKeyDown={onGridKeyDown}
      >
        {matches.map((row, index) => {
          const chosen = sameModel(selected, row.model);
          const open = chosen && !collapsed;
          return (
            <div
              key={rowKey(row.model)}
              id={`${id}-card-${index}`}
              role="option"
              aria-selected={chosen}
              tabIndex={index === activeIndex ? 0 : -1}
              data-active={index === activeIndex || undefined}
              data-provenance={row.provenance}
              className={`${styles.modelCard} ${chosen ? styles.modelCardChosen : ''}`}
              onClick={() => {
                setActive(index);
                choose(row.model);
              }}
            >
              <span className={styles.modelCardTop}>
                <span className={styles.modelName}>{row.model.modelName}</span>
                {chosen && <span className={styles.modelCardMark}>assigned</span>}
              </span>
              <span className={styles.modelCardMeta}>
                <span className={styles.factTag}>{row.model.type}</span>
                <span className={styles.modelCardFacts}>{factsLine(row.model)}</span>
              </span>
              {/* Compact until chosen: the capabilities are the expansion. */}
              {open && (
                <span className={styles.capChips}>
                  {row.model.exposedCapabilities.map((cap) => (
                    <span
                      key={cap}
                      className={`${styles.capChip} ${floor.includes(cap) ? styles.capChipFloor : ''}`}
                    >
                      {cap}
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}

        {declaring && (
          <div
            id={`${id}-card-${matches.length}`}
            role="option"
            aria-selected={false}
            tabIndex={matches.length === activeIndex ? 0 : -1}
            data-active={matches.length === activeIndex || undefined}
            className={`${styles.modelCard} ${styles.modelCardDeclare}`}
            onClick={() => {
              setActive(matches.length);
              chooseAt(matches.length);
            }}
          >
            <span className={styles.modelName}>{`Declare "${query.trim()}"`}</span>
            <span className={styles.modelCardFacts}>no exact match — opens the facts editor</span>
          </div>
        )}

        {showHidden &&
          blocked.map((row) => (
            <div
              key={rowKey(row.model)}
              role="option"
              aria-selected={false}
              aria-disabled="true"
              data-provenance={row.provenance}
              className={`${styles.modelCard} ${styles.modelCardBlocked}`}
            >
              <span className={styles.modelCardTop}>
                <span className={styles.modelName}>{row.model.modelName}</span>
                <span className={styles.modelCardFacts}>{`not eligible for ${useCase}`}</span>
              </span>
              <span className={styles.modelCardMeta}>
                <span className={styles.factTag}>{row.model.type}</span>
                <span className={styles.modelCardFacts}>{factsLine(row.model)}</span>
              </span>
              <span className={styles.capChips}>
                {missingFloor(row.model, floor).map((cap) => (
                  <span key={cap} className={`${styles.capChip} ${styles.capChipMissing}`}>
                    {`✕ ${cap}`}
                  </span>
                ))}
              </span>
            </div>
          ))}
      </div>

      <span className={styles.srOnly} role="status" aria-live="polite">
        {`${matches.length} model${matches.length === 1 ? '' : 's'} match this filter`}
      </span>

      {matches.length === 0 && !declaring && (
        <p className={styles.fieldHint}>
          No defined model meets this filter. Type a name above to declare one by hand.
        </p>
      )}

      {/*
       * In flow BENEATH the grid, never replacing it: the provider select and
       * the filter stay reachable while declaring. Hiding them stranded a
       * use case with no applied route — Done demands a provider that had no
       * control on screen.
       */}
      {manual !== null && (
        <div className={styles.bandFacts}>
          <fieldset className={styles.manual}>
            <legend className={styles.editorLegend}>Enter a model manually</legend>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`${id}-manual-model`}>
                Model name
              </label>
              <input
                className={styles.input}
                id={`${id}-manual-model`}
                value={manual.model}
                onChange={(event) => patch({ model: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`${id}-manual-type`}>
                Type
              </label>
              <select
                className={styles.input}
                id={`${id}-manual-type`}
                value={manual.type}
                onChange={(event) => patch({ type: event.target.value as ModelType })}
              >
                <option value="">Choose a type</option>
                {MODEL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
              <span className={styles.fieldHint}>
                Required. Golem stores the model type, and no inventory can supply it for a model
                you enter by hand.
              </span>
            </div>
            <fieldset className={styles.capabilities}>
              <legend className={styles.fieldLabel}>Capabilities this model supports</legend>
              {CAPABILITY_NAMES.map((cap) => {
                const locked = floor.includes(cap);
                return (
                  <label
                    key={cap}
                    className={`${styles.checkbox} ${locked ? styles.checkboxLocked : ''}`}
                  >
                    <input
                      className={styles.checkboxInput}
                      type="checkbox"
                      disabled={locked}
                      checked={locked || manual.caps.includes(cap)}
                      onChange={(event) =>
                        patch({
                          caps: canonicalCaps(
                            event.target.checked
                              ? [...manual.caps, cap]
                              : manual.caps.filter((other) => other !== cap)
                          ),
                        })
                      }
                    />
                    <span className={styles.checkboxBox} aria-hidden="true" />
                    {cap}
                    {locked && (
                      <>
                        {' '}
                        <span className={styles.requiredTag}>required</span>
                      </>
                    )}
                  </label>
                );
              })}
              <span className={styles.fieldHint}>
                What you declare here is what Golem may use. The capabilities this use case requires
                are checked and locked.
              </span>
            </fieldset>
            <button
              type="button"
              className={`${styles.button} ${styles.quiet}`}
              onClick={() => onManual(null)}
            >
              Back to the model list
            </button>
          </fieldset>
        </div>
      )}

      {blocked.length > 0 && (
        <button
          type="button"
          className={styles.hiddenLine}
          onClick={() => setShowHidden((current) => !current)}
        >
          <span className={styles.hiddenCount}>
            {`${blocked.length} model${blocked.length === 1 ? '' : 's'}`}
          </span>
          {` do${blocked.length === 1 ? 'es' : ''} not meet ${floor.join(' · ')} — `}
          <span className={styles.hiddenToggle}>{showHidden ? 'hide them' : 'show them'}</span>
        </button>
      )}
    </div>
  );
}

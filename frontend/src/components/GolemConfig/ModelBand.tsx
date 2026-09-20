/**
 * The inline model band (#263 spec §4.4/§4.7, picker revamp v2 Treatment 1).
 *
 * The editor row GROWS instead of overlaying: provider select, filter field and
 * a card grid, then one master-detail strip. The models, the declare path and
 * the hidden-by-floor set are all permanently visible surfaces — nothing about
 * CHOOSING a model hides behind a layer. The one floating thing is a card's
 * detail popup, which portals out so no ancestor clips it and is dismissed by
 * Escape, by a pointerdown outside it, or by the pointer simply leaving.
 *
 * Cards are uniformly COMPACT and never expand: a name, then the numbers or the
 * abilities, then the note or the abilities — two or three lines, each ONE line
 * with an ellipsis. A hover or focus popup carries what they cut short, and the
 * strip below owns the rest, so a grid row can never inflate and the geometry
 * never moves under the cursor. The strip has three states — the declare form, a
 * one-line placeholder, or the readout — so it never jumps into existence.
 *
 * Arrowing the grid PREVIEWS the focused card in the strip: its facts in the
 * head, what it would expose as INERT chips, its own card in words and its note
 * in full. The editable exposure editor belongs to what is actually selected and
 * steps aside while previewing, because editing exposure you have not chosen
 * would stage a lie.
 *
 * Everything here is a filter and a pre-check. The backend independently
 * re-derives eligibility and refuses a model that does not meet the affected
 * requirements, so nothing below is authoritative.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CAPABILITY_NAMES,
  MODEL_TYPES,
  compareString,
  type CapabilityName,
  type ModelProjection,
  type ModelType,
  type ProviderProjection,
  type RouteProjection,
} from '../../types/golem';
import { shortfallLine, type FloorShortfall } from '../../types/golemConfig';
import { orderModelsForDisplay } from '../../utils/golemModelOrder';
import { AbilityChips } from './AbilityChips';
import styles from './GolemConfig.module.css';
import { ModelCardPopup, type CardInfo } from './ModelCardPopup';
import {
  TYPE_LABEL,
  abilitiesLine,
  factsLine,
  noteOf,
  usedByOf,
  type ManualModel,
} from './routeEdit';

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

/**
 * Why the card popup is open, held by up to three independent facts at once,
 * plus the pointer modality that decides whether a focus opens it at all. Every
 * one names the CARD it belongs to, so a hold can neither outlive its card nor
 * be inherited by the card React mounts in its place.
 */
interface PopupHold {
  /** The card the pointer is on. */
  hoverKey: string | null;
  /** The pointer is on the popup itself (WCAG 1.4.13: it has to be reachable). */
  popHovered: boolean;
  /** The card that has focus. */
  focusKey: string | null;
  /**
   * The card a press is on, set on MOUSEDOWN. The focus a click brings must NOT
   * open the popup — it would land over the strip the click was aiming at — while
   * keyboard and programmatic focus still open at once. `:focus-visible` cannot
   * tell them apart here: jsdom aliases it to `:focus`.
   *
   * Mousedown, not pointerdown, because the compatibility mouse event is the one
   * that precedes focus in BOTH modalities: a mouse press is pointerdown >
   * mousedown > focus, and a touch tap is pointerdown > pointerup > mousedown >
   * focus. A cancelled touch (a scroll, a drag away) fires no mouse events at
   * all, so there is nothing to clear.
   */
  pointerKey: string | null;
  /**
   * Removes the live per-press `mouseup` listener. It is registered at the
   * DOCUMENT (a release off the card is heard nowhere else), so it outlives the
   * card that set it and has to be taken away by hand: on the next press, when
   * it fires, and on unmount.
   */
  releaseListener: (() => void) | null;
  /**
   * Removes the one-shot document `mouseup` listener a selection drag out of
   * the popup registers: the pointer leaves the popup with the button down,
   * and the RELEASE decides — outside the popup it is the departure the leave
   * was not; back over it, nothing. Same lifetime rules as `releaseListener`.
   */
  selectionRelease: (() => void) | null;
  /** A pending hover-open, for `pendingKey`. */
  openTimer: number;
  pendingKey: string | null;
  closeTimer: number;
}

const sameModel = (a: ModelProjection | null, b: ModelProjection): boolean =>
  a !== null && rowKey(a) === rowKey(b);

/** Hover detail wherever the abbreviated context renders: the exact count. */
const contextTitle = (model: ModelProjection): string | undefined =>
  model.contextWindow === undefined ? undefined : `${model.contextWindow} tokens`;

export interface ModelBandProps {
  /** DOM id root; the grid is `<id>-grid` and its cards `<id>-card-N`. */
  id: string;
  /** The use case being routed — the one thing every card below can serve. */
  useCase: string;
  /**
   * That use case's own floor: the filter label, and what a fresh declaration
   * starts with (a new name has no selector siblings yet).
   */
  floor: readonly CapabilityName[];
  /**
   * The union floor of everything the CURRENT candidate governs — `floor` plus
   * whatever its own selector siblings need: the declare form's `(required)`
   * marks (a declared name can join an existing selector) and the readout's
   * highlighted chips. A mark is not a lock: only a cap the declaration already
   * carries locks, because a declaration is what the user asserts.
   */
  required: readonly CapabilityName[];
  /**
   * One card's verdict: each floor capability the model lacks, with the use
   * cases that need it. A card's OWN selector siblings count beyond `useCase`,
   * which is why this is a question per card rather than one floor. Empty
   * means the card can be chosen.
   */
  shortfalls: (model: ModelProjection) => readonly FloorShortfall[];
  /** Every model the document defines, across providers. */
  models: readonly ModelProjection[];
  provider: string;
  providers: readonly ProviderProjection[];
  /** The chosen model, or null. The MODEL, not its name: two rows can share one. */
  selected: ModelProjection | null;
  /** Non-null while the declare fieldset is open. */
  manual: ManualModel | null;
  /**
   * The exposure editor for the SELECTED model (capabilities + think mode),
   * owned by the route editor and placed in the strip's right half. Passing it
   * as a node keeps the staging state where it already lives.
   */
  exposure?: ReactNode;
  /** The applied routes: what a card's own roles are "used by", on the card and in the strip. */
  routes: readonly RouteProjection[];
  /** The use cases whose floor `required` comes from — the REQUIRED group names them. */
  owners: readonly string[];
  /**
   * What a given card would expose and the floor it would meet, for the
   * preview strip — derived the way `shortfalls` is, cached per role next to
   * it. A previewed card's floor is its OWN: its selector siblings, not the
   * candidate's.
   */
  preview: (model: ModelProjection) => {
    required: CapabilityName[];
    owners: string[];
    offered: CapabilityName[];
  };
  onProviderChange: (provider: string) => void;
  onSelect: (model: ModelProjection) => void;
  /** `commitName` marks Declare or leaving the name field, never a keystroke. */
  onManual: (manual: ManualModel | null, commitName?: boolean) => void;
}

export function ModelBand({
  id,
  useCase,
  floor,
  required,
  shortfalls,
  models,
  provider,
  providers,
  selected,
  manual,
  exposure,
  routes,
  owners,
  preview,
  onProviderChange,
  onSelect,
  onManual,
}: ModelBandProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  /**
   * Detail-follows-focus: arrowing through the grid previews the focused card
   * in the strip without assigning it. Cards never expand — the strip is the
   * only place facts are shown, so the grid geometry never moves.
   */
  const [previewing, setPreviewing] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  /** True only for the render that follows a keyboard move. */
  const navigatedRef = useRef(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const gridId = `${id}-grid`;

  // The verdict rides on the row: one call per card per render, and a blocked
  // card renders the very shortfall that blocked it.
  const judged = buildModelRows(models, provider).map((row) => ({
    ...row,
    short: shortfalls(row.model),
  }));
  const eligible = judged.filter((row) => row.short.length === 0);
  const blocked = judged.filter((row) => row.short.length > 0);

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

  /** A card's facts in full, for its popup: the APPLIED card, never a staged declaration. */
  const cardInfo = (row: ModelRow): CardInfo => ({
    name: row.model.modelName,
    type: TYPE_LABEL[row.model.type],
    facts: [
      row.model.parameters === undefined ? undefined : `${row.model.parameters} parameters`,
      row.model.contextWindow === undefined
        ? undefined
        : `${row.model.contextWindow}-token context`,
      row.model.dimensions === undefined ? undefined : `${row.model.dimensions} dimensions`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · '),
    abilities: abilitiesLine(row.model.capabilityFacts.caps),
    notes: row.descriptions,
    usedBy: usedByOf(routes, row.roles),
  });

  /**
   * The popup's holds, each OWNED by a card key rather than a band-wide
   * boolean: one card's hover or focus must never keep another card's popup
   * alive, and a handler must never read a stale closure. Timers live here for
   * the same reason.
   */
  const hold = useRef<PopupHold>({
    hoverKey: null,
    popHovered: false,
    focusKey: null,
    pointerKey: null,
    releaseListener: null,
    selectionRelease: null,
    openTimer: 0,
    pendingKey: null,
    closeTimer: 0,
  });
  const [popup, setPopup] = useState<{ key: string; anchor: HTMLElement } | null>(null);

  const cancelOpen = () => {
    clearTimeout(hold.current.openTimer);
    hold.current.pendingKey = null;
  };
  const clearTimers = () => {
    cancelOpen();
    clearTimeout(hold.current.closeTimer);
  };
  /**
   * Closes the popup. Card holds are NOT touched: they record where the
   * pointer and focus really are, and Escape does not move either — a card
   * still hovered or focused after Escape reopens on the next enter/focus and
   * is held as before. Only the popup's own hover ends with the popup.
   */
  const closePopup = () => {
    clearTimers();
    hold.current.popHovered = false;
    setPopup(null);
  };
  /**
   * Forgets holds naming cards that are no longer shown. A card React removes
   * fires neither `onBlur` nor `onMouseLeave` (focus moves to the body
   * silently; the pointer is simply over nothing), so its holds would outlive
   * it and be inherited by its next mount. Holds on cards still shown survive.
   */
  const dropHoldsNotIn = (shown: ReadonlySet<string>) => {
    const h = hold.current;
    if (h.hoverKey !== null && !shown.has(h.hoverKey)) h.hoverKey = null;
    if (h.focusKey !== null && !shown.has(h.focusKey)) h.focusKey = null;
    if (h.pointerKey !== null && !shown.has(h.pointerKey)) h.pointerKey = null;
    if (h.pendingKey !== null && !shown.has(h.pendingKey)) cancelOpen();
  };
  /**
   * Closes 120 ms later unless the OPEN card is still hovered or REALLY focused,
   * or the popup is hovered. The updater reads the popup React holds now, not a
   * copy this render captured — the timer may outlive several renders.
   */
  const settle = () => {
    clearTimeout(hold.current.closeTimer);
    hold.current.closeTimer = window.setTimeout(() => {
      setPopup((current) => {
        if (current === null) return current;
        const h = hold.current;
        // A focus hold counts only while the document agrees: a removed card kept
        // its key without a blur, and its replacement must not inherit the hold.
        const focused = h.focusKey === current.key && document.activeElement === current.anchor;
        return h.hoverKey === current.key || focused || h.popHovered ? current : null;
      });
    }, 120);
  };
  /**
   * Opens (or replaces) the popup for one card; a pending hover-open for any
   * card is dropped. Only the card's KEY is held: what the popup says is read
   * from the card as it stands at render, so a reload that rewrites a note or
   * a fact while the popup is up shows at once rather than at the next open.
   */
  const open = (key: string, anchor: HTMLElement) => {
    cancelOpen();
    clearTimeout(hold.current.closeTimer);
    setPopup({ key, anchor });
  };
  const popupRow =
    popup === null ? undefined : matches.find((row) => rowKey(row.model) === popup.key);
  const popupInfo = popupRow === undefined ? null : cardInfo(popupRow);

  /**
   * What the grid actually SHOWS as a stop, as one string: eligibility and the
   * filter both count, and React compares this by identity where the rebuilt
   * `matches` array would differ on every render.
   */
  const shownKey = `${provider}\u0000${query}\u0000${matches.map((row) => rowKey(row.model)).join('\u0001')}`;
  useEffect(() => {
    const shown = new Set(matches.map((row) => rowKey(row.model)));
    dropHoldsNotIn(shown); // also cancels a PENDING open whose card just left
    if (popup !== null && !shown.has(popup.key)) closePopup();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shownKey is derived FROM matches, and the popup only ever leaves with a card, so the string alone is the honest trigger
  }, [shownKey]);
  // Belt and braces for anything else that takes the anchor out of the
  // document: React never observes `isConnected`, so it has to be read on every
  // commit. It cannot loop — the close renders once more with no popup.
  useEffect(() => {
    if (popup !== null && !popup.anchor.isConnected) {
      dropHoldsNotIn(new Set(matches.map((row) => rowKey(row.model))));
      closePopup();
    }
  });
  /*
   * Two things dismiss an open popup from anywhere.
   *
   * Escape, wherever focus is: hovering a card takes no focus, so the band's own
   * handler would never hear it. And a pointerdown OUTSIDE the popup — it is
   * opaque and sits over the cards below it (or over the strip), so a press
   * heading for something underneath has to take it away first, before the click
   * lands on it and is swallowed. A pointerdown INSIDE it is a scrollbar drag or
   * a text selection on a long note, and never a dismissal.
   */
  useEffect(() => {
    if (popup === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePopup();
    };
    const onPointerDown = (event: PointerEvent) => {
      const node = document.getElementById(`${id}-card-pop`);
      if (node === null || !node.contains(event.target as Node)) closePopup();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closePopup only touches the hold ref and setPopup; listing it would re-register both listeners every render
  }, [popup, id]);
  // A pending timer, or a press still waiting for its release, would reach into
  // an unmounted tree.
  useEffect(
    () => () => {
      clearTimers();
      hold.current.releaseListener?.();
      hold.current.selectionRelease?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearTimers only touches the hold ref, whose identity never changes
    []
  );

  const choose = (model: ModelProjection) => {
    setPreviewing(false);
    onSelect(model);
  };

  const chooseAt = (index: number) => {
    const row = matches[index];
    if (row !== undefined) {
      choose(row.model);
      return;
    }
    if (declaring) onManual({ model: query.trim(), type: '', caps: canonicalCaps(floor) }, true);
  };

  /** One edit of the hand-declared facts; null-safe because the fieldset only
   *  renders while `manual` is non-null. */
  const patch = (next: Partial<ManualModel>) => {
    if (manual !== null) onManual({ ...manual, ...next });
  };

  const moveTo = (index: number) => {
    const next = Math.min(stops - 1, Math.max(0, index));
    // Armed only for a REAL move: a step past either end clamps to the same
    // index, the focus effect (keyed on activeIndex) never runs, and a flag
    // left armed here would fire on the NEXT index change — typing the first
    // character into the filter resets active to 0 — yanking focus onto the
    // grid mid-keystroke.
    if (next !== activeIndex) navigatedRef.current = true;
    setPreviewing(true);
    setActive(next);
  };

  const onGridKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setPreviewing(false);
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

  const assignedKey = selected === null ? null : rowKey(selected);
  const paintedRef = useRef(false);
  useEffect(() => {
    if (!paintedRef.current) {
      paintedRef.current = true;
      return;
    }
    // The grid is the scroll region now, so this moves the GRID, not the page.
    // Arrow navigation needs no equivalent: focusing a card scrolls its own
    // scroller natively, and a second call would fight that.
    gridRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [assignedKey]);

  // Leaving the declare fieldset returns the caret to the filter it was opened
  // from (§4.4).
  const wasManual = useRef(manual !== null);
  useEffect(() => {
    if (wasManual.current && manual === null) filterRef.current?.focus();
    wasManual.current = manual !== null;
  }, [manual]);

  /**
   * What the strip READS OUT. Preview follows keyboard focus, so the left half
   * can describe a card the user is only walking past; the selection is what
   * the exposure editor stays bound to.
   */
  // Walking onto the assigned card previews the SELECTION, not the list row:
  // a reopened route's selection carries the staged declaration, which the
  // list row does not (RouteEditor's `seedFrom`), and the head says "assigned".
  // The ROW, not just its model: the strip reads its roles and their notes.
  const previewEntry = previewing ? matches[activeIndex] : undefined;
  /** A walked card: its row, plus the floor IT would meet — asked once per render. */
  const previewed =
    previewEntry === undefined || sameModel(selected, previewEntry.model)
      ? undefined
      : { ...previewEntry, shape: preview(previewEntry.model) };
  const previewingOther = previewed !== undefined;
  const detail = previewed?.model ?? selected;
  const detailFacts = detail === null ? '' : factsLine(detail);
  const previewUsedBy = previewed === undefined ? [] : usedByOf(routes, previewed.roles);
  /**
   * The notes of whatever the strip is reading out. The card ellipsises the
   * first and the popup needs a pointer, so this is where a keyboard reaches
   * them all — in EITHER state, not only while previewing.
   *
   * For the selection that means its ROW, found by identity and independent of
   * the filter (a hidden card's model is still assigned). A selection with no row
   * on this provider at all — a reopened route naming a model the document no
   * longer lists — falls back to the model's own note.
   */
  const detailNotes =
    previewed?.descriptions ??
    (detail === null
      ? []
      : (judged.find((row) => sameModel(detail, row.model))?.descriptions ??
        (detail.description === undefined
          ? []
          : [{ role: detail.role, description: detail.description }])));
  const detailState =
    manual !== null
      ? 'declaring'
      : detail === null
        ? 'empty'
        : previewingOther
          ? 'previewing'
          : 'assigned';

  const declareForm =
    manual === null ? null : (
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
            onBlur={() => onManual(manual, true)}
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
            Required. Golem stores the model type, and no inventory can supply it for a model you
            enter by hand.
          </span>
        </div>
        {/* Same chips as the exposure editor, in declaration mode: here they ARE
            the card, so a chip outside it is no assertion to footnote. A
            required cap the declaration lacks stays off and enabled — ticking
            it is the user's assertion, never the form's (§4.4). */}
        <AbilityChips
          id={`${id}-manual-caps`}
          legend="Capabilities this model supports"
          legendVisible
          required={required}
          owners={owners}
          declared={[]}
          model={manual.model}
          selected={manual.caps}
          mode="declaration"
          onToggle={(cap, on) =>
            patch({
              caps: canonicalCaps(
                on ? [...manual.caps, cap] : manual.caps.filter((other) => other !== cap)
              ),
            })
          }
        />
        <span className={styles.fieldHint}>
          {`This becomes the model's card.${required.length > 0 ? ' The route needs the capabilities marked required.' : ''}`}
        </span>
        <button
          type="button"
          className={`${styles.button} ${styles.quiet}`}
          onClick={() => onManual(null)}
        >
          Back to the model list
        </button>
      </fieldset>
    );

  const filterLabel = floor.length === 0 ? 'filter: none' : `filter: ${floor.join(' · ')}`;

  return (
    <div
      className={styles.band}
      // Capture only REORDERS: both handlers run in either phase, so one Escape
      // dismisses the popup AND returns the preview to the selection — by
      // design, topmost first. The same handler sees Escape from the filter, the
      // selects and the declare form, where closePopup() is a no-op. Focus
      // outside the band entirely is the document listener's case.
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape') closePopup();
      }}
    >
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
            setPreviewing(false);
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
        // The grid is the bounded scroller: its scroll CLIPS the anchor instead
        // of moving the popup with it, so re-placing onto the card's rect would
        // put the popup over the band head. One narrowing of "scroll re-places":
        // an ancestor or page scroll still does.
        //
        // Focus is the exception, and only while its card is still IN this box.
        // Focusing an off-screen card scrolls the grid to it natively — the
        // roving focus relies on that — so that scroll arrives right behind the
        // open it caused and must not undo it; the window capture listener
        // re-places it instead. A WHEEL scroll of the same focused card is not
        // the same thing: once the card is clipped out of the grid, the popup
        // would be re-placed onto its rect over the band head. jsdom computes no
        // rects, so a zero-rect anchor reads as visible there.
        onScroll={(event) => {
          if (popup !== null && document.activeElement === popup.anchor) {
            const anchor = popup.anchor.getBoundingClientRect();
            const grid = event.currentTarget.getBoundingClientRect();
            if (!(anchor.bottom < grid.top || anchor.top > grid.bottom)) return;
          }
          closePopup();
        }}
        onBlur={(event) => {
          // Card-to-card moves stay inside the grid; only leaving it entirely
          // ends the preview.
          if (!event.currentTarget.contains(event.relatedTarget)) setPreviewing(false);
        }}
      >
        {matches.map((row, index) => {
          const chosen = sameModel(selected, row.model);
          const key = rowKey(row.model);
          const facts = factsLine(row.model);
          const abilities = abilitiesLine(row.model.capabilityFacts.caps);
          const note = noteOf(row.descriptions);
          return (
            <div
              key={key}
              id={`${id}-card-${index}`}
              role="option"
              aria-selected={chosen}
              aria-describedby={popup?.key === key ? `${id}-card-pop` : undefined}
              tabIndex={index === activeIndex ? 0 : -1}
              data-active={index === activeIndex || undefined}
              data-provenance={row.provenance}
              className={`${styles.modelCard} ${chosen ? styles.modelCardChosen : ''}`}
              onClick={() => {
                setActive(index);
                choose(row.model);
              }}
              // A hover-open needs a real hover, which only a mouse or a pen
              // has. A touch tap dispatches its COMPATIBILITY mouseenter after
              // pointerdown (pointerenter > pointerdown > pointerleave >
              // mouseenter > mousedown > focus), so a mouse-keyed hover would
              // schedule an open the press cannot cancel and pin a popup over
              // the strip the tap was aiming at. The LEAVE ignores touch for the
              // mirror reason: on a hybrid device a finger's leave must not drop
              // the hover or the pending open a mouse is holding.
              onPointerEnter={(event) => {
                if (event.pointerType === 'touch') return;
                // A drag is not a hover: a selection drag crossing this card
                // must not schedule its open, or lingering here past 160 ms
                // would replace the popup the selection lives in. Nothing is
                // held for it either; a release then re-entry hovers as usual.
                // `> 0`, not `!== 0`: jsdom's pointer events carry no
                // `buttons` at all, and a missing value is no button.
                if (event.buttons > 0) return;
                const anchor = event.currentTarget; // captured: React clears currentTarget after dispatch
                hold.current.hoverKey = key;
                if (popup?.key === key) {
                  clearTimeout(hold.current.closeTimer); // re-entry: keep it
                  return;
                }
                cancelOpen();
                hold.current.pendingKey = key;
                hold.current.openTimer = window.setTimeout(() => {
                  if (hold.current.pendingKey === key) open(key, anchor);
                }, 160);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === 'touch') return;
                if (hold.current.hoverKey === key) hold.current.hoverKey = null;
                if (hold.current.pendingKey === key) cancelOpen();
                settle();
              }}
              onPointerDown={() => {
                // A press is a choice, not a request to read: whatever the
                // pointer started 160 ms ago on the way in is dropped, and the
                // open popup (if any) is taken away by the document listener.
                cancelOpen();
              }}
              onMouseDown={() => {
                const h = hold.current;
                h.pointerKey = key;
                // A press on an ALREADY focused card fires no focus event to
                // consume the flag, and a release off the card fires no mouseup
                // ON it (a mouse has no implicit pointer capture), so the
                // release is heard at the document. One shot, capture, and
                // independent of whether any popup is open.
                h.releaseListener?.(); // a press whose release never arrived
                const onRelease = () => {
                  h.releaseListener = null; // `once` already took it off
                  if (h.pointerKey === key) h.pointerKey = null;
                };
                h.releaseListener = () => {
                  document.removeEventListener('mouseup', onRelease, true);
                  h.releaseListener = null;
                };
                document.addEventListener('mouseup', onRelease, { once: true, capture: true });
              }}
              onFocus={(event) => {
                hold.current.focusKey = key;
                const byPointer = hold.current.pointerKey === key;
                hold.current.pointerKey = null;
                if (!byPointer) open(key, event.currentTarget);
              }}
              onBlur={() => {
                if (hold.current.focusKey === key) hold.current.focusKey = null;
                settle();
              }}
            >
              <span className={styles.modelCardTop}>
                <span className={styles.modelName}>{row.model.modelName}</span>
                {chosen && <span className={styles.modelCardMark}>assigned</span>}
              </span>
              {/*
               * Two or three lines, each ONE line: the numbers when there are
               * any, the abilities otherwise, then the note — so a card never
               * repeats its abilities and never grows under the cursor. The
               * popup and the strip carry everything these ellipsise.
               */}
              <span className={styles.modelCardMeta}>
                <span className={styles.factTag}>{row.model.type}</span>
                {facts === '' ? (
                  <span className={styles.modelCardAbilities}>{abilities}</span>
                ) : (
                  <span className={styles.modelCardFacts}>{facts}</span>
                )}
              </span>
              {note !== undefined ? (
                <span className={styles.modelCardNote}>{note}</span>
              ) : (
                facts !== '' && <span className={styles.modelCardAbilities}>{abilities}</span>
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
                <span className={styles.modelCardFacts}>{shortfallLine(row.short)}</span>
              </span>
              <span className={styles.modelCardMeta}>
                <span className={styles.factTag}>{row.model.type}</span>
                <span className={styles.modelCardFacts} title={contextTitle(row.model)}>
                  {factsLine(row.model)}
                </span>
              </span>
              <span className={styles.capChips}>
                {row.short.map(({ cap }) => (
                  <span key={cap} className={`${styles.capChip} ${styles.capChipMissing}`}>
                    {`✕ ${cap}`}
                  </span>
                ))}
              </span>
            </div>
          ))}
      </div>

      {/*
       * One popup per band, after the grid: the card it belongs to is named by
       * `popup.key`, and `showHidden` joins the layout key because revealing a
       * blocked card can stretch the grid row an eligible card shares — moving
       * the anchor's bottom edge with no scroll and no resize to hear.
       */}
      <ModelCardPopup
        id={`${id}-card-pop`}
        open={popup !== null}
        anchor={popup?.anchor ?? null}
        info={popupInfo}
        layoutKey={`${shownKey}\u0000${showHidden}`}
        onEnter={() => {
          hold.current.popHovered = true;
          clearTimeout(hold.current.closeTimer);
        }}
        onLeave={(event) => {
          const h = hold.current;
          if (event.buttons !== 0) {
            // A selection drag past the popup's edge, button still down: not a
            // departure. The release decides, wherever it lands.
            h.selectionRelease?.();
            const onRelease = (release: MouseEvent) => {
              h.selectionRelease = null; // `once` already took it off
              const node = document.getElementById(`${id}-card-pop`);
              if (node !== null && node.contains(release.target as Node)) return;
              // Released outside with a selection anchored in the popup: the
              // drag WAS the selection, and closing now would take the DOM it
              // lives in before it can be copied. Nothing is scheduled, so the
              // popup and its selection stand until the next thing that
              // settles or dismisses — a card leave or blur, a press outside
              // (which also collapses the selection), Escape — or a later
              // hover-open of another card, which replaces it. The card the
              // release lands on is not that: the popup sits below its card,
              // so an overshoot usually ends on the next one, whose pending
              // hover-open is dropped here. The hold still tells the truth,
              // the pointer has left: a stale hover hold would be inherited by
              // the next card's popup and never let it close.
              const selection = document.getSelection();
              h.popHovered = false;
              if (
                node !== null &&
                selection !== null &&
                !selection.isCollapsed &&
                selection.anchorNode !== null &&
                node.contains(selection.anchorNode)
              ) {
                clearTimeout(h.closeTimer);
                cancelOpen();
                return;
              }
              settle();
            };
            h.selectionRelease = () => {
              document.removeEventListener('mouseup', onRelease, true);
              h.selectionRelease = null;
            };
            document.addEventListener('mouseup', onRelease, { once: true, capture: true });
            return;
          }
          h.popHovered = false;
          settle();
        }}
      />

      <span className={styles.srOnly} role="status" aria-live="polite">
        {`${matches.length} model${matches.length === 1 ? ' matches' : 's match'} this filter`}
      </span>

      {matches.length === 0 && !declaring && (
        <p className={styles.fieldHint}>
          No defined model meets this filter. Type a name above to declare one by hand.
        </p>
      )}

      {/*
       * The master-detail strip (Treatment 1). One surface below the grid, in
       * three states, so the layout never jumps into existence and the grid
       * never reflows: the declare form, a one-line dashed placeholder, or the
       * readout — facts left, the exposure editor right of a hairline rule.
       */}
      <div
        className={`${styles.detail} ${detailState === 'empty' ? styles.detailEmpty : ''}`}
        data-testid="model-detail"
        data-state={detailState}
      >
        {manual !== null ? (
          <>
            <div className={styles.detailHead}>
              <span className={styles.detailName}>
                {`declare "${manual.model === '' ? '…' : manual.model}"`}
              </span>
              <span className={styles.grow} />
              <span className={styles.detailOwner}>
                {`on ${provider} — facts you assert, nothing detects them`}
              </span>
            </div>
            {declareForm}
            {exposure !== undefined && (
              <div className={styles.detailDeclaredExposure}>
                {exposure}
                {/* The exposure chips write back into the card above, one way:
                    §4.4 never withdraws a declaration on the user's behalf. */}
                <span className={styles.fieldHint}>
                  Turning one on here adds it to the card above; turning one off leaves the card
                  alone.
                </span>
              </div>
            )}
          </>
        ) : detail === null ? (
          'No model assigned. Select a card above — its facts and the exposure editor land here, together.'
        ) : (
          <>
            <div className={styles.detailHead}>
              <span className={styles.detailName}>{detail.modelName}</span>
              <span className={styles.factTag}>{detail.type}</span>
              {/* ASSIGNED is the route's actual model; a preview says so instead. */}
              {previewingOther ? (
                <span className={styles.detailHint}>press Enter to choose</span>
              ) : (
                <span className={styles.modelCardMark}>assigned</span>
              )}
              {detailFacts !== '' && <span className={styles.detailFacts}>{detailFacts}</span>}
              {/* Who already routes to this card — a PREVIEW's reading. An
                  assigned model's use cases are the rows' own business, and
                  "used by no route" is not worth a line. */}
              {previewUsedBy.length > 0 && (
                <span className={styles.detailFacts}>{`used by ${previewUsedBy.join(', ')}`}</span>
              )}
              <span className={styles.grow} />
              <span className={styles.detailOwner}>{`from ${detail.provider}`}</span>
            </div>

            <div className={styles.detailBody}>
              {previewed === undefined ? (
                /*
                 * Bound to the SELECTION (or the hand declaration), never to a
                 * preview: editing exposure you have not chosen would stage a
                 * lie. The owner decides whether there is anything to expose.
                 */
                exposure
              ) : (
                <>
                  {/* Inert: the same chips as the editor, so the walked card is
                      read in the grammar it would be edited in. */}
                  <AbilityChips
                    id={`${id}-preview`}
                    legend={`Capabilities ${detail.modelName} would expose to ${useCase}`}
                    required={previewed.shape.required}
                    owners={previewed.shape.owners}
                    declared={detail.capabilityFacts.caps}
                    model={detail.modelName}
                    selected={previewed.shape.offered}
                    readOnly
                  />
                  <span className={styles.detailCard}>
                    {`${detail.modelName}'s card lists: ${abilitiesLine(detail.capabilityFacts.caps)}`}
                  </span>
                </>
              )}

              {/* The note in full, whichever state the body is in. */}
              {detailNotes.map((note) => (
                <p key={note.role} className={styles.detailNote}>
                  {detailNotes.length > 1 && (
                    <span className={styles.detailNoteRole}>{note.role}</span>
                  )}
                  {note.description}
                </p>
              ))}
            </div>
          </>
        )}
      </div>

      {blocked.length > 0 && (
        <button
          type="button"
          className={styles.hiddenLine}
          onClick={() => setShowHidden((current) => !current)}
        >
          <span className={styles.hiddenCount}>
            {`${blocked.length} model${blocked.length === 1 ? '' : 's'}`}
          </span>
          {` ${blocked.length === 1 ? 'is' : 'are'} not eligible — `}
          <span className={styles.hiddenToggle}>
            {`${showHidden ? 'hide' : 'show'} ${blocked.length === 1 ? 'it' : 'them'}`}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * The filtered model picker and its manual-entry fallback (#263 spec §4.4,
 * §4.7).
 *
 * Two primitives, reused rather than reinvented: CommandPalette's
 * active-descendant keyboard model (the input never loses focus; the listbox
 * has no roving tabindex) and BranchSwitcher's fixed-position portal, so no
 * ancestor of the expanded row can clip the popup.
 *
 * The footer — the hidden count and the manual-entry action — deliberately
 * lives in the editor's own DOM rather than inside the portal. A portal is
 * appended to `document.body`, so anything inside it sits at the END of the tab
 * order; a manual-entry action in there would be reachable by pointer only.
 *
 * Until inventory lands (slice 4) the options are the models the document
 * already defines. Everything here is a filter and a pre-check: the backend
 * independently re-derives eligibility and refuses a model that does not meet
 * the affected requirements.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CAPABILITY_NAMES,
  MODEL_TYPES,
  type CapabilityName,
  type ModelProjection,
  type ModelType,
} from '../../types/golem';
import styles from './GolemConfig.module.css';

/** The popup's CSS max-width; the anchor clamp keeps this span on-screen. */
const POPUP_MAX_WIDTH = 340;

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

export interface ModelPickerProps {
  /** DOM id root; the listbox is `<id>-listbox` and options `<id>-option-N`. */
  id: string;
  /** The use case's Firn floor; these capabilities are the filter. */
  floor: readonly CapabilityName[];
  /** Every model defined for the chosen provider. */
  models: readonly ModelProjection[];
  /**
   * The chosen model, or null. The MODEL, not its name: two options can share a
   * name while declaring different facts, and a single-select listbox must mark
   * exactly one of them selected.
   */
  selected: ModelProjection | null;
  /** Non-null while the manual fieldset has replaced the combobox. */
  manual: ManualModel | null;
  onSelect: (model: ModelProjection) => void;
  onManual: (manual: ManualModel | null) => void;
}

interface PopupPos {
  top: number;
  left: number;
}

/**
 * The exact tuple `sameModelFacts` compares, flattened. An absent optional fact
 * is its zero value on both sides, matching the projection (which omits empty
 * and zero facts) and the backend comparison. NUL cannot occur inside any of
 * these values, so it separates the fields unambiguously.
 */
const factsKey = (model: ModelProjection): string =>
  [
    model.provider,
    model.modelName,
    model.type,
    model.parameters ?? '',
    model.contextWindow ?? 0,
    model.dimensions ?? 0,
  ].join('\u0000');

/**
 * What tells two same-named models apart in the list. Only rendered when a name
 * is actually ambiguous, so the ordinary case stays a bare model id.
 */
const factsLabel = (model: ModelProjection): string =>
  [
    model.parameters,
    model.contextWindow === undefined ? undefined : `${model.contextWindow} ctx`,
    model.dimensions === undefined ? undefined : `${model.dimensions} dim`,
    model.type,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');

export function ModelPicker({
  id,
  floor,
  models,
  selected,
  manual,
  onSelect,
  onManual,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pos, setPos] = useState<PopupPos | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const listboxId = `${id}-listbox`;
  const inputId = `${id}-model`;

  // One row per distinct set of MODEL FACTS, not per name. Several roles may
  // point at the same provider+model, and the picker chooses a model rather
  // than a role — but two roles can also share a name while declaring different
  // facts, and those are different choices: `sameModelFacts` (the comparison
  // the backend re-runs) says so, and collapsing them would silently stage the
  // first role's numbers for whichever the user thought they clicked.
  const unique = models.filter(
    (model, index) => models.findIndex((other) => factsKey(other) === factsKey(model)) === index
  );
  const eligible = unique.filter((model) =>
    floor.every((cap) => model.exposedCapabilities.includes(cap))
  );
  const hidden = unique.length - eligible.length;
  const needle = query.trim().toLowerCase();
  const matches = eligible.filter((model) => model.modelName.toLowerCase().includes(needle));
  const active = matches.length > 0 ? Math.min(activeIndex, matches.length - 1) : -1;

  // Anchor the fixed popup under the input, clamped so its widest possible span
  // stays on-screen (BranchSwitcher's placement, verbatim).
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = wrapRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - POPUP_MAX_WIDTH - 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // An outside pointer closes the popup and nothing else: the click's own
  // target keeps the focus it just took.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
      setActiveIndex(-1);
      setPos(null); // same stale-anchor rule as `close`
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Leaving manual entry returns the caret to the control it replaced (§4.4).
  const wasManual = useRef(manual !== null);
  useEffect(() => {
    if (wasManual.current && manual === null) inputRef.current?.focus();
    wasManual.current = manual !== null;
  }, [manual]);

  if (manual !== null) {
    const patch = (next: Partial<ManualModel>) => onManual({ ...manual, ...next });
    return (
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
            Required. Golem stores the model type, and no inventory can supply it for a model you
            enter by hand.
          </span>
        </div>
        <fieldset className={styles.capabilities}>
          <legend className={styles.fieldLabel}>Capabilities this model supports</legend>
          {CAPABILITY_NAMES.map((cap) => {
            const locked = floor.includes(cap);
            return (
              <label key={cap} className={styles.checkbox}>
                <input
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
                {cap}
              </label>
            );
          })}
          <span className={styles.fieldHint}>
            What you declare here is what Golem may use. The capabilities this use case requires are
            checked and locked.
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
    );
  }

  const openList = (index: number) => {
    setOpen(true);
    setQuery('');
    setActiveIndex(index);
  };

  const close = (focusInput: boolean) => {
    setOpen(false);
    setActiveIndex(-1);
    // Drop the anchor with the popup. Keeping it means the next open paints one
    // frame at the OLD coordinates before the layout effect re-measures — a
    // visible jump whenever the row has moved since (a strip expanded above it,
    // the page scrolled, the window resized).
    setPos(null);
    if (focusInput) inputRef.current?.focus();
  };

  const choose = (model: ModelProjection) => {
    onSelect(model);
    close(true);
  };

  const filterLabel = floor.length === 0 ? 'filter: none' : `filter: ${floor.join(' · ')}`;

  return (
    <div className={styles.field} ref={wrapRef}>
      <label className={styles.fieldLabel} htmlFor={inputId}>
        Model
      </label>
      <input
        ref={inputRef}
        className={styles.input}
        id={inputId}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        // Present only while an option is actually active (§4.7).
        {...(open && active >= 0 ? { 'aria-activedescendant': `${id}-option-${active}` } : {})}
        // Closed, the field reads as the current value; open, it is the filter.
        value={open ? query : (selected?.modelName ?? '')}
        onClick={() => {
          if (!open) openList(-1);
        }}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.target.value);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          switch (event.key) {
            case 'ArrowDown':
              event.preventDefault();
              if (!open) openList(0);
              else if (matches.length > 0) setActiveIndex((active + 1) % matches.length);
              break;
            case 'ArrowUp':
              event.preventDefault();
              if (!open) openList(matches.length - 1);
              else if (matches.length > 0)
                setActiveIndex((active - 1 + matches.length) % matches.length);
              break;
            case 'Home':
              if (!open) break;
              event.preventDefault();
              if (matches.length > 0) setActiveIndex(0);
              break;
            case 'End':
              if (!open) break;
              event.preventDefault();
              if (matches.length > 0) setActiveIndex(matches.length - 1);
              break;
            case 'Enter':
              if (!open || active < 0) break;
              event.preventDefault();
              choose(matches[active]);
              break;
            case 'Escape':
              if (!open) break;
              event.preventDefault();
              close(true);
              break;
            case 'Tab':
              // Never prevented: Tab follows the natural focus order (§4.7).
              // The popup simply stops standing over the page.
              if (open) close(false);
              break;
          }
        }}
      />

      <p className={styles.fieldHint}>
        {hidden > 0 &&
          `${hidden} model${hidden === 1 ? '' : 's'} hidden — they do not meet this filter. `}
        A model Golem does not know yet can be declared by hand.
      </p>
      <button
        type="button"
        className={`${styles.button} ${styles.quiet}`}
        onClick={() => {
          // The third exit, through the one path: the manual fieldset REPLACES
          // the combobox, so the anchor it was measured against is about to
          // stop existing — and so is the input, which is why focus is not
          // pulled back to a control that is about to unmount.
          close(false);
          onManual({ model: '', type: '', caps: canonicalCaps(floor) });
        }}
      >
        Enter a model manually
      </button>

      <span className={styles.srOnly} role="status" aria-live="polite">
        {open ? `${matches.length} model${matches.length === 1 ? '' : 's'} match this filter` : ''}
      </span>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popupRef}
            className={styles.pickerPopup}
            data-testid="model-popup"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            <p className={styles.pickerFilter}>{filterLabel}</p>
            <ul id={listboxId} role="listbox" aria-label="Models" className={styles.pickerList}>
              {matches.map((model, index) => {
                // Two options can now share a name while declaring different
                // facts. When they do, the facts ARE the choice, so they are
                // named; an unambiguous name stays a bare model id.
                const ambiguous =
                  matches.filter((other) => other.modelName === model.modelName).length > 1;
                return (
                  <li key={factsKey(model)}>
                    <button
                      type="button"
                      role="option"
                      id={`${id}-option-${index}`}
                      tabIndex={-1}
                      aria-selected={selected !== null && factsKey(model) === factsKey(selected)}
                      data-active={index === active || undefined}
                      className={styles.pickerOption}
                      // The pointer must not take focus off the input.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(model)}
                    >
                      <span className={styles.pickerName}>{model.modelName}</span>
                      {ambiguous && (
                        <>
                          {' ('}
                          <span className={styles.pickerCaps}>{factsLabel(model)}</span>
                          {')'}
                        </>
                      )}
                      {' — '}
                      <span className={styles.pickerCaps}>
                        {model.exposedCapabilities.join(' · ')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {matches.length === 0 && (
              <p className={styles.empty}>
                No defined model meets this filter. Declare one by hand below, or add a model that
                does.
              </p>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

/**
 * One chip per capability (#263, mockup rev 7): selected = exposed to the
 * route, locked once a required chip is on (§4.4: the tick is the user's
 * assertion, never the checklist's), an asterisk and a footnote for a selected
 * chip the model's card does not list. Real checkboxes under the chips:
 * keyboard, screen-reader state and label clicks are the platform's. The
 * input carries the whole accessible name — jsdom's name computation puts a
 * space between child spans, and the face is decoration.
 *
 * Groups are nested fieldsets whose legends are block-level above their own
 * wrapper — WebKit never lets a legend join a grid or flex container — and the
 * two groups are a wrapping flex row: side by side while both fit, the optional
 * group under the required one otherwise, chips wrapping inside each.
 */
import type { ReactNode } from 'react';
import { CAPABILITY_NAMES, type CapabilityName } from '../../types/golem';
import { listUseCases } from '../../utils/listUseCases';
import styles from './GolemConfig.module.css';
import { assertedOf } from './routeEdit';

export interface AbilityChipsProps {
  /** DOM id root; the footnote is `${id}-footnote`. */
  id: string;
  /** The fieldset's accessible name; visually hidden unless `legendVisible`. */
  legend: string;
  legendVisible?: boolean;
  /** The floor: chips in the REQUIRED group; `owners` names the use cases that need them. */
  required: readonly CapabilityName[];
  owners: readonly string[];
  /** The model's card. In `assertion` mode a selected chip outside it carries the footnote mark. */
  declared: readonly CapabilityName[];
  /** The model the footnote names. */
  model: string;
  selected: readonly CapabilityName[];
  /** The row's values: a chip that differs carries the staged-value mark. Ignored when `readOnly`. */
  baseline?: readonly CapabilityName[];
  /**
   * An inert preview: every chip disabled, the accent fill kept (nothing reads
   * locked), no marks, no footnote, no `aria-describedby`, no titles.
   */
  readOnly?: boolean;
  /** `assertion` (default): footnote a selected chip outside `declared`. `declaration`: the chips ARE the card — no asterisk, no footnote. */
  mode?: 'assertion' | 'declaration';
  onToggle?: (cap: CapabilityName, on: boolean) => void;
}

const FOOTNOTE_TAIL =
  'Golem does not check; if the model cannot really do it, the routes that need it fail when they try.';

export function AbilityChips({
  id,
  legend,
  legendVisible = false,
  required,
  owners,
  declared,
  model,
  selected,
  baseline,
  readOnly = false,
  mode = 'assertion',
  onToggle,
}: AbilityChipsProps) {
  const asserted = mode === 'assertion' && !readOnly ? assertedOf(selected, declared) : [];
  const footnoteId = `${id}-footnote`;
  const requiredCaps = CAPABILITY_NAMES.filter((cap) => required.includes(cap));
  const optionalCaps = CAPABILITY_NAMES.filter((cap) => !required.includes(cap));
  const ownersText = owners.length > 0 ? listUseCases(owners) : '';

  const chip = (cap: CapabilityName) => {
    const on = selected.includes(cap);
    const isRequired = required.includes(cap);
    const locked = isRequired && on;
    const isAsserted = asserted.includes(cap);
    const changed = !readOnly && baseline !== undefined && on !== baseline.includes(cap);
    const title = readOnly
      ? undefined
      : [
          isRequired
            ? `${ownersText === '' ? 'Required' : `Required by ${ownersText}`}${locked ? ' — cannot be turned off' : ''}`
            : '',
          isAsserted ? `Turned on by hand, not on ${model}'s card — unverified` : '',
        ]
          .filter(Boolean)
          .join('. ') || undefined;
    return (
      <label
        key={cap}
        className={styles.abilityChip}
        data-oncard={declared.includes(cap) || undefined}
        data-asserted={isAsserted || undefined}
        data-changed={changed || undefined}
        title={title}
      >
        <input
          className={styles.abilityChipInput}
          type="checkbox"
          data-cap={cap}
          aria-label={`${cap}${locked ? ', required' : ''}${isAsserted ? ", not on the model's card" : ''}`}
          aria-describedby={isAsserted ? footnoteId : undefined}
          checked={on}
          disabled={readOnly || locked}
          onChange={(event) => onToggle?.(cap, event.target.checked)}
        />
        <span className={styles.abilityChipFace} aria-hidden="true">
          <span className={styles.abilityChipTick}>✓</span>
          {/* Its own shrinkable element: text-overflow only works on a block-ish box, not on a flex container's anonymous text. */}
          <span className={styles.abilityChipName}>{cap}</span>
        </span>
      </label>
    );
  };

  const group = (name: ReactNode, caps: readonly CapabilityName[], hiddenLegend = false) => (
    <fieldset className={styles.abilityGroup}>
      <legend className={hiddenLegend ? styles.srOnly : undefined}>{name}</legend>
      <div className={styles.abilityChips} data-readonly={readOnly || undefined}>
        {caps.map(chip)}
      </div>
    </fieldset>
  );

  return (
    <fieldset className={styles.capabilities}>
      <legend
        className={legendVisible ? styles.fieldLabel : `${styles.fieldLabel} ${styles.srOnly}`}
      >
        {legend}
      </legend>
      <div className={styles.abilityColumns}>
        {requiredCaps.length > 0 ? (
          <>
            {group(
              ownersText === '' ? (
                'Required'
              ) : (
                <>
                  Required by <span className={styles.abilityOwners}>{ownersText}</span>
                </>
              ),
              requiredCaps
            )}
            {group('Optional', optionalCaps)}
          </>
        ) : (
          group('Capabilities', optionalCaps, true)
        )}
      </div>
      {asserted.length > 0 && (
        <span className={styles.fieldHint} id={footnoteId}>
          {`* Turned on by hand, not on ${model}'s card: ${asserted.join(', ')}. ${FOOTNOTE_TAIL}`}
        </span>
      )}
    </fieldset>
  );
}

/**
 * The Apply bar (#263 spec §4.1 item 4, §3.3, mockup v10; wave 6 groups).
 *
 * Dirty only, and honest about what "dirty" means: `N staged changes`, then
 * what those changes reach. Route changes render as GROUPS, one per model
 * they land on: a header naming the model and what changes on it, then one
 * badge per route it reaches — edited (with `was old-model` for a retarget),
 * same model, a divider, fallback. `M models · K routes affected` counts each
 * route once across groups; a staged unassign, provider and role chips are
 * outside K. Every other change keeps its `target · field` chip (ruling 7).
 * A chip or badge is not decoration — it is the only handle some changes
 * have (a staged provider-add has no applied row to sit on), so every one
 * opens and focuses the row or editor behind it.
 *
 * The bar renders no result state. Consent, drops, conflict, busy, and recovery
 * are their own panels above it, because each one replaces the whole question
 * the bar is asking rather than decorating it.
 */

import type { ApplySource, Change, ReachGroup } from '../../types/golemConfig';
import { changeStableID } from '../../types/golemConfig';
import { listUseCases } from '../../utils/listUseCases';
import { Was } from './Cell';
import styles from './GolemConfig.module.css';

/**
 * A chip asking a card to open and focus the editor behind one change identity.
 * The nonce makes every request distinct, so clicking the same chip twice
 * focuses twice.
 */
export interface EditorFocusRequest {
  changeId: string;
  nonce: number;
}

/**
 * `target · field`, the one chip grammar (ruling 7); the row's WAS lines carry
 * the values.
 *
 * [C23] A route change bundles model, think and exposure and the bar has no
 * applied document to diff against, so it names the row honestly; a provider
 * update names every field it carries.
 */
export function changeChipLabel(change: Change): string {
  switch (change.kind) {
    case 'route':
      return `${change.useCase} · route`;
    case 'route-unassign':
      return `${change.useCase} · unassigned`;
    case 'provider-add':
      return `${change.name} · new provider`;
    case 'provider-update': {
      const fields = [
        change.endpoint !== undefined ? 'endpoint' : '',
        change.apiFormat !== undefined ? 'type' : '',
      ].filter((field) => field !== '');
      return `${change.name} · ${fields.join(', ')}`;
    }
    case 'provider-remove':
      return `${change.name} · removed`;
    // [F7] Setting a key and clearing one are opposite intents; one label for both
    // left the chip unable to say which of them Apply would send.
    case 'provider-key-set':
      return `${change.name} · API key`;
    case 'provider-key-clear':
      return `${change.name} · API key cleared`;
    // [C6] `removed` alone read as a provider removal: a provider and a model role
    // may carry the same name, and the two chips sat side by side saying the same
    // thing about different things.
    case 'role-remove':
      return `${change.role} · model removed`;
  }
}

const sourceChipLabel = (source: ApplySource): string | null => {
  switch (source.kind) {
    case 'applied':
      return null;
    case 'blank':
      return 'source → blank configuration';
    case 'profile':
      return `source → ${source.profileId}`;
  }
};

/** `capabilities …` for the staged configuration, with its Think when set. */
const stagedConfiguration = (group: ReachGroup): string[] => [
  `capabilities ${group.staged.exposedCaps.join(', ')}`,
  group.staged.thinkMode === '' ? '' : `Think ${group.staged.thinkMode}`,
];

/**
 * What changes on the group's model, for its header. A selector nothing sat on
 * shows the configuration the new route sets (`routes X · capabilities … ·
 * Think …`) rather than a delta against nothing. An override that changes
 * nothing in the projection (Done on an untouched editor; a change to facts
 * this surface does not show) says what it re-asserts — derived from the
 * change, never a placeholder.
 */
function reachDeltaLine(group: ReachGroup): string {
  if (!group.selectorHadRoles)
    return [`routes ${listUseCases(group.joins)}`, ...stagedConfiguration(group)]
      .filter((part) => part !== '')
      .join(' · ');
  const signs = [
    group.addedCaps.length > 0 ? `+ ${group.addedCaps.join(', ')}` : '',
    group.removedCaps.length > 0 ? `− ${group.removedCaps.join(', ')}` : '',
  ].filter((sign) => sign !== '');
  const parts = [
    // The signs delimit themselves (`+ a, b − c`); `·` means "next part" only.
    signs.length > 0 ? `capabilities ${signs.join(' ')}` : '',
    group.think === null ? '' : group.think === '' ? 'Think cleared' : `Think ${group.think}`,
    group.joins.length > 0 ? `now also routes ${listUseCases(group.joins)}` : '',
    // A same-name change that is not an override differs in its facts: name them.
    group.factsChanged.length > 0 ? `declares ${group.factsChanged.join(' · ')}` : '',
  ].filter((part) => part !== '');
  if (parts.length > 0) return parts.join(' · ');
  const [caps, think] = stagedConfiguration(group);
  return `re-asserts ${caps}${think === '' ? '' : ` · ${think}`}`;
}

/** K: every route some group reaches, counted once. */
const routesAffected = (reach: readonly ReachGroup[]): number =>
  new Set(
    reach.flatMap((group) => [
      ...group.edited.map((edit) => edit.useCase),
      ...group.sameModel,
      ...group.fallback,
    ])
  ).size;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

export interface ApplyBarProps {
  /** The draft source, so a replacement gets the chip it is counted as. */
  source: ApplySource;
  /** The COALESCED changes — what Apply actually sends (§3.3). */
  changes: readonly Change[];
  /** [W6] One group per staged selector, first-staged order (`projectDraft`). */
  reach: readonly ReachGroup[];
  /** `changes.length` plus one when the source itself is a replacement. */
  count: number;
  /** Why Apply is unavailable, or null when it is available. */
  blocked: string | null;
  /**
   * True while a settings write or a pending consent challenge owns the
   * request: the chips and Apply are frozen, because the visible request is
   * what the challenge token is bound to (§3.3, §4.6a).
   */
  locked: boolean;
  /**
   * Discard's own lock, deliberately narrower than `locked`: §3.3 has Discard
   * invalidate a pending challenge, which makes it one of §4.6a's
   * cancel-then-transition paths rather than an edit of a frozen request.
   */
  discardLocked: boolean;
  onApply: () => void;
  onDiscard: () => void;
  /** Opens and focuses the editor behind a change chip. */
  onOpenChange: (changeId: string) => void;
  /** Opens the source summary behind the source chip. */
  onOpenSource: () => void;
}

export function ApplyBar({
  source,
  changes,
  reach,
  count,
  blocked,
  locked,
  discardLocked,
  onApply,
  onDiscard,
  onOpenChange,
  onOpenSource,
}: ApplyBarProps) {
  const sourceChip = sourceChipLabel(source);
  // Keyed by kind and use case: a use case is edited in at most one group
  // (`stageChange` replaces by stable id) and the three memberships are disjoint.
  const badge = (useCase: string, kind: 'edited' | 'same-model' | 'fallback', was?: string) => (
    <button
      key={`${kind}:${useCase}`}
      type="button"
      className={`${styles.chip} ${styles.badge}`}
      data-kind={kind}
      disabled={locked}
      onClick={() => onOpenChange(`route:${useCase}`)}
    >
      {useCase}
      {was !== undefined && <Was value={was} />}
      <span className={styles.srOnly}>{kind === 'same-model' ? 'same model' : kind}</span>
    </button>
  );

  return (
    <div className={styles.draftBar} data-testid="golem-config-draft">
      <span className={styles.draftCount}>{plural(count, 'staged change')}</span>
      {reach.length > 0 && (
        <span className={styles.reachCount}>
          {`${plural(reach.length, 'model')} · ${plural(routesAffected(reach), 'route')} affected`}
        </span>
      )}
      <span className={styles.chips}>
        {sourceChip !== null && (
          <button type="button" className={styles.chip} disabled={locked} onClick={onOpenSource}>
            {sourceChip}
          </button>
        )}
        {reach.map((group) => (
          <span
            key={group.key}
            className={styles.reachGroup}
            data-testid={`reach-group-${group.provider}/${group.model}`}
          >
            <button
              type="button"
              className={styles.reachHeader}
              disabled={locked}
              onClick={() => onOpenChange(group.changeId)}
            >
              <b>{group.model}</b>
              <small>{group.provider}</small>
              <span className={styles.reachDelta}>{reachDeltaLine(group)}</span>
            </button>
            <span className={styles.badges}>
              {group.edited.map((edit) =>
                badge(
                  edit.useCase,
                  'edited',
                  // A provider-only move would otherwise print a WAS equal to the header.
                  edit.was === null
                    ? undefined
                    : edit.was.provider === group.provider
                      ? edit.was.model
                      : `${edit.was.provider} · ${edit.was.model}`
                )
              )}
              {group.sameModel.map((useCase) => badge(useCase, 'same-model'))}
              {group.fallback.length > 0 && (
                <span
                  className={styles.reachDivider}
                  data-testid="reach-divider"
                  aria-hidden="true"
                />
              )}
              {group.fallback.map((useCase) => badge(useCase, 'fallback'))}
            </span>
          </span>
        ))}
        {changes.map((change) => {
          if (change.kind === 'route') return null; // rendered in its group above
          const id = changeStableID(change);
          return (
            <button
              key={id}
              type="button"
              className={styles.chip}
              disabled={locked}
              onClick={() => onOpenChange(id)}
            >
              {changeChipLabel(change)}
            </button>
          );
        })}
      </span>
      <span className={styles.grow} />
      <button
        type="button"
        className={`${styles.button} ${styles.quiet}`}
        disabled={discardLocked}
        onClick={onDiscard}
      >
        Discard
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.primary}`}
        disabled={locked || blocked !== null}
        onClick={onApply}
      >
        Apply
      </button>
      {blocked !== null && <p className={styles.draftBlocked}>{blocked}</p>}
    </div>
  );
}

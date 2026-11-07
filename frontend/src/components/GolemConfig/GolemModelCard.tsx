/**
 * The Golem model row (#490, design 5.1 and 5.10).
 *
 * Golem Configuration opens on this card: the model Golem chat and commit
 * messages run on, where it runs, and Change. Change is a disclosure over the
 * picker — the agent route editor in its Golem reading (`RouteEditor`'s
 * `golem`) — which stages through the same candidate and `onStage` as the
 * route editor. Use model hands the staged change to the workspace's Apply;
 * nothing here writes.
 *
 * The row names no role and no CLI: Firn cannot know which file a golem CLI
 * loads, and roles are managed under Shared configuration.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ModelProjection, ProviderProjection, RouteProjection } from '../../types/golem';
import { changeStableID, type Change, type Draft } from '../../types/golemConfig';
import { Staged, Was } from './Cell';
import { CLASSIFICATION_LABEL, GOLEM_USE_CASE } from './golemModel';
import styles from './GolemConfig.module.css';
import { RouteEditor } from './RouteEditor';

export const GOLEM_CHANGE_ID = 'golem-model-change';
export const GOLEM_PICKER_ID = 'golem-model-picker';
const LOCK_ID = 'golem-model-locked';
const EDITOR_ID = 'golem-model-editor';
/** The picker's Apply gate key; never a route row's (`routeRowKey`). */
export const GOLEM_ROW_KEY = '\u0000golem-model';

export interface GolemModelCardProps {
  routes: readonly RouteProjection[];
  models: readonly ModelProjection[];
  providers: readonly ProviderProjection[];
  draft: Draft;
  /** The draft's changes as projected, as the routing card reads them. */
  changes: readonly Change[];
  /** False while the surface is locked or the document cannot be written. */
  editable: boolean;
  /** Why Change is unavailable, as visible text; '' while it is available. */
  lockReason: string;
  /** Whether the picker is open. The workspace owns it: it outlives a remount. */
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** True when nothing else is staged on the page: the action reads Use model. */
  applies: boolean;
  /** True while a Use model write is pending or in flight: the picker shows its outcome. */
  applying: boolean;
  /** The write's outcome when Use model started it: a refusal or challenge shows here. */
  outcome?: ReactNode;
  onStage: (changes: Change[], drop: string[], keep?: Change[]) => void;
  onUnstagedChange: (rowKey: string, unstaged: boolean) => void;
  /** Apply the change Use model just staged. */
  onUse: () => void;
  /** A name the picker does not list: open the agent route editor on it. */
  onNotListed: (name: string) => void;
}

export function GolemModelCard({
  routes,
  models,
  providers,
  draft,
  changes,
  editable,
  lockReason,
  open,
  onToggle,
  onClose,
  applies,
  applying,
  outcome,
  onStage,
  onUnstagedChange,
  onUse,
  onNotListed,
}: GolemModelCardProps) {
  /**
   * The picker mounts on first open and stays mounted while folded, so an
   * edit made inside survives closing it (5.10). Cancel and Done unmount it.
   */
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const [announcement, setAnnouncement] = useState('');
  /** Bumped to hand focus back to Change once the commit that closes the picker lands. */
  const [focusNonce, setFocusNonce] = useState(0);
  useEffect(() => {
    if (focusNonce > 0) document.getElementById(GOLEM_CHANGE_ID)?.focus();
  }, [focusNonce]);

  const role = routes.find((route) => route.useCase === GOLEM_USE_CASE)?.role ?? null;
  const applied = role === null ? null : (models.find((model) => model.role === role) ?? null);
  const staged = changes.find((change) => changeStableID(change) === `route:${GOLEM_USE_CASE}`);
  const stagedModel = staged?.kind === 'route' ? staged.modelFacts : null;
  /** The agent route's raw staged change, as one string: the editor's identity. */
  const stagedKey = JSON.stringify(
    draft.changes.find((change) => changeStableID(change) === `route:${GOLEM_USE_CASE}`) ?? null
  );
  const shown =
    stagedModel ??
    (applied === null
      ? null
      : {
          provider: applied.provider,
          model: applied.modelName,
        });
  const classification =
    shown === null
      ? undefined
      : providers.find((provider) => provider.name === shown.provider)?.classification;
  const movesModel =
    stagedModel !== null &&
    (applied === null ||
      stagedModel.provider !== applied.provider ||
      stagedModel.model !== applied.modelName);
  // One object per document, as the routing card keeps it: the editor caches
  // its per-card verdicts on it.
  const base = useMemo(() => ({ routes: [...routes], models: [...models] }), [routes, models]);

  const unavailable = !editable && lockReason !== '';

  return (
    <section className={`${styles.card} ${styles.golemCard}`} aria-labelledby="golem-model-title">
      <div className={styles.golemRow}>
        <h3 id="golem-model-title" className={styles.cardTitle}>
          Golem model
        </h3>
        <span className={styles.golemModel} data-testid="golem-model-current">
          {shown === null ? (
            'No model yet'
          ) : (
            <>
              {movesModel ? <Staged value={shown.model} /> : <strong>{shown.model}</strong>}
              {` via ${shown.provider}`}
            </>
          )}
        </span>
        {/* The chat panel's own badge: where a prompt to this model goes. */}
        {classification !== undefined && (
          <span className={styles.golemBadge} data-classification={classification}>
            {CLASSIFICATION_LABEL[classification]}
          </span>
        )}
        {movesModel && applied !== null && <Was value={applied.modelName} />}
        <span className={styles.grow} />
        {/* A disclosure: its state, the fold it controls, focus kept on it. It
            stays focusable while unavailable so the reason is read with it. */}
        <button
          type="button"
          id={GOLEM_CHANGE_ID}
          className={`${styles.button} ${styles.small}`}
          aria-expanded={open && !unavailable}
          aria-controls={GOLEM_PICKER_ID}
          aria-disabled={unavailable || undefined}
          aria-describedby={unavailable ? LOCK_ID : undefined}
          onClick={() => {
            if (!unavailable) onToggle();
          }}
        >
          Change
          <span className={styles.srOnly}> Golem model</span>
        </button>
      </div>
      <p className={styles.golemLine}>Runs Golem chat and commit messages.</p>
      {unavailable && (
        <p id={LOCK_ID} className={styles.fieldHint}>
          {lockReason}
        </p>
      )}

      <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      <div id={GOLEM_PICKER_ID} className={styles.golemPicker} hidden={!open || unavailable}>
        {outcome}
        {mounted && editable && !applying && (
          <RouteEditor
            // Re-seeded whenever the agent route's staged change moves under
            // it (Shared configuration stages the same route), so the picker
            // never compares against, or re-sends, a row that is gone.
            key={stagedKey}
            id={EDITOR_ID}
            useCase={GOLEM_USE_CASE}
            role={role}
            current={applied}
            providers={providers}
            models={models}
            base={base}
            draft={draft}
            staged={staged}
            rowKey={GOLEM_ROW_KEY}
            golem={{ applies, onNotListed }}
            onStage={onStage}
            onUnstagedChange={onUnstagedChange}
            onClose={() => {
              setMounted(false);
              onClose();
              setFocusNonce((nonce) => nonce + 1);
            }}
            onStaged={(message) => {
              setMounted(false);
              setAnnouncement(message);
              setFocusNonce((nonce) => nonce + 1);
              // Use model applies at once; Done leaves it beside the rest.
              if (applies) onUse();
              else onClose();
            }}
          />
        )}
      </div>
    </section>
  );
}

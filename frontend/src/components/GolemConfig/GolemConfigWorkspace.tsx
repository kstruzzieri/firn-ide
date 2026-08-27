/**
 * Golem configuration workspace — the app-global `tab-golem-config` surface
 * (#263 Slice B, spec §3.1/§4).
 *
 * Task 7 paints it read-only from the existing Slice A projection: the same
 * reload generation guard, state vocabulary, busy notice, bounded errors, and
 * retry the dock readout uses, over the v10 card/strip grammar. The draft, the
 * row editors, and the Apply bar arrive in the following tasks; when they do,
 * the draft and any pending API-key value live in refs on THIS component, never
 * in a store (spec §3.2).
 *
 * There is one instance per app, so nothing here is workspace-scoped: Firn's
 * settings calls read one process-wide snapshot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReloadGolemSettings } from '../../../wailsjs/go/main/App';
import {
  boundedGolemMessage,
  parseSettingsReloadResult,
  type SettingsDiagnostic,
  type SettingsProjection,
} from '../../types/golem';
import {
  KeyVault,
  cleanDraft,
  draftChangeCount,
  isDraftDirty,
  projectDraft,
  setTargetRevision,
  settleDraft,
  stageChange,
  unstageChange,
  type Change,
} from '../../types/golemConfig';
import { formatSettingsDiagnostic } from '../../utils/settingsDiagnostics';
import styles from './GolemConfig.module.css';
import { ProvidersCard } from './ProvidersCard';
import { RoutingCard, routingOwnsDiagnostic } from './RoutingCard';
import { StatusText, type StatusTone } from './StatusText';

const STATE_LABEL: Record<SettingsProjection['state'], string> = {
  ready: 'Ready',
  limited: 'Limited',
  invalid: 'Invalid',
  missing: 'Missing',
};

const STATE_TONE: Record<SettingsProjection['state'], StatusTone> = {
  ready: 'ok',
  limited: 'warn',
  invalid: 'bad',
  missing: 'dim',
};

const ORIGIN_LABEL: Record<SettingsProjection['sourceOrigin'], string> = {
  none: 'No configuration found',
  env: 'Environment override',
  working_directory: 'Working directory models.json',
  user_config: 'User configuration directory',
  legacy: 'Legacy configuration directory',
};

/**
 * Why editing is off (spec §4.6). `limited` covers both write-blocked reasons —
 * a read-only document and an unsafe mutation identity — because the backend
 * collapses `readOnly || !editable` onto that state and emits the naming
 * diagnostic beside it. `missing` is not a block: it is the bootstrap path.
 */
const EDITING_UNAVAILABLE: Partial<Record<SettingsProjection['state'], string>> = {
  limited:
    'Editing is unavailable while this configuration is Limited. The notices below name the reason; repair it in the file, then Refresh.',
  invalid:
    'Editing is unavailable: this configuration could not be loaded, so there is nothing safe to change. Repair it in the file, then Refresh.',
};

/** The CAS token is 64 hex characters; the head identifies a revision at a
 * glance and the full value stays available on hover. */
const REVISION_HEAD = 12;

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; projection: SettingsProjection; busyNotice: boolean }
  | { kind: 'error'; message: string };

export function GolemConfigWorkspace({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [inFlight, setInFlight] = useState(false);
  const generation = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The draft and the pending key VALUES live here and nowhere else (§3.2):
  // the values in a plain ref, reachable only through the KeyVault facade, so
  // they never enter React state, a store, or anything serializable.
  const keyRefs = useRef(new Map<string, string>());
  const vault = useMemo(() => new KeyVault(keyRefs.current), []);
  const [draft, setDraft] = useState(cleanDraft);
  /** Editors holding fields the user has not staged (§4.2: Apply is blocked). */
  const [unstagedEditors, setUnstagedEditors] = useState<ReadonlySet<string>>(new Set());
  /** Bumped by every draft reset, to remount the cards and their editors. */
  const [draftEpoch, setDraftEpoch] = useState(0);

  const load = useCallback(async (explicit: boolean) => {
    const gen = ++generation.current;
    setInFlight(true);
    try {
      const result = parseSettingsReloadResult(await ReloadGolemSettings());
      if (gen !== generation.current) return; // superseded or unmounted
      setPhase({
        kind: 'ready',
        projection: result.projection,
        // A busy reload on open silently shows the effective snapshot; only the
        // explicit Refresh action surfaces the notice.
        busyNotice: explicit && result.busy,
      });
      // The draft targets whichever revision the document is on now; a dirty
      // reload prompt and conflict review are Task 10's.
      setDraft((current) => setTargetRevision(current, result.projection.revision));
    } catch (err) {
      if (gen !== generation.current) return;
      setPhase({ kind: 'error', message: boundedGolemMessage(err) });
    } finally {
      if (gen === generation.current) setInFlight(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    return () => {
      generation.current += 1; // invalidate any pending response on unmount
    };
  }, [load]);

  // The tab mounts when it is opened and focused, so this lands the caret on the
  // surface the user just asked for rather than leaving it on the palette.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Teardown is terminal for keys (§3.2). It goes through the same reducer
  // table as every other outcome, so "were the values dropped?" has one answer.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(
    () => () => {
      settleDraft(draftRef.current, { kind: 'teardown' }, vault);
    },
    [vault]
  );

  const stage = useCallback(
    (changes: Change[], drop: string[]) => {
      setDraft((current) => {
        const cleared = drop.reduce((next, id) => unstageChange(next, id, vault), current);
        return changes.reduce((next, change) => stageChange(next, change, vault), cleared);
      });
    },
    [vault]
  );

  const noteUnstaged = useCallback((rowKey: string, unstaged: boolean) => {
    setUnstagedEditors((current) => {
      if (current.has(rowKey) === unstaged) return current; // no render, no churn
      const next = new Set(current);
      if (unstaged) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }, []);

  const discard = useCallback(() => {
    setDraft((current) => settleDraft(current, { kind: 'discard' }, vault));
    // §3.3: Discard also resets the editors. Remounting the card is the whole
    // reset — open rows collapse and no editor keeps fields it staged against
    // a draft that no longer exists.
    setDraftEpoch((current) => current + 1);
  }, [vault]);

  const projection = phase.kind === 'ready' ? phase.projection : null;
  const projected = useMemo(
    () => projectDraft(projection ?? { routes: [], models: [] }, draft),
    [projection, draft]
  );

  // A diagnostic about a provider or a use case that has a row belongs inside
  // that row (§4.3b, §4.3); one naming an entity this projection does not show
  // stays here, where it is still readable.
  const providerRows = new Set(projection?.providers.map((entry) => entry.name) ?? []);
  const ownedByRow = (diagnostic: SettingsDiagnostic): boolean =>
    (diagnostic.subjectKind === 'provider' && providerRows.has(diagnostic.subjectName)) ||
    routingOwnsDiagnostic(projection?.routes ?? [], diagnostic);
  const pageDiagnostics = projection?.diagnostics.filter((entry) => !ownedByRow(entry)) ?? [];

  const changeCount = draftChangeCount(draft);
  // Editing needs a document that is both loaded and writable; Limited and
  // Invalid say so in their own notice above (§4.6).
  const canEdit = projection?.state === 'ready' && projection.editable && !projection.readOnly;
  // A provider a defined model still references cannot be removed.
  const usedProviders = projection?.models.map((entry) => entry.provider) ?? [];

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <header className={styles.masthead} data-testid="golem-config-masthead">
          <h2 ref={headingRef} tabIndex={-1} className={styles.title}>
            Golem Configuration
          </h2>
          {projection && (
            <>
              <StatusText tone={STATE_TONE[projection.state]}>
                {STATE_LABEL[projection.state]}
              </StatusText>
              <span className={styles.source}>{ORIGIN_LABEL[projection.sourceOrigin]}</span>
              {projection.revision !== undefined && (
                <span className={styles.revision} title={projection.revision}>
                  rev {projection.revision.slice(0, REVISION_HEAD)}
                </span>
              )}
            </>
          )}
          <span className={styles.grow} />
          <button
            type="button"
            className={styles.button}
            disabled={inFlight}
            onClick={() => void load(true)}
          >
            Refresh
          </button>
          <button type="button" className={`${styles.button} ${styles.quiet}`} onClick={onClose}>
            Close
          </button>
        </header>

        <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
          {projection
            ? `Configuration ${STATE_LABEL[projection.state]}. Source ${ORIGIN_LABEL[projection.sourceOrigin]}.`
            : ''}
        </div>

        {phase.kind === 'loading' && <p className={styles.loading}>Loading configuration…</p>}

        {phase.kind === 'error' && (
          <div className={styles.error} role="alert">
            <p className={styles.errorText}>{phase.message}</p>
            <button
              type="button"
              className={styles.button}
              disabled={inFlight}
              onClick={() => void load(true)}
            >
              Retry
            </button>
          </div>
        )}

        {projection && (
          <div className={styles.body}>
            {phase.kind === 'ready' && phase.busyNotice && (
              <p className={styles.notice} role="status">
                Golem is busy — a run or pending consent prompt is active. Showing the configuration
                currently in effect; refresh when idle.
              </p>
            )}

            {EDITING_UNAVAILABLE[projection.state] !== undefined && (
              <p className={styles.notice}>{EDITING_UNAVAILABLE[projection.state]}</p>
            )}

            {pageDiagnostics.length > 0 && (
              <ul className={styles.diagnostics} aria-label="Configuration diagnostics">
                {pageDiagnostics.map((diagnostic, index) => {
                  const { text, subject } = formatSettingsDiagnostic(
                    diagnostic.code,
                    diagnostic.subjectKind,
                    diagnostic.subjectName
                  );
                  return (
                    <li
                      key={`${diagnostic.code}-${diagnostic.subjectKind}-${diagnostic.subjectName}-${index}`}
                      className={styles.diagnostic}
                      data-blocking={diagnostic.blocking || undefined}
                    >
                      <span className={styles.severity}>
                        {diagnostic.blocking ? 'Blocking' : 'Notice'}
                      </span>
                      <span className={styles.diagnosticText}>
                        {text}
                        {subject !== '' && (
                          <>
                            {' — '}
                            <span className={styles.subject}>{subject}</span>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <ProvidersCard
              // Remount on every draft reset AND on every document the open
              // editors could be diffing against: an editor derives its fields
              // once, at mount, but stages against the live projection, so a
              // Refresh that moved the revision would otherwise let a stale
              // endpoint be re-staged as if the user had authored it.
              key={`providers-${draftEpoch}:${projection.revision ?? ''}`}
              providers={projection.providers}
              usedProviders={usedProviders}
              changes={draft.changes}
              rows={projected.providerRows}
              diagnostics={projection.diagnostics}
              vault={vault}
              editable={canEdit}
              onStage={stage}
              onUnstagedChange={noteUnstaged}
            />
            <RoutingCard
              // Same remount rule as the providers card: an open route editor
              // derives its fields at mount but stages against the live
              // projection, so a Refresh that moved the revision must not let a
              // stale model read back as the user's choice.
              key={`routing-${draftEpoch}:${projection.revision ?? ''}`}
              routes={projection.routes}
              models={projection.models}
              providers={projection.providers}
              draft={draft}
              // The COALESCED changes, never `draft.changes`: a row and a
              // reopened editor must show the selector-wide truth Apply sends
              // (§3.3), which is rebuilt from each group's last authority.
              changes={projected.changes}
              rows={projected.routeRows}
              roleRows={projected.roleRows}
              diagnostics={projection.diagnostics}
              editable={canEdit}
              onStage={stage}
              onUnstagedChange={noteUnstaged}
            />

            {isDraftDirty(draft) && (
              <div className={styles.draftBar} data-testid="golem-config-draft">
                <span className={styles.draftCount}>
                  {`${changeCount} change${changeCount === 1 ? '' : 's'} waiting for Apply`}
                </span>
                <span className={styles.grow} />
                <button
                  type="button"
                  className={`${styles.button} ${styles.quiet}`}
                  onClick={discard}
                >
                  Discard
                </button>
                {/* Task 10 turns this bar into the full Apply surface (chips,
                    Apply, in-flight locking). The gate itself is stated now
                    because it is what an open editor is holding open (§4.2). */}
                {unstagedEditors.size > 0 && (
                  <p className={styles.draftBlocked}>
                    Apply is unavailable while an editor has unstaged changes. Stage or cancel them
                    first.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

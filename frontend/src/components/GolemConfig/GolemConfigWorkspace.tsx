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

import { useCallback, useEffect, useRef, useState } from 'react';
import { ReloadGolemSettings } from '../../../wailsjs/go/main/App';
import {
  boundedGolemMessage,
  parseSettingsReloadResult,
  type SettingsProjection,
} from '../../types/golem';
import { formatSettingsDiagnostic } from '../../utils/settingsDiagnostics';
import styles from './GolemConfig.module.css';
import { ProvidersCard } from './ProvidersCard';
import { RoutingCard } from './RoutingCard';
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

  const projection = phase.kind === 'ready' ? phase.projection : null;

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

            {projection.diagnostics.length > 0 && (
              <ul className={styles.diagnostics} aria-label="Configuration diagnostics">
                {projection.diagnostics.map((diagnostic, index) => {
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

            <ProvidersCard providers={projection.providers} />
            <RoutingCard routes={projection.routes} models={projection.models} />
          </div>
        )}
      </div>
    </div>
  );
}

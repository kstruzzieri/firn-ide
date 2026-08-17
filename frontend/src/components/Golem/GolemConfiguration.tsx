/**
 * Task 9 (#263 Phase 1) — read-only Golem configuration view.
 *
 * Component-local state only: no Zustand. Phase 3 adds a write-only key
 * field that must never reach a store, so this view is deliberately kept
 * outside the golemStore from the start.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ReloadGolemSettings } from '../../../wailsjs/go/main/App';
import {
  boundedGolemMessage,
  parseSettingsReloadResult,
  type SettingsDiagnosticCode,
  type SettingsProjection,
} from '../../types/golem';
import styles from './GolemConfiguration.module.css';

/** Total map over the closed Phase 1 code set; the validator guarantees
 * membership, so no fallback branch exists to rot. */
const DIAGNOSTIC_TEXT: Record<SettingsDiagnosticCode, string> = {
  config_missing: 'No models.json was found at any discovery location.',
  json_invalid: 'The configuration file is not valid JSON.',
  config_invalid: 'The configuration was rejected while loading.',
  agent_role_missing: 'No usable agent role is configured.',
  agent_capabilities_insufficient: 'The agent model must support chat, stream, and tool_call.',
  provider_endpoint_unsupported: 'This provider endpoint is not a usable URL.',
  projection_limited: 'Configuration is too large to display in full.',
};

const ORIGIN_LABEL: Record<SettingsProjection['sourceOrigin'], string> = {
  none: 'No configuration found',
  env: 'Environment override',
  working_directory: 'Working directory models.json',
  user_config: 'User configuration directory',
  legacy: 'Legacy configuration directory',
};

const CLASSIFICATION_LABEL = { local: 'Local', remote: 'Remote', unknown: 'Unknown' } as const;
const CREDENTIAL_LABEL = {
  none: 'No key',
  available: 'Key present',
  reference_unavailable: 'Key reference unavailable',
} as const;

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; projection: SettingsProjection; busyNotice: boolean }
  | { kind: 'error'; message: string };

export function GolemConfiguration({ onClose }: { onClose: () => void }) {
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
        // A busy reload on mount silently shows the effective snapshot; only
        // the explicit Refresh action surfaces the notice.
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

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.heading}>
          Configuration
        </h2>
        <div className={styles.headerActions}>
          <button type="button" disabled={inFlight} onClick={() => void load(true)}>
            Refresh
          </button>
          <button type="button" onClick={onClose}>
            Back to chat
          </button>
        </div>
      </div>

      {phase.kind === 'loading' && <p className={styles.muted}>Loading…</p>}

      {phase.kind === 'error' && (
        <div className={styles.errorBox} role="alert">
          <p>{phase.message}</p>
          <button type="button" disabled={inFlight} onClick={() => void load(true)}>
            Retry
          </button>
        </div>
      )}

      {phase.kind === 'ready' && (
        <ConfigurationBody projection={phase.projection} busyNotice={phase.busyNotice} />
      )}
    </div>
  );
}

function ConfigurationBody({
  projection,
  busyNotice,
}: {
  projection: SettingsProjection;
  busyNotice: boolean;
}) {
  return (
    <div className={styles.body}>
      {busyNotice && (
        <p className={styles.busyNotice} role="status">
          Golem is busy; showing the configuration currently in effect. Refresh when idle.
        </p>
      )}

      <p className={styles.sourceLine}>
        Source: <span className={styles.sourceOrigin}>{ORIGIN_LABEL[projection.sourceOrigin]}</span>
      </p>

      {projection.diagnostics.length > 0 && (
        <section aria-label="Configuration diagnostics">
          <h3 className={styles.sectionHeading}>Diagnostics</h3>
          <ul className={styles.diagnosticList}>
            {projection.diagnostics.map((d, i) => (
              <li
                key={`${d.code}-${d.subjectName}-${i}`}
                className={d.blocking ? styles.diagnosticBlocking : styles.diagnostic}
              >
                <span className={styles.diagnosticSeverity}>
                  {d.blocking ? 'Blocking' : 'Notice'}
                </span>{' '}
                {DIAGNOSTIC_TEXT[d.code]}
                {d.subjectName !== '' && <span className={styles.subject}> — {d.subjectName}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {projection.routes.length > 0 && (
        <section aria-label="Role routing">
          <h3 className={styles.sectionHeading}>Roles</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Use case</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {projection.routes.map((r) => (
                <tr key={r.useCase}>
                  <td>{r.useCase}</td>
                  <td>{r.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {projection.models.length > 0 && (
        <section aria-label="Models">
          <h3 className={styles.sectionHeading}>Models</h3>
          <ul className={styles.entityList}>
            {projection.models.map((m) => (
              <li key={m.role} className={styles.entityRow}>
                <span className={styles.entityName}>{m.role}</span>
                <span className={styles.entityDetail}>{m.modelName}</span>
                <span className={styles.entityDetail}>{m.provider}</span>
                {m.effectiveCapabilities.map((c) => (
                  <span key={c} className={styles.capabilityChip}>
                    {c}
                  </span>
                ))}
                {m.thinkMode !== '' && (
                  <span className={styles.entityDetail}>think: {m.thinkMode}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {projection.providers.length > 0 && (
        <section aria-label="Providers">
          <h3 className={styles.sectionHeading}>Providers</h3>
          <ul className={styles.entityList}>
            {projection.providers.map((p) => (
              <li key={p.name} className={styles.entityRow}>
                <span className={styles.entityName}>{p.name}</span>
                {p.endpoint !== '' && <span className={styles.endpoint}>{p.endpoint}</span>}
                <span className={styles.entityDetail}>
                  {CLASSIFICATION_LABEL[p.classification]}
                </span>
                <span className={styles.entityDetail}>{p.apiFormat}</span>
                <span className={styles.entityDetail}>{CREDENTIAL_LABEL[p.credentialState]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

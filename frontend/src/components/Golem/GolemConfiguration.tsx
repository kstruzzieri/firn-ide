/**
 * Task 9 (#263 Phase 1) — read-only Golem configuration view.
 *
 * Component-local state only: no Zustand. Phase 3 adds a write-only key
 * field that must never reach a store, so this view is deliberately kept
 * outside the golemStore from the start.
 *
 * Visual language: an instrument readout extending the panel's mission-control
 * idiom. Entities keep one hue across sections — roles teal, model names
 * primary mono, providers purple — so the routing chain use case → role →
 * model → provider can be traced by colour between sections.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ReloadGolemSettings } from '../../../wailsjs/go/main/App';
import golemIcon from '../../assets/branding/golem-icon.svg';
import {
  boundedGolemMessage,
  parseSettingsReloadResult,
  type SettingsDiagnosticCode,
  type SettingsProjection,
} from '../../types/golem';
import styles from './GolemConfiguration.module.css';

/** Total map over the closed Slice A code set; the validator guarantees
 * membership, so no fallback branch exists to rot. */
const DIAGNOSTIC_TEXT: Record<SettingsDiagnosticCode, string> = {
  config_missing: 'No models.json was found at any discovery location.',
  json_invalid: 'The configuration file is not valid JSON.',
  config_invalid: 'The configuration was rejected while loading.',
  agent_role_missing: 'No usable agent role is configured.',
  agent_capabilities_insufficient: 'The agent model must support chat, stream, and tool_call.',
  provider_endpoint_unsupported: 'This provider endpoint is not a usable URL.',
  projection_limited: 'Configuration is too large to display in full.',
  duplicate_keys: 'Duplicate JSON keys make this configuration read-only.',
  provider_required: 'At least one provider is required.',
  provider_name_invalid: 'A provider name is invalid.',
  provider_endpoint_invalid: 'A provider endpoint is invalid.',
  provider_format_invalid: 'A provider API format is invalid.',
  slot_policy_invalid: 'A provider slot policy is invalid.',
  model_invalid: 'A model entry is invalid.',
  think_invalid: 'A thinking configuration is invalid.',
  provider_not_found: 'A model references a provider that does not exist.',
  defaults_invalid: 'A default route is invalid.',
  key_reference_malformed: 'An API-key environment reference is malformed.',
  key_reference_unavailable: 'An API-key environment variable is unavailable.',
  selector_conflict: 'Models sharing a provider/model selector disagree.',
  identifier_not_editable:
    'An identifier is empty or contains unsafe control characters; edit the file externally.',
};

const ORIGIN_LABEL: Record<SettingsProjection['sourceOrigin'], string> = {
  none: 'No configuration found',
  env: 'Environment override',
  working_directory: 'Working directory models.json',
  user_config: 'User configuration directory',
  legacy: 'Legacy configuration directory',
};

const STATE_LABEL: Record<SettingsProjection['state'], string> = {
  ready: 'Ready',
  limited: 'Limited',
  invalid: 'Invalid',
  missing: 'Missing',
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
      <header className={styles.masthead}>
        <div className={styles.headerRow}>
          <h2 ref={headingRef} tabIndex={-1} className={styles.heading}>
            Configuration
          </h2>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.headerButton}
              disabled={inFlight}
              onClick={() => void load(true)}
            >
              Refresh
            </button>
            <button type="button" className={styles.headerButton} onClick={onClose}>
              Back to chat
            </button>
          </div>
        </div>
        {phase.kind === 'ready' && (
          <div className={styles.stateRow}>
            <span className={styles.statePill} data-state={phase.projection.state}>
              <span className={styles.stateDot} aria-hidden="true" />
              {STATE_LABEL[phase.projection.state]}
            </span>
            <span className={styles.sourceChip}>
              <span className={styles.sourceKey}>Source</span>
              {ORIGIN_LABEL[phase.projection.sourceOrigin]}
            </span>
          </div>
        )}
      </header>

      {phase.kind === 'loading' && (
        <p className={styles.loading}>
          <span className={styles.loadingDot} aria-hidden="true" />
          Loading configuration…
        </p>
      )}

      {phase.kind === 'error' && (
        <div className={styles.errorBox} role="alert">
          <p className={styles.errorText}>{phase.message}</p>
          <button
            type="button"
            className={styles.headerButton}
            disabled={inFlight}
            onClick={() => void load(true)}
          >
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
  const empty =
    projection.routes.length === 0 &&
    projection.models.length === 0 &&
    projection.providers.length === 0;

  return (
    <div className={styles.body}>
      {busyNotice && (
        <p className={styles.busyNotice} role="status">
          Golem is busy — a run or pending consent prompt is active. Showing the configuration
          currently in effect; refresh when idle.
        </p>
      )}

      {projection.diagnostics.length > 0 && (
        <section aria-label="Configuration diagnostics">
          <h3 className={styles.sectionHeading}>Diagnostics</h3>
          <ul className={styles.diagnosticList}>
            {projection.diagnostics.map((d, i) => (
              <li
                key={`${d.code}-${d.subjectName}-${i}`}
                className={styles.diagnosticRow}
                data-blocking={d.blocking || undefined}
              >
                <span className={styles.diagnosticSeverity}>
                  {d.blocking ? 'Blocking' : 'Notice'}
                </span>
                <span className={styles.diagnosticText}>
                  {DIAGNOSTIC_TEXT[d.code]}
                  {d.subjectName !== '' && (
                    <span className={styles.subject}> — {d.subjectName}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {empty && (
        <div className={styles.emptyState}>
          <img className={styles.emptyIcon} src={golemIcon} alt="" aria-hidden="true" />
          <p className={styles.emptyText}>No resolved configuration to display.</p>
        </div>
      )}

      {projection.routes.length > 0 && (
        <section aria-label="Role routing">
          <h3 className={styles.sectionHeading}>Roles</h3>
          <ul className={styles.routeList}>
            {projection.routes.map((r) => (
              <li key={r.useCase} className={styles.routeRow}>
                <span className={styles.routeUseCase}>{r.useCase}</span>
                <span className={styles.srOnly}>routes to role</span>
                <span className={styles.routeArrow} aria-hidden="true">
                  →
                </span>
                <span className={styles.roleChip}>{r.role}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {projection.models.length > 0 && (
        <section aria-label="Models">
          <h3 className={styles.sectionHeading}>Models</h3>
          <ul className={styles.cardList}>
            {projection.models.map((m) => (
              <li key={m.role} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.roleChip}>{m.role}</span>
                  <span className={styles.modelName}>{m.modelName}</span>
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.providerName}>{m.provider}</span>
                  <span className={styles.metaChip}>{m.type}</span>
                  {m.thinkMode !== '' && (
                    <span className={styles.metaChip}>think: {m.thinkMode}</span>
                  )}
                </div>
                {m.effectiveCapabilities.length > 0 && (
                  <div className={styles.capabilityRow}>
                    {m.effectiveCapabilities.map((c) => (
                      <span key={c} className={styles.capabilityChip}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {projection.providers.length > 0 && (
        <section aria-label="Providers">
          <h3 className={styles.sectionHeading}>Providers</h3>
          <ul className={styles.cardList}>
            {projection.providers.map((p) => (
              <li key={p.name} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.providerName}>{p.name}</span>
                  <span className={styles.badge} data-classification={p.classification}>
                    {CLASSIFICATION_LABEL[p.classification]}
                  </span>
                </div>
                {p.endpoint !== '' && <div className={styles.endpoint}>{p.endpoint}</div>}
                <div className={styles.cardMeta}>
                  <span className={styles.metaChip}>{p.apiFormat}</span>
                  <span className={styles.credential} data-credential={p.credentialState}>
                    <span className={styles.credentialDot} aria-hidden="true" />
                    {CREDENTIAL_LABEL[p.credentialState]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

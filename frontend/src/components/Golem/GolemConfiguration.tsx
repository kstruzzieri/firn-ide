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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ReloadGolemSettings } from '../../../wailsjs/go/main/App';
import golemIcon from '../../assets/branding/golem-icon.svg';
import {
  boundedGolemMessage,
  parseSettingsReloadResult,
  type ModelProjection,
  type ProviderProjection,
  type SettingsProjection,
} from '../../types/golem';
import { focusConfigTab } from '../../utils/editorSurface';
import { orderModelsForDisplay } from '../../utils/golemModelOrder';
import { formatSettingsDiagnostic } from '../../utils/settingsDiagnostics';
import styles from './GolemConfiguration.module.css';

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
            {/* The dock's one new affordance (spec §3.1): the editing surface is
                the app-global workspace tab; this readout stays read-only. */}
            <button type="button" className={styles.headerButton} onClick={focusConfigTab}>
              Open configuration
            </button>
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

      <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {phase.kind === 'ready'
          ? `Configuration ${STATE_LABEL[phase.projection.state]}. Source ${ORIGIN_LABEL[phase.projection.sourceOrigin]}.`
          : ''}
      </div>

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

  // A route names a role; the model is what the reader actually wants. A role
  // with no model stays absent rather than rendering a placeholder — that is a
  // broken route, and the Models section is where it is diagnosed.
  const modelForRole = new Map(projection.models.map((m) => [m.role, m.modelName]));

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
            {projection.diagnostics.map((d, i) => {
              const { text, subject } = formatSettingsDiagnostic(
                d.code,
                d.subjectKind,
                d.subjectName
              );
              return (
                <li
                  key={`${d.code}-${d.subjectKind}-${d.subjectName}-${i}`}
                  className={styles.diagnosticRow}
                  data-blocking={d.blocking || undefined}
                >
                  <span className={styles.diagnosticSeverity}>
                    {d.blocking ? 'Blocking' : 'Notice'}
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
        </section>
      )}

      {empty && (
        <div className={styles.emptyState}>
          <img className={styles.emptyIcon} src={golemIcon} alt="" aria-hidden="true" />
          <p className={styles.emptyText}>No resolved configuration to display.</p>
        </div>
      )}

      {projection.providers.length > 0 && (
        <section aria-label="Providers">
          <Section id="providers" label="Providers" count={projection.providers.length}>
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
          </Section>
        </section>
      )}

      {projection.routes.length > 0 && (
        <section aria-label="Role routing">
          <Section id="roles" label="Roles" count={projection.routes.length}>
            <ul className={styles.routeList}>
              {projection.routes.map((r) => (
                <li key={r.useCase} className={styles.routeRow}>
                  <span className={styles.routeUseCase}>{r.useCase}</span>
                  <span className={styles.srOnly}>routes to role</span>
                  <span className={styles.routeArrow} aria-hidden="true">
                    →
                  </span>
                  <span className={styles.roleChip}>{r.role}</span>
                  {/* The role resolved: the same model name the cards head with,
                     so the ROLES/MODELS join reads without cross-referencing. */}
                  {modelForRole.get(r.role) !== undefined && (
                    <span className={styles.modelName}>{modelForRole.get(r.role)}</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        </section>
      )}

      {projection.models.length > 0 && (
        <section aria-label="Models">
          <Section id="models" label="Models" count={projection.models.length}>
            {modelsByProvider(projection.models, projection.providers).map(([provider, group]) => (
              <details
                key={provider}
                className={styles.subgroup}
                data-testid={`models-${provider}`}
                open
              >
                <summary className={styles.subgroupHeading}>
                  <span className={styles.sectionChevron} aria-hidden="true">
                    ▸
                  </span>
                  <span className={styles.providerName}>{provider}</span>
                  <span className={styles.sectionCount}>{group.length}</span>
                </summary>
                <ul className={styles.cardList}>
                  {group.map((m) => (
                    <li key={m.role} className={styles.card}>
                      <div className={styles.cardHeader}>
                        <span className={styles.roleChip}>{m.role}</span>
                        <span className={styles.modelName}>{m.modelName}</span>
                      </div>
                      {/* No provider chip here: the group header above says
                          it once, for every card beneath it. */}
                      <div className={styles.cardMeta}>
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
                      {/* What this model actually serves. An unrouted model shows
                    nothing — "defined but not routed" stays the workspace's
                    distinction to draw, not a second empty row here. */}
                      {m.routedUseCases.length > 0 && (
                        <div className={styles.capabilityRow} data-testid={`routed-${m.role}`}>
                          <span className={styles.chipLabel}>routes:</span>
                          {m.routedUseCases.map((useCase) => (
                            <span key={useCase} className={styles.useCaseChip}>
                              {useCase}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </Section>
        </section>
      )}
    </div>
  );
}

/**
 * One collapsible readout section. `<details>` is the repo's section-collapse
 * idiom (RunProfiles renders its detected group the same way), and it is the
 * right one: the browser owns the expanded state, the keyboard behaviour, and
 * hiding the collapsed content from the accessibility tree, so none of that can
 * drift out of sync with a hand-rolled button.
 */
function Section({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className={styles.section} data-testid={`section-${id}`} open>
      <summary className={styles.sectionHeading}>
        <span className={styles.sectionChevron} aria-hidden="true">
          ▸
        </span>
        {label}
        <span className={styles.sectionCount}>{count}</span>
      </summary>
      {children}
    </details>
  );
}

/**
 * The ordered model list, split into its provider groups. Order comes from the
 * one shared display rule, so the groups read in the providers section's own
 * sequence and the rows inside them are role-alpha.
 */
function modelsByProvider(
  models: readonly ModelProjection[],
  providers: readonly ProviderProjection[]
): [string, ModelProjection[]][] {
  const groups = new Map<string, ModelProjection[]>();
  for (const model of orderModelsForDisplay(models, providers)) {
    const group = groups.get(model.provider);
    if (group === undefined) groups.set(model.provider, [model]);
    else group.push(model);
  }
  return [...groups];
}

/**
 * Model routing section card (#263 spec §4.1/§4.2, mockup v10).
 *
 * One strip per use case, joined to the model its role resolves to. Read-only
 * in Slice B Task 7: the row editor, the filtered picker, and Remove for
 * `removable` defined models arrive with the write path, so the trailing Edit
 * column is absent rather than rendered inert.
 *
 * Strips are list items, matching the dock readout's `ul`/`li` rows, so each row
 * has a boundary in the accessibility tree; Tasks 8/9 hang an editor form off
 * one, which a list item takes without argument.
 */

import type { CapabilityName, ModelProjection, RouteProjection } from '../../types/golem';
import { Cell } from './Cell';
import styles from './GolemConfig.module.css';
import { StatusText, type StatusTone } from './StatusText';

/**
 * Firn-owned use-case floors (spec §4.5), mirroring runtime enforcement. The
 * defaults key for embeddings is `embedding`; `embed` is its capability token.
 * A use case outside this table has no Firn floor to check.
 */
const USE_CASE_FLOORS: Record<string, readonly CapabilityName[]> = {
  agent: ['chat', 'stream', 'tool_call'],
  chat: ['chat', 'stream'],
  embedding: ['embed'],
};

/** Row state for a read-only paint: the draft states (Modified, Key staged,
 * Needs review) and the inventory state (Unverified) belong to later slices. */
function routeStatus(model: ModelProjection | undefined, useCase: string) {
  if (!model) return { label: 'No model', tone: 'dim' as StatusTone };
  const floor = USE_CASE_FLOORS[useCase];
  const meetsFloor = !floor || floor.every((cap) => model.exposedCapabilities.includes(cap));
  return meetsFloor
    ? { label: 'Ready', tone: 'ok' as StatusTone }
    : { label: 'Incompatible', tone: 'bad' as StatusTone };
}

export function RoutingCard({
  routes,
  models,
}: {
  routes: RouteProjection[];
  models: ModelProjection[];
}) {
  const byRole = new Map(models.map((model) => [model.role, model]));
  const unrouted = models.filter((model) => model.routedUseCases.length === 0);

  return (
    <section className={styles.card} aria-labelledby="golem-config-routing">
      <div className={styles.cardHead}>
        <h3 id="golem-config-routing" className={styles.cardTitle}>
          Model Routing
        </h3>
        <span className={styles.hint}>assign a model to each use case</span>
      </div>
      <div className={styles.cardBody}>
        {routes.length === 0 ? (
          <p className={styles.empty}>
            Add a provider, then assign a model to each use case — nothing is routed yet.
          </p>
        ) : (
          <>
            {/* Decorative: every cell below names its own column. */}
            <div className={`${styles.columns} ${styles.routeGrid}`} aria-hidden="true">
              <span>Use case</span>
              <span>Provider</span>
              <span>Model</span>
              <span>Think</span>
              <span>Status</span>
            </div>
            <ul className={styles.rows} aria-label="Model routing">
              {routes.map((route) => {
                const model = byRole.get(route.role);
                const status = routeStatus(model, route.useCase);
                return (
                  <li
                    key={route.useCase}
                    data-testid={`route-row-${route.useCase}`}
                    className={`${styles.strip} ${styles.routeGrid}`}
                  >
                    <Cell label="Use case" className={styles.useCase}>
                      {route.useCase}
                    </Cell>
                    <Cell label="Provider" className={styles.meta}>
                      {model ? model.provider : <span className={styles.absent}>—</span>}
                    </Cell>
                    <Cell label="Model" className={styles.value}>
                      {/* The role a broken route still names is the only lead a
                          reader has for repairing it externally, so it is
                          meaningful copy rather than an inert placeholder. */}
                      {model ? model.modelName : `role ${route.role} has no model`}
                    </Cell>
                    <Cell label="Think" className={styles.meta}>
                      {model && model.thinkMode !== '' ? (
                        model.thinkMode
                      ) : (
                        <span className={styles.absent}>—</span>
                      )}
                    </Cell>
                    <Cell label="Status">
                      <StatusText tone={status.tone}>{status.label}</StatusText>
                    </Cell>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {unrouted.length > 0 && (
          <>
            <h4 id="golem-config-defined-models" className={styles.subgroup}>
              Defined models
            </h4>
            <p className={styles.empty}>Defined in the file but not routed to any use case.</p>
            <div className={`${styles.columns} ${styles.definedGrid}`} aria-hidden="true">
              <span>Role</span>
              <span>Provider</span>
              <span>Model</span>
            </div>
            <ul className={styles.rows} aria-labelledby="golem-config-defined-models">
              {unrouted.map((model) => (
                <li
                  key={model.role}
                  data-testid={`defined-model-row-${model.role}`}
                  className={`${styles.strip} ${styles.definedGrid}`}
                >
                  <Cell label="Role" className={styles.identifier}>
                    {model.role}
                  </Cell>
                  <Cell label="Provider" className={styles.meta}>
                    {model.provider}
                  </Cell>
                  <Cell label="Model" className={styles.value}>
                    {model.modelName}
                  </Cell>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

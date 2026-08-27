/**
 * Providers section card (#263 spec §4.1, mockup v10): a header bar with an
 * accent edge over separated row strips. Read-only in Slice B Task 7 — the row
 * editor and "Add provider" arrive with the write path.
 *
 * Strips are list items, matching the dock readout's `ul`/`li` rows, so each row
 * has a boundary in the accessibility tree; Tasks 8/9 hang an editor form off
 * one, which a list item takes without argument.
 */

import type { ProviderProjection } from '../../types/golem';
import { Cell } from './Cell';
import styles from './GolemConfig.module.css';
import { StatusText, type StatusTone } from './StatusText';

const CLASSIFICATION_LABEL: Record<ProviderProjection['classification'], string> = {
  local: 'Local',
  remote: 'Remote',
  unknown: 'Unknown',
};

const CREDENTIAL: Record<
  ProviderProjection['credentialState'],
  { label: string; tone: StatusTone }
> = {
  none: { label: 'No key', tone: 'dim' },
  available: { label: 'Key present', tone: 'ok' },
  reference_unavailable: { label: 'Key reference unavailable', tone: 'bad' },
};

export function ProvidersCard({ providers }: { providers: ProviderProjection[] }) {
  return (
    <section className={styles.card} aria-labelledby="golem-config-providers">
      <div className={styles.cardHead}>
        <h3 id="golem-config-providers" className={styles.cardTitle}>
          Providers
        </h3>
        <span className={styles.hint}>where models run — add these first</span>
      </div>
      <div className={styles.cardBody}>
        {providers.length === 0 ? (
          <p className={styles.empty}>
            Add a provider first — a provider is the endpoint a model actually runs on, and nothing
            can be routed until one exists.
          </p>
        ) : (
          <>
            {/* Decorative: every cell below names its own column. */}
            <div className={`${styles.columns} ${styles.providerGrid}`} aria-hidden="true">
              <span>Provider</span>
              <span>Endpoint</span>
              <span>Type</span>
              <span>API key</span>
            </div>
            <ul className={styles.rows} aria-label="Providers">
              {providers.map((provider) => {
                const credential = CREDENTIAL[provider.credentialState];
                return (
                  <li
                    key={provider.name}
                    data-testid={`provider-row-${provider.name}`}
                    className={`${styles.strip} ${styles.providerGrid}`}
                  >
                    <Cell label="Provider" className={styles.identifier}>
                      {provider.name}
                    </Cell>
                    <Cell label="Endpoint" className={styles.value}>
                      {/* Meaningful, not inert: an empty endpoint is the whole
                          misconfiguration signal, so it keeps readable copy. */}
                      {provider.endpoint === '' ? 'no endpoint' : provider.endpoint}
                    </Cell>
                    <Cell label="Type" className={styles.meta}>
                      {CLASSIFICATION_LABEL[provider.classification]}
                      <span className={styles.metaSub}>{provider.apiFormat}</span>
                    </Cell>
                    <Cell label="API key">
                      <StatusText tone={credential.tone}>{credential.label}</StatusText>
                    </Cell>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

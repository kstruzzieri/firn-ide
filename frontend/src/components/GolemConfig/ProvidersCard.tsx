/**
 * Providers section card (#263 spec §4.1, mockup v10): a header bar with an
 * accent edge over separated row strips. Read-only in Slice B Task 7 — the row
 * editor and "Add provider" arrive with the write path.
 */

import type { ProviderProjection } from '../../types/golem';
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
            <div className={`${styles.columns} ${styles.providerGrid}`} aria-hidden="true">
              <span>Provider</span>
              <span>Endpoint</span>
              <span>Type</span>
              <span>API key</span>
            </div>
            {providers.map((provider) => {
              const credential = CREDENTIAL[provider.credentialState];
              return (
                <div
                  key={provider.name}
                  data-testid={`provider-row-${provider.name}`}
                  className={`${styles.strip} ${styles.providerGrid}`}
                >
                  <span className={styles.identifier} data-label="Provider">
                    {provider.name}
                  </span>
                  <span className={styles.value} data-label="Endpoint">
                    {provider.endpoint === '' ? (
                      <span className={styles.absent}>no endpoint</span>
                    ) : (
                      provider.endpoint
                    )}
                  </span>
                  <span className={styles.meta} data-label="Type">
                    {CLASSIFICATION_LABEL[provider.classification]}
                    <span className={styles.metaSub}>{provider.apiFormat}</span>
                  </span>
                  <span data-label="API key">
                    <StatusText tone={credential.tone}>{credential.label}</StatusText>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

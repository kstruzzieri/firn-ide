/**
 * Status is a dot plus plain text (spec §4.7) — never a bordered pill and never
 * colour alone. Every caller passes a label, so the dot is decorative.
 */

import styles from './GolemConfig.module.css';

export type StatusTone = 'ok' | 'warn' | 'bad' | 'dim' | 'limited' | 'info';

/**
 * `detail` is the [W6] sub-line under the label — why the row reads as it does
 * (`edited here`, `model changes`, `fallback changes`). `info` is the hollow
 * blue dot of a row whose own values stay while what it falls back to changes.
 */
export function StatusText({
  tone,
  detail,
  children,
}: {
  tone: StatusTone;
  detail?: string;
  children: string;
}) {
  return (
    <span className={styles.status} data-tone={tone}>
      <span className={styles.statusDot} aria-hidden="true" />
      {children}
      {detail !== undefined && <small className={styles.statusDetail}>{detail}</small>}
    </span>
  );
}

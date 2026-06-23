import type { LSPServerStatus } from '../../stores/lspStore';
import { describeSetup } from './lspSetupNotice';
import styles from './LSPSetupCard.module.css';

export function LSPSetupCard({ status }: { status: LSPServerStatus | undefined }) {
  const notice = describeSetup(status);
  if (!notice) return null;
  return (
    <div role="status" aria-live="polite" className={`${styles.card} ${styles[notice.tone]}`}>
      <span className={styles.message}>{notice.message}</span>
      <span className={styles.hint}>{notice.hint}</span>
    </div>
  );
}

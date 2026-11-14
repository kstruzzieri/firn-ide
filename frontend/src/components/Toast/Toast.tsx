import { useEffect } from 'react';
import { useToast, useIDEStore } from '../../stores/ideStore';
import styles from './Toast.module.css';

const TOAST_DURATION = 4000;

export function Toast() {
  const toast = useToast();
  const clearToast = useIDEStore((state) => state.clearToast);

  useEffect(() => {
    if (!toast || toast.sticky) return;
    const timer = setTimeout(clearToast, TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  // The alert region is always mounted and unstyled: WebKit announces a region
  // only when its content changes, and one inserted together with its text
  // reaches VoiceOver as created, not changed, so the toast is never spoken.
  return (
    <div role="alert" aria-live="assertive">
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          <span className={styles.message}>{toast.message}</span>
          <button className={styles.close} onClick={clearToast} aria-label="Dismiss" type="button">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

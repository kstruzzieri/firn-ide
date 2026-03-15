import type { FoldedRegion } from '../../types/runOutput';
import styles from './RunOutput.module.css';

interface SmartFoldProps {
  fold: FoldedRegion;
  isExpanded: boolean;
  onToggle: (foldId: string) => void;
}

export function SmartFold({ fold, isExpanded, onToggle }: SmartFoldProps) {
  if (!isExpanded) {
    return (
      <div
        className={styles.foldRegion}
        onClick={() => onToggle(fold.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(fold.id);
          }
        }}
        aria-expanded={false}
        aria-label={`${fold.summary} (${fold.lineCount} lines, click to expand)`}
      >
        <span className={styles.foldChevron}>▶</span>
        <span className={styles.foldSummary}>{fold.summary}</span>
        <span className={styles.foldCount}>{fold.lineCount} lines</span>
      </div>
    );
  }

  return (
    <div className={styles.foldExpanded}>
      <div
        className={styles.foldExpandedHeader}
        onClick={() => onToggle(fold.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(fold.id);
          }
        }}
        aria-expanded={true}
      >
        <span className={`${styles.foldChevron} ${styles.foldChevronOpen}`}>▶</span>
        <span className={styles.foldSummary}>{fold.summary}</span>
        <span className={styles.foldCount}>{fold.lineCount} lines</span>
      </div>
      <div className={styles.foldExpandedBody}>
        {fold.entries.map((entry, idx) => (
          <div key={idx} className={`${styles.outputLine} ${styles[entry.stream]}`}>
            {entry.text}
          </div>
        ))}
      </div>
    </div>
  );
}

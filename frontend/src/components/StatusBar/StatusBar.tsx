import styles from './StatusBar.module.css';
import { StatusBranchIcon, CheckIcon, AlertCircleIcon } from '../icons';
import {
  useGitBranch,
  useErrorCount,
  useWarningCount,
  useActiveFile,
  useCursorPosition,
} from '../../stores/ideStore';

export function StatusBar() {
  const gitBranch = useGitBranch();
  const errorCount = useErrorCount();
  const warningCount = useWarningCount();
  const activeFile = useActiveFile();
  const cursorPosition = useCursorPosition();

  return (
    <>
      <div className={styles.left}>
        {gitBranch && (
          <span className={styles.item}>
            <StatusBranchIcon aria-hidden="true" />
            <span>{gitBranch}</span>
          </span>
        )}
        <DiagnosticsIndicator
          errors={errorCount}
          warnings={warningCount}
        />
      </div>
      <div className={styles.spacer} />
      <div className={styles.right}>
        {activeFile && (
          <>
            <span className={styles.item}>{activeFile.language || 'Plain Text'}</span>
            <span className={styles.item}>{activeFile.encoding || 'UTF-8'}</span>
            <span className={styles.item}>
              Ln {cursorPosition.line}, Col {cursorPosition.column}
            </span>
          </>
        )}
      </div>
    </>
  );
}

interface DiagnosticsIndicatorProps {
  errors: number;
  warnings: number;
}

function DiagnosticsIndicator({ errors, warnings }: DiagnosticsIndicatorProps) {
  const hasIssues = errors > 0 || warnings > 0;

  return (
    <span className={`${styles.item} ${errors > 0 ? styles.error : ''}`}>
      {hasIssues ? (
        <>
          <AlertCircleIcon aria-hidden="true" />
          <span>{errors} errors, {warnings} warnings</span>
        </>
      ) : (
        <>
          <CheckIcon aria-hidden="true" />
          <span>No issues</span>
        </>
      )}
    </span>
  );
}

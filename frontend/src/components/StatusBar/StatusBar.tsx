import styles from './StatusBar.module.css';
import { StatusBranchIcon, CheckIcon, AlertCircleIcon } from '../icons';
import { useGitBranch, useActiveFile, useCursorPosition } from '../../stores/ideStore';
import { useLSPErrorCount, useLSPInfoCount, useLSPWarningCount } from '../../stores/lspStore';
import { EditorThemePicker } from './EditorThemePicker';

export function StatusBar() {
  const gitBranch = useGitBranch();
  const errorCount = useLSPErrorCount();
  const warningCount = useLSPWarningCount();
  const infoCount = useLSPInfoCount();
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
        <DiagnosticsIndicator errors={errorCount} warnings={warningCount} info={infoCount} />
      </div>
      <div className={styles.spacer} />
      <div className={styles.right}>
        <EditorThemePicker />
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
  info: number;
}

function DiagnosticsIndicator({ errors, warnings, info }: DiagnosticsIndicatorProps) {
  const hasIssues = errors > 0 || warnings > 0 || info > 0;

  return (
    <span className={`${styles.item} ${errors > 0 ? styles.error : ''}`}>
      {hasIssues ? (
        <>
          <AlertCircleIcon aria-hidden="true" />
          <span>{formatDiagnosticsSummary(errors, warnings, info)}</span>
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

function formatDiagnosticsSummary(errors: number, warnings: number, info: number): string {
  const parts: string[] = [];

  if (errors > 0) {
    parts.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`);
  }
  if (warnings > 0) {
    parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
  }
  if (info > 0) {
    parts.push(`${info} info`);
  }

  return parts.join(', ');
}

import styles from './StatusBar.module.css';
import { StatusBranchIcon, CheckIcon, AlertCircleIcon } from '../icons';
import { useActiveFile, useCursorPosition } from '../../stores/ideStore';
import { useGitBranchInfo, useGitStore } from '../../stores/gitStore';
import { useLSPErrorCount, useLSPInfoCount, useLSPWarningCount } from '../../stores/lspStore';
import { EditorThemePicker } from './EditorThemePicker';

export function StatusBar() {
  const { branch, ahead, behind } = useGitBranchInfo();
  const errorCount = useLSPErrorCount();
  const warningCount = useLSPWarningCount();
  const infoCount = useLSPInfoCount();
  const activeFile = useActiveFile();
  const cursorPosition = useCursorPosition();

  // The git segment is a control, not a label: clicking the branch opens the
  // always-visible header branch switcher; the arrows push/pull directly.
  const handleBranchClick = () => {
    useGitStore.getState().requestBranchPopupFocus();
  };

  return (
    <>
      <div className={styles.left}>
        {branch && (
          <span className={styles.item}>
            <button
              type="button"
              className={styles.segmentBtn}
              onClick={handleBranchClick}
              aria-label={`Branch: ${branch}. Open branch switcher`}
              title="Switch branch"
            >
              <StatusBranchIcon aria-hidden="true" />
              <span>{branch}</span>
            </button>
            {ahead > 0 && (
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.aheadBehind}`}
                onClick={() => void useGitStore.getState().push()}
                aria-label={`Push ${ahead} outgoing ${ahead === 1 ? 'commit' : 'commits'}`}
                title="Push"
              >
                {`↑${ahead}`}
              </button>
            )}
            {behind > 0 && (
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.aheadBehind}`}
                onClick={() => void useGitStore.getState().pull()}
                aria-label={`Pull ${behind} incoming ${behind === 1 ? 'commit' : 'commits'}`}
                title="Pull"
              >
                {`↓${behind}`}
              </button>
            )}
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

import styles from './Terminal.module.css';
import { TerminalIcon, OutputIcon, AlertCircleIcon } from '../icons';
import { useIDEStore, TerminalTab, useErrorCount, useWarningCount } from '../../stores/ideStore';

const TERMINAL_TABS: Array<{
  id: TerminalTab;
  icon: typeof TerminalIcon;
  label: string;
}> = [
  { id: 'terminal', icon: TerminalIcon, label: 'Terminal' },
  { id: 'output', icon: OutputIcon, label: 'Output' },
  { id: 'problems', icon: AlertCircleIcon, label: 'Problems' },
];

export function Terminal() {
  const activeTab = useIDEStore((state) => state.activeTerminalTab);
  const setTerminalTab = useIDEStore((state) => state.setTerminalTab);
  const workingDirectory = useIDEStore((state) => state.workingDirectory);
  const errorCount = useErrorCount();
  const warningCount = useWarningCount();

  return (
    <div className={styles.terminal}>
      <div className={styles.tabBar} role="tablist" aria-label="Terminal panels">
        {TERMINAL_TABS.map(({ id, icon: Icon, label }) => {
          const isActive = id === activeTab;
          const count = id === 'problems' ? errorCount + warningCount : undefined;

          return (
            <button
              key={id}
              className={`${styles.tab} ${isActive ? styles.active : ''}`}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTerminalTab(id)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {count !== undefined && count > 0 && (
                <span className={styles.badge} aria-label={`${count} issues`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className={styles.content} role="tabpanel" tabIndex={0}>
        {activeTab === 'terminal' && <TerminalContent workingDirectory={workingDirectory} />}
        {activeTab === 'output' && <OutputContent />}
        {activeTab === 'problems' && (
          <ProblemsContent errors={errorCount} warnings={warningCount} />
        )}
      </div>
    </div>
  );
}

interface TerminalContentProps {
  workingDirectory: string;
}

function TerminalContent({ workingDirectory }: TerminalContentProps) {
  const displayPath = workingDirectory || '~';

  return (
    <div className={styles.terminalContent}>
      <div className={styles.line}>
        <span className={styles.prompt}>{displayPath}</span>
        <span className={styles.cursor} aria-hidden="true">
          ▋
        </span>
      </div>
    </div>
  );
}

function OutputContent() {
  return (
    <div className={styles.emptyState}>
      <p>No output to display</p>
    </div>
  );
}

interface ProblemsContentProps {
  errors: number;
  warnings: number;
}

function ProblemsContent({ errors, warnings }: ProblemsContentProps) {
  const total = errors + warnings;

  if (total === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No problems detected</p>
      </div>
    );
  }

  return <div className={styles.problemsList}>{/* Problems will be populated dynamically */}</div>;
}

import styles from './Terminal.module.css';
import { TerminalIcon, OutputIcon, AlertCircleIcon } from '../icons';
import { useIDEStore, TerminalTab, useErrorCount, useWarningCount } from '../../stores/ideStore';
import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  CreateTerminal,
  WriteTerminal,
  CloseTerminal,
  ResizeTerminal,
} from '../../../wailsjs/go/main/App';
import { EventsOn } from '../../../wailsjs/runtime';

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
        <div
          className={styles.tabContent}
          style={{ display: activeTab === 'terminal' ? 'block' : 'none' }}
        >
          <TerminalContent />
        </div>
        {activeTab === 'output' && <OutputContent />}
        {activeTab === 'problems' && (
          <ProblemsContent errors={errorCount} warnings={warningCount} />
        )}
      </div>
    </div>
  );
}

function TerminalContent() {
  const containerDiv = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerDiv.current) return;

    const term = new XTerm({
      theme: {
        background: '#141C24',
        foreground: '#E0E4EA',
        cursor: '#4FC3F7',
        cursorAccent: '#141C24',
        selectionBackground: '#4FC3F733',
        // ANSI colors — matched to Deep Ocean
        black: '#1A2332',
        red: '#FF6B6B',
        green: '#69DB7C',
        yellow: '#FFD43B',
        blue: '#4FC3F7',
        magenta: '#DA77F2',
        cyan: '#66D9E8',
        white: '#E0E4EA',
        // Bright variants
        brightBlack: '#3D5166',
        brightRed: '#FF8787',
        brightGreen: '#8CE99A',
        brightYellow: '#FFE066',
        brightBlue: '#74D0F7',
        brightMagenta: '#E599F7',
        brightCyan: '#99E9F2',
        brightWhite: '#FFFFFF',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: -0.5,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerDiv.current);
    fitAddon.fit();

    let sessionId = '';

    // Subscribe to terminal output BEFORE creating the terminal
    // to avoid losing early output (e.g., the initial shell prompt).
    const cancelOutput = EventsOn('terminal:output', (termId: string, data: string) => {
      if (termId === sessionId) {
        term.write(data);
      }
    });

    CreateTerminal().then((id) => {
      sessionId = id;

      // Send correct dimensions to PTY
      void ResizeTerminal(id, term.rows, term.cols);

      term.onData((data) => {
        void WriteTerminal(id, data);
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (sessionId) {
        void ResizeTerminal(sessionId, term.rows, term.cols);
      }
    });
    resizeObserver.observe(containerDiv.current);

    return () => {
      cancelOutput();
      if (sessionId) {
        void CloseTerminal(sessionId);
      }
      resizeObserver.disconnect();
      term.dispose();
    };
  }, []);

  return <div ref={containerDiv} className={styles.terminalContent} />;
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

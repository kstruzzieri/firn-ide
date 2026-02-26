import styles from './Terminal.module.css';
import { TerminalIcon, OutputIcon, AlertCircleIcon, PlusIcon } from '../icons';
import {
  useIDEStore,
  TerminalTab,
  useErrorCount,
  useWarningCount,
  useTerminalSessions,
  useActiveTerminalSessionId,
} from '../../stores/ideStore';
import { useEffect, useRef, useState, useCallback } from 'react';
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
  { id: 'output', icon: OutputIcon, label: 'Output' },
  { id: 'problems', icon: AlertCircleIcon, label: 'Problems' },
  { id: 'terminal', icon: TerminalIcon, label: 'Terminal' },
];

const TERMINAL_ACCENT = '#f97316';

const XTERM_THEME = {
  background: '#0A0A0C',
  foreground: '#D4C4B0',
  cursor: TERMINAL_ACCENT,
  cursorAccent: '#0A0A0C',
  selectionBackground: `${TERMINAL_ACCENT}33`,
  black: '#0A0A0C',
  red: '#FF6B6B',
  green: '#69DB7C',
  yellow: '#FFD43B',
  blue: '#4FC3F7',
  magenta: '#DA77F2',
  cyan: '#66D9E8',
  white: '#D4C4B0',
  brightBlack: '#4A3F35',
  brightRed: '#FF8787',
  brightGreen: '#8CE99A',
  brightYellow: '#FFE066',
  brightBlue: '#74D0F7',
  brightMagenta: '#E599F7',
  brightCyan: '#99E9F2',
  brightWhite: '#F5E6D3',
};

// Buffers terminal output per session until TerminalContent mounts and attaches.
// This prevents losing early output (shell prompt, rc output) that the backend
// emits before the React component has subscribed.
const outputBuffers = new Map<string, string[]>();
const outputListeners = new Map<string, (data: string) => void>();

let globalOutputCleanup: (() => void) | null = null;

function ensureGlobalOutputListener() {
  if (globalOutputCleanup) return;
  globalOutputCleanup = EventsOn('terminal:output', (termId: string, data: string) => {
    const listener = outputListeners.get(termId);
    if (listener) {
      listener(data);
    } else {
      // Buffer output until a listener attaches
      let buf = outputBuffers.get(termId);
      if (!buf) {
        buf = [];
        outputBuffers.set(termId, buf);
      }
      buf.push(data);
    }
  });
}

function attachSessionListener(sessionId: string, onData: (data: string) => void) {
  outputListeners.set(sessionId, onData);
  // Replay any buffered output
  const buf = outputBuffers.get(sessionId);
  if (buf) {
    for (const chunk of buf) {
      onData(chunk);
    }
    outputBuffers.delete(sessionId);
  }
}

function detachSessionListener(sessionId: string) {
  outputListeners.delete(sessionId);
}

function cleanupSessionBuffers(sessionId: string) {
  outputBuffers.delete(sessionId);
  outputListeners.delete(sessionId);
}

export function Terminal() {
  const activeTab = useIDEStore((state) => state.activeTerminalTab);
  const setTerminalTab = useIDEStore((state) => state.setTerminalTab);
  const errorCount = useErrorCount();
  const warningCount = useWarningCount();
  const terminalSessions = useTerminalSessions();
  const activeSessionId = useActiveTerminalSessionId();
  const addSession = useIDEStore((state) => state.addTerminalSession);
  const removeSession = useIDEStore((state) => state.removeTerminalSession);
  const setActiveSession = useIDEStore((state) => state.setActiveTerminalSession);
  const renameSession = useIDEStore((state) => state.renameTerminalSession);
  const reorderSessions = useIDEStore((state) => state.reorderTerminalSessions);
  const showToast = useIDEStore((state) => state.showToast);

  const sessionCountRef = useRef(0);
  const isCreatingRef = useRef(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);

  // Ensure the global output listener is active so no output is lost
  useEffect(() => {
    ensureGlobalOutputListener();
  }, []);

  const createNewSession = useCallback(async () => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    try {
      // Register global listener before creating the PTY so early output is buffered
      ensureGlobalOutputListener();
      const id = await CreateTerminal();
      sessionCountRef.current += 1;
      addSession({ id, title: `Terminal ${sessionCountRef.current}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      showToast(`Failed to create terminal: ${message}`, 'error');
    } finally {
      isCreatingRef.current = false;
    }
  }, [addSession, showToast]);

  // Auto-create a session when switching to the terminal tab with no sessions
  useEffect(() => {
    if (activeTab === 'terminal' && terminalSessions.length === 0) {
      createNewSession();
    }
  }, [activeTab, terminalSessions.length, createNewSession]);

  const handleCloseSession = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      cleanupSessionBuffers(sessionId);
      void CloseTerminal(sessionId);
      removeSession(sessionId);
    },
    [removeSession]
  );

  const startRename = (session: { id: string; title: string }) => {
    setRenamingId(session.id);
    setRenameValue(session.title);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      renameSession(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== toIndex) {
        reorderSessions(dragIndex, toIndex);
      }
      setDragIndex(null);
      setDragOverIndex(null);
    },
    [dragIndex, reorderSessions]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  return (
    <div className={styles.terminal} data-accent="orange">
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
        {activeTab === 'terminal' && terminalSessions.length > 0 && (
          <>
            <div className={styles.divider} />
            {terminalSessions.map((session, index) => {
              const isActive = session.id === activeSessionId;
              const isRenaming = session.id === renamingId;
              const isDragging = dragIndex === index;
              const isDragOver = dragOverIndex === index && dragIndex !== index;

              return (
                <div
                  key={session.id}
                  className={`${styles.sessionTab} ${isActive ? styles.active : ''} ${isDragging ? styles.dragging : ''} ${isDragOver ? styles.dragOver : ''}`}
                  role="tab"
                  tabIndex={0}
                  aria-selected={isActive}
                  onClick={() => setActiveSession(session.id)}
                  onDoubleClick={() => startRename(session)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveSession(session.id);
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, session.id)}
                  draggable={!isRenaming}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  title={session.title}
                >
                  <TerminalIcon aria-hidden="true" />
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      className={styles.sessionTabInput}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={styles.sessionTabLabel}>{session.title}</span>
                  )}
                  <button
                    className={styles.sessionTabClose}
                    onClick={(e) => handleCloseSession(e, session.id)}
                    aria-label={`Close ${session.title}`}
                  >
                    &times;
                  </button>
                </div>
              );
            })}
            <button
              className={styles.newSessionButton}
              onClick={createNewSession}
              aria-label="New terminal session"
              title="New Terminal"
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <div className={styles.content} role="tabpanel" tabIndex={0}>
        <div
          className={styles.tabContent}
          style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }}
        >
          <div className={styles.sessionsContainer}>
            {terminalSessions.map((session) => (
              <TerminalContent
                key={session.id}
                sessionId={session.id}
                isVisible={session.id === activeSessionId}
              />
            ))}
          </div>
        </div>
        {activeTab === 'output' && <OutputContent />}
        {activeTab === 'problems' && (
          <ProblemsContent errors={errorCount} warnings={warningCount} />
        )}
      </div>
      {contextMenu && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={() => {
            const session = terminalSessions.find((s) => s.id === contextMenu.sessionId);
            if (session) startRename(session);
            closeContextMenu();
          }}
          onClose={() => {
            cleanupSessionBuffers(contextMenu.sessionId);
            void CloseTerminal(contextMenu.sessionId);
            removeSession(contextMenu.sessionId);
            closeContextMenu();
          }}
          onDismiss={closeContextMenu}
        />
      )}
    </div>
  );
}

interface SessionContextMenuProps {
  x: number;
  y: number;
  onRename: () => void;
  onClose: () => void;
  onDismiss: () => void;
}

function SessionContextMenu({ x, y, onRename, onClose, onDismiss }: SessionContextMenuProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  // Clamp menu position to viewport on mount via callback ref.
  // The context menu remounts each time it opens, so this runs with fresh x/y.
  const clampRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        node.style.left = `${window.innerWidth - rect.width - 4}px`;
      }
      if (rect.bottom > window.innerHeight) {
        node.style.top = `${window.innerHeight - rect.height - 4}px`;
      }
    },
    [x, y]
  );

  return (
    <>
      <div className={styles.contextMenuOverlay} onClick={onDismiss} />
      <div ref={clampRef} className={styles.contextMenu} style={{ left: x, top: y }}>
        <button className={styles.contextMenuItem} onClick={onRename}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
          Rename
        </button>
        <div className={styles.contextMenuDivider} />
        <button
          className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
          onClick={onClose}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Close Terminal
        </button>
      </div>
    </>
  );
}

interface TerminalContentProps {
  sessionId: string;
  isVisible: boolean;
}

function TerminalContent({ sessionId, isVisible }: TerminalContentProps) {
  const containerDiv = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerDiv.current) return;

    const term = new XTerm({
      theme: XTERM_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: -1,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerDiv.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Attach to the buffered output system - replays any early output automatically
    attachSessionListener(sessionId, (data: string) => {
      term.write(data);
    });

    // Send correct dimensions to PTY
    void ResizeTerminal(sessionId, term.rows, term.cols);

    term.onData((data) => {
      void WriteTerminal(sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      void ResizeTerminal(sessionId, term.rows, term.cols);
    });
    resizeObserver.observe(containerDiv.current);

    return () => {
      // Detach listener — output will be buffered until remount (e.g., panel un-collapse).
      // We intentionally do NOT close the backend PTY here because TerminalContent unmounts
      // when the bottom panel collapses, and users expect their sessions to persist.
      // Backend sessions are only closed via explicit close button/context menu actions.
      detachSessionListener(sessionId);
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  // Refit when visibility changes (tab switch)
  useEffect(() => {
    if (isVisible && fitAddonRef.current && termRef.current) {
      // Delay fit slightly so the container has its correct dimensions
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        if (termRef.current) {
          void ResizeTerminal(sessionId, termRef.current.rows, termRef.current.cols);
        }
      });
    }
  }, [isVisible, sessionId]);

  return (
    <div
      ref={containerDiv}
      className={styles.terminalContent}
      style={{ display: isVisible ? 'block' : 'none' }}
    />
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

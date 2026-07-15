import styles from './Terminal.module.css';
import { TerminalIcon, OutputIcon, AlertCircleIcon, PlusIcon } from '../icons';
import {
  useIDEStore,
  TerminalTab,
  useTerminalSessions,
  useActiveTerminalSessionId,
  useRunOutputs,
  useActiveRunOutputId,
} from '../../stores/ideStore';
import {
  useLSPDiagnosticCount,
  useGroupedDiagnostics,
  type GroupedDiagnostic,
  type LSPDiagnostic,
} from '../../stores/lspStore';
import { navigateToEditorLocation } from '../../utils/editorNavigation';
import { getDirectoryPath, getFileNameFromPath } from '../../utils/lspUri';
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useRunOutputListener } from '../../hooks/useRunOutput';
import { RunOutputPanel } from '../RunOutput';
import { ALL_PROFILES_ID } from '../../types/runOutput';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createShellIntegration } from './shellIntegration';
import { XTERM_OPTIONS } from './xtermConfig';
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

// Gutter marker / separator colors for shell-integration decorations.
const SHELL_INTEGRATION_COLORS = {
  fail: '#F87171', // red-400 — failed command
  ok: '#334155', // slate-700 — succeeded command (neutral)
  separator: 'rgba(148, 163, 184, 0.18)', // slate-400 @ low alpha
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

function getNextTerminalTitle(sessions: Array<{ title: string }>) {
  const usedNumbers = new Set<number>();

  for (const session of sessions) {
    const match = /^Terminal (\d+)$/.exec(session.title);
    if (match) {
      usedNumbers.add(Number(match[1]));
    }
  }

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return `Terminal ${nextNumber}`;
}

function moveTabFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (target.getAttribute('role') !== 'tab') return;

  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const index = tabs.indexOf(target);
  let next: number | null = null;

  switch (event.key) {
    case 'ArrowRight':
      next = index < tabs.length - 1 ? index + 1 : 0;
      break;
    case 'ArrowLeft':
      next = index > 0 ? index - 1 : tabs.length - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = tabs.length - 1;
      break;
  }

  if (next !== null) {
    event.preventDefault();
    tabs[next]?.focus();
  }
}

export function Terminal() {
  const activeTab = useIDEStore((state) => state.activeTerminalTab);
  const setTerminalTab = useIDEStore((state) => state.setTerminalTab);
  const problemCount = useLSPDiagnosticCount();
  const terminalSessions = useTerminalSessions();
  const activeSessionId = useActiveTerminalSessionId();
  const addSession = useIDEStore((state) => state.addTerminalSession);
  const removeSession = useIDEStore((state) => state.removeTerminalSession);
  const setActiveSession = useIDEStore((state) => state.setActiveTerminalSession);
  const renameSession = useIDEStore((state) => state.renameTerminalSession);
  const reorderSessions = useIDEStore((state) => state.reorderTerminalSessions);
  const showToast = useIDEStore((state) => state.showToast);

  useRunOutputListener();

  const runOutputs = useRunOutputs();
  const activeRunOutputId = useActiveRunOutputId();
  const setActiveRunOutput = useIDEStore((s) => s.setActiveRunOutput);
  const setViewMode = useIDEStore((s) => s.setRunOutputViewMode);
  const outputIds = Object.keys(runOutputs);

  const isCreatingRef = useRef(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const sessionTabRefs = useRef(new Map<string, HTMLDivElement>());
  const newSessionButtonRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);

  // Ensure the global output listener is active so no output is lost
  useEffect(() => {
    ensureGlobalOutputListener();
  }, []);

  // Sessions are created only on explicit user request (the + button): a shell
  // process is a side effect the user should opt into, and an auto-spawned one
  // sat in whatever directory the app started from, inviting wrong-repo
  // commands before the workspace cwd fix could apply.
  const createNewSession = useCallback(async () => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    try {
      // Register global listener before creating the PTY so early output is buffered
      ensureGlobalOutputListener();
      // Start the shell in the loaded workspace root (not the app process's
      // cwd, which under wails dev is the firn checkout itself).
      const id = await CreateTerminal(useIDEStore.getState().workspace?.path ?? '');
      const title = getNextTerminalTitle(useIDEStore.getState().terminalSessions);
      addSession({ id, title });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
      showToast(`Failed to create terminal: ${message}`, 'error');
    } finally {
      isCreatingRef.current = false;
    }
  }, [addSession, showToast]);

  const focusSessionOrNew = useCallback((sessionId: string | null) => {
    requestAnimationFrame(() => {
      const destination = sessionId ? sessionTabRefs.current.get(sessionId) : null;
      (destination ?? newSessionButtonRef.current)?.focus();
    });
  }, []);

  const closeSession = useCallback(
    (sessionId: string, restoreFocus = false) => {
      cleanupSessionBuffers(sessionId);
      // The frontend row is already gone; a failed backend close would orphan
      // the PTY invisibly, so at least say so.
      CloseTerminal(sessionId).catch((err: unknown) =>
        showToast(
          `Failed to close terminal: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        )
      );
      removeSession(sessionId);
      if (restoreFocus) {
        focusSessionOrNew(useIDEStore.getState().activeTerminalSessionId);
      }
    },
    [focusSessionOrNew, removeSession, showToast]
  );

  const handleCloseSession = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      closeSession(sessionId, true);
    },
    [closeSession]
  );

  const startRename = (session: { id: string; title: string }) => {
    renameCancelledRef.current = false;
    setRenamingId(session.id);
    setRenameValue(session.title);
  };

  const commitRename = (focusSessionId?: string) => {
    if (!renameCancelledRef.current && renamingId && renameValue.trim()) {
      renameSession(renamingId, renameValue.trim());
    }
    renameCancelledRef.current = false;
    setRenamingId(null);
    if (focusSessionId) focusSessionOrNew(focusSessionId);
  };

  const cancelRename = (sessionId: string) => {
    renameCancelledRef.current = true;
    setRenamingId(null);
    focusSessionOrNew(sessionId);
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

  const contextMenuSession = contextMenu
    ? terminalSessions.find((session) => session.id === contextMenu.sessionId)
    : undefined;

  return (
    <div className={styles.terminal} data-accent="project">
      <div className={styles.tabBar}>
        <div
          className={styles.tabList}
          role="tablist"
          aria-label="Terminal panels"
          onKeyDown={moveTabFocus}
        >
          {TERMINAL_TABS.map(({ id, icon: Icon, label }) => {
            const isActive = id === activeTab;
            const count = id === 'problems' ? problemCount : undefined;

            return (
              <button
                type="button"
                key={id}
                id={`terminal-panel-tab-${id}`}
                className={`${styles.tab} ${isActive ? styles.active : ''}`}
                role="tab"
                aria-selected={isActive}
                aria-controls="terminal-panel-content"
                tabIndex={isActive ? 0 : -1}
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
        {activeTab === 'terminal' && (
          <>
            <div className={styles.divider} />
            {terminalSessions.length > 0 && (
              <div
                className={styles.tabList}
                role="tablist"
                aria-label="Terminal sessions"
                onKeyDown={moveTabFocus}
              >
                {terminalSessions.map((session, index) => {
                  const isActive = session.id === activeSessionId;
                  const isRenaming = session.id === renamingId;
                  const isDragging = dragIndex === index;
                  const isDragOver = dragOverIndex === index && dragIndex !== index;
                  const sessionTabId = `terminal-session-tab-${session.id}`;
                  const sessionPanelId = `terminal-session-panel-${session.id}`;

                  return (
                    <div
                      key={session.id}
                      className={`${styles.sessionTab} ${isActive ? styles.active : ''} ${isDragging ? styles.dragging : ''} ${isDragOver ? styles.dragOver : ''}`}
                      draggable={!isRenaming}
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setActiveSession(session.id)}
                      onDoubleClick={() => startRename(session)}
                      onContextMenu={(e) => handleContextMenu(e, session.id)}
                      title={session.title}
                    >
                      <div
                        ref={(node) => {
                          if (node) sessionTabRefs.current.set(session.id, node);
                          else sessionTabRefs.current.delete(session.id);
                        }}
                        id={sessionTabId}
                        className={styles.sessionTabTarget}
                        role="tab"
                        tabIndex={isActive ? 0 : -1}
                        aria-label={session.title}
                        aria-selected={isActive}
                        aria-controls={sessionPanelId}
                        aria-haspopup="menu"
                        aria-expanded={contextMenu?.sessionId === session.id}
                        onKeyDown={(e) => {
                          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setContextMenu({ sessionId: session.id, x: rect.left, y: rect.bottom });
                          } else if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setActiveSession(session.id);
                          }
                        }}
                      >
                        <TerminalIcon aria-hidden="true" />
                        {!isRenaming && (
                          <span className={styles.sessionTabLabel}>{session.title}</span>
                        )}
                      </div>
                      {isRenaming && (
                        <input
                          ref={renameInputRef}
                          className={styles.sessionTabInput}
                          aria-label={`Rename ${session.title}`}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename(session.id);
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename(session.id);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onContextMenu={(e) => e.stopPropagation()}
                        />
                      )}
                      <button
                        type="button"
                        className={styles.sessionTabClose}
                        onClick={(e) => handleCloseSession(e, session.id)}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => e.stopPropagation()}
                        aria-label={`Close ${session.title}`}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              ref={newSessionButtonRef}
              type="button"
              className={styles.newSessionButton}
              onClick={() => {
                void createNewSession();
              }}
              aria-label="New terminal session"
              title="New Terminal"
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </>
        )}
        {activeTab === 'output' && outputIds.length > 0 && (
          <>
            <div className={styles.divider} />
            {outputIds.length >= 2 && (
              <button
                type="button"
                className={`${styles.sessionTab} ${activeRunOutputId === ALL_PROFILES_ID ? styles.active : ''}`}
                onClick={() => {
                  setActiveRunOutput(ALL_PROFILES_ID);
                  setViewMode('timeline');
                }}
                title="All Profiles Timeline"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="11"
                  height="11"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span className={styles.sessionTabLabel}>All</span>
              </button>
            )}
            {outputIds.map((id) => {
              const output = runOutputs[id];
              const isActive = id === activeRunOutputId;
              const stateClass =
                output.state === 'running'
                  ? styles.stateRunning
                  : output.state === 'success'
                    ? styles.stateSuccess
                    : output.state === 'failed'
                      ? styles.stateFailed
                      : output.state === 'stopped'
                        ? styles.stateStopped
                        : '';

              return (
                <button
                  type="button"
                  key={id}
                  className={`${styles.sessionTab} ${isActive ? styles.active : ''}`}
                  onClick={() => {
                    setActiveRunOutput(id);
                    if (useIDEStore.getState().runOutputViewMode === 'timeline') {
                      setViewMode('merged');
                    }
                  }}
                  title={id}
                >
                  <span className={`${styles.stateDot} ${stateClass}`} />
                  <span className={styles.sessionTabLabel}>{id}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
      <div
        id="terminal-panel-content"
        className={styles.content}
        role="tabpanel"
        aria-labelledby={`terminal-panel-tab-${activeTab}`}
        tabIndex={0}
      >
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
                tabId={`terminal-session-tab-${session.id}`}
                panelId={`terminal-session-panel-${session.id}`}
              />
            ))}
            {terminalSessions.length === 0 && (
              <button
                type="button"
                className={styles.terminalEmptyState}
                onClick={() => void createNewSession()}
              >
                No terminal sessions — click here or press + to open a shell in the workspace root
              </button>
            )}
          </div>
        </div>
        {activeTab === 'output' && <OutputContent />}
        {activeTab === 'problems' && <ProblemsContent />}
      </div>
      {contextMenu && contextMenuSession && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sessionTitle={contextMenuSession.title}
          onRename={() => {
            setContextMenu(null);
            startRename(contextMenuSession);
          }}
          onClose={() => {
            const sessionId = contextMenu.sessionId;
            setContextMenu(null);
            closeSession(sessionId, true);
          }}
          onDismiss={(restoreFocus) => {
            const sessionId = contextMenu.sessionId;
            if (restoreFocus) sessionTabRefs.current.get(sessionId)?.focus();
            setContextMenu(null);
          }}
        />
      )}
    </div>
  );
}

interface SessionContextMenuProps {
  x: number;
  y: number;
  sessionTitle: string;
  onRename: () => void;
  onClose: () => void;
  onDismiss: (restoreFocus: boolean) => void;
}

function focusRelativeTabStop(origin: HTMLElement, reverse: boolean) {
  const tabStops = Array.from(
    document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')
  ).filter((element) => {
    const style = window.getComputedStyle(element);
    return (
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[hidden], [inert]') &&
      style.display !== 'none' &&
      style.visibility !== 'hidden'
    );
  });
  const ordered = reverse ? [...tabStops].reverse() : tabStops;
  const relation = reverse ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  const target =
    ordered.find((element) => (origin.compareDocumentPosition(element) & relation) !== 0) ??
    ordered[0];
  target?.focus();
}

function SessionContextMenu({
  x,
  y,
  sessionTitle,
  onRename,
  onClose,
  onDismiss,
}: SessionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  // Clamp menu position to viewport on mount via callback ref.
  // The context menu remounts each time it opens, so this runs with fresh x/y.
  const clampRef = useCallback((node: HTMLDivElement | null) => {
    menuRef.current = node;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      node.style.left = `${window.innerWidth - rect.width - 4}px`;
    }
    if (rect.bottom > window.innerHeight) {
      node.style.top = `${window.innerHeight - rect.height - 4}px`;
    }
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      // Let the browser complete its native forward/reverse focus movement
      // while the focused item is still mounted, then close without restoring
      // the invoker over the destination it chose.
      const reverse = event.shiftKey;
      queueMicrotask(() => {
        const menu = menuRef.current;
        const active = document.activeElement;
        if (menu && (!active || active === document.body || menu.contains(active))) {
          focusRelativeTabStop(menu, reverse);
        }
        onDismiss(false);
      });
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss(true);
      return;
    }

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;

    switch (event.key) {
      case 'ArrowDown':
        next = index < items.length - 1 ? index + 1 : 0;
        break;
      case 'ArrowUp':
        next = index > 0 ? index - 1 : items.length - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
    }

    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <>
      <div
        className={styles.contextMenuOverlay}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onDismiss(menuRef.current?.contains(document.activeElement) ?? false)}
      />
      <div
        ref={clampRef}
        className={styles.contextMenu}
        style={{ left: x, top: y }}
        role="menu"
        aria-label={`Actions for ${sessionTitle}`}
        onKeyDown={handleKeyDown}
      >
        <button
          type="button"
          className={styles.contextMenuItem}
          role="menuitem"
          tabIndex={-1}
          onClick={onRename}
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
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
          Rename
        </button>
        <div className={styles.contextMenuDivider} />
        <button
          type="button"
          className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
          role="menuitem"
          tabIndex={-1}
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
  tabId: string;
  panelId: string;
}

function TerminalContent({ sessionId, isVisible, tabId, panelId }: TerminalContentProps) {
  const containerDiv = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerDiv.current) return;

    const term = new XTerm(XTERM_OPTIONS);

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerDiv.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Register the OSC 133 handler before replaying buffered output, so early
    // shell-integration sequences (prompt/exit markers) are parsed, not printed.
    const shellIntegration = createShellIntegration(term, SHELL_INTEGRATION_COLORS);

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
      shellIntegration.dispose();
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
      id={panelId}
      className={styles.terminalContent}
      role="tabpanel"
      aria-labelledby={tabId}
      style={{ display: isVisible ? 'block' : 'none' }}
    />
  );
}

function OutputContent() {
  return <RunOutputPanel />;
}

function ProblemsContent() {
  const groups = useGroupedDiagnostics();

  if (groups.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No problems detected</p>
      </div>
    );
  }

  return (
    <div className={styles.problemsList}>
      {groups.map((group) => (
        <ProblemsFileGroup key={group.uri} group={group} />
      ))}
    </div>
  );
}

function ProblemsFileGroup({ group }: { group: GroupedDiagnostic }) {
  const fileName = getFileNameFromPath(group.filePath);
  const dirPath = getDirectoryPath(group.filePath);

  return (
    <div className={styles.problemsGroup}>
      <div className={styles.problemsGroupHeader}>
        <span className={styles.problemsFileName}>{fileName}</span>
        {dirPath && <span className={styles.problemsFilePath}>{dirPath}</span>}
        <span className={styles.problemsGroupCount}>{group.diagnostics.length}</span>
      </div>
      {group.diagnostics.map((diag, i) => (
        <ProblemRow key={`${group.uri}-${i}`} diagnostic={diag} filePath={group.filePath} />
      ))}
    </div>
  );
}

function ProblemRow({ diagnostic, filePath }: { diagnostic: LSPDiagnostic; filePath: string }) {
  const handleClick = useCallback(() => {
    navigateToEditorLocation(
      filePath,
      diagnostic.range.start.line + 1,
      diagnostic.range.start.character + 1
    );
  }, [filePath, diagnostic.range.start.line, diagnostic.range.start.character]);

  const severityClass =
    diagnostic.severity === 1
      ? styles.problemsError
      : diagnostic.severity === 2
        ? styles.problemsWarning
        : styles.problemsInfo;

  const severityLabel = diagnostic.severity === 1 ? 'E' : diagnostic.severity === 2 ? 'W' : 'I';

  return (
    <button className={styles.problemsRow} onClick={handleClick} type="button">
      <span className={`${styles.problemsSeverity} ${severityClass}`}>{severityLabel}</span>
      <span className={styles.problemsMessage}>{diagnostic.message}</span>
      <span className={styles.problemsLocation}>
        [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]
      </span>
      {diagnostic.source && <span className={styles.problemsSource}>{diagnostic.source}</span>}
    </button>
  );
}

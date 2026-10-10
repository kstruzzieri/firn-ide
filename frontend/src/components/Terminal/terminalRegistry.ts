// Terminal session state that outlives TerminalContent: the output routing
// for every PTY and each session's xterm. It is kept out of Terminal.tsx so
// that a Fast Refresh of the component module re-runs none of it; a second
// registry would open a second xterm over a session's live one (#275).

import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useIDEStore } from '../../stores/ideStore';
import { WriteTerminal, ResizeTerminal } from '../../wails/bindings';
import { EventsOn } from '../../wails/runtime';
import { createShellIntegration, type ShellIntegration } from './shellIntegration';
import { XTERM_OPTIONS } from './xtermConfig';

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

export function ensureGlobalOutputListener() {
  if (globalOutputCleanup) return;
  globalOutputCleanup = EventsOn('terminal:output', (evt: { termId: string; data: string }) => {
    if (!evt?.termId) return;
    const listener = outputListeners.get(evt.termId);
    if (listener) {
      listener(evt.data ?? '');
    } else {
      // Buffer output until a listener attaches
      let buf = outputBuffers.get(evt.termId);
      if (!buf) {
        buf = [];
        outputBuffers.set(evt.termId, buf);
      }
      buf.push(evt.data ?? '');
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

export function cleanupSessionBuffers(sessionId: string) {
  outputBuffers.delete(sessionId);
  outputListeners.delete(sessionId);
}

interface RetainedTerminal {
  term: XTerm;
  fitAddon: FitAddon;
  shellIntegration: ShellIntegration;
}

// Each session's xterm lives here rather than in TerminalContent: IDEShell
// unmounts the whole bottom panel on collapse, and disposing the xterm there
// threw away its scrollback (#275). Its lifetime follows the session's place
// in the store, so it is disposed when the session leaves terminalSessions.
const retainedTerminals = new Map<string, RetainedTerminal>();
let pruningRetainedTerminals = false;

function ensureRetainedTerminalPruning() {
  if (pruningRetainedTerminals) return;
  pruningRetainedTerminals = true;
  useIDEStore.subscribe((state, prev) => {
    if (state.terminalSessions === prev.terminalSessions) return;
    for (const [sessionId, retained] of retainedTerminals) {
      if (state.terminalSessions.some((session) => session.id === sessionId)) continue;
      outputListeners.delete(sessionId);
      retained.shellIntegration.dispose();
      retained.term.dispose();
      retainedTerminals.delete(sessionId);
    }
  });
}

export function acquireTerminal(sessionId: string, container: HTMLElement) {
  const retained = retainedTerminals.get(sessionId);
  if (retained) {
    // open() on an opened xterm is a no-op, so move its element by hand.
    if (retained.term.element) container.appendChild(retained.term.element);
    fitToContainer(sessionId);
    return;
  }

  const term = new XTerm(XTERM_OPTIONS);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  // Register the OSC 133 handler before replaying buffered output, so early
  // shell-integration sequences (prompt/exit markers) are parsed, not printed.
  const shellIntegration = createShellIntegration(term, SHELL_INTEGRATION_COLORS);
  retainedTerminals.set(sessionId, { term, fitAddon, shellIntegration });
  ensureRetainedTerminalPruning();
  // Size before the replay below, so early output lays out at the real width.
  fitToContainer(sessionId);
  // Output keeps flowing into the xterm while the panel is collapsed.
  attachSessionListener(sessionId, (data: string) => {
    term.write(data);
  });
  term.onData((data) => {
    void WriteTerminal(sessionId, data);
  });
}

// A container outside the layout (display: none on it or an ancestor) has no
// size to fit to, and FitAddon would then shrink the xterm and, through
// ResizeTerminal, the PTY to a sliver that reflows the shell (#275).
export function fitToContainer(sessionId: string) {
  const retained = retainedTerminals.get(sessionId);
  const container = retained?.term.element?.parentElement;
  if (!retained || !container || container.clientWidth === 0 || container.clientHeight === 0) {
    return;
  }
  retained.fitAddon.fit();
  void ResizeTerminal(sessionId, retained.term.rows, retained.term.cols);
}

import type { ITerminalOptions } from '@xterm/xterm';

const TERMINAL_ACCENT = '#38BDF8'; // Glacier blue — brand anchor

// Frozen: one module-level options object is shared by every terminal session,
// and xterm holds `theme` by reference — a stray mutation would silently
// restyle all sessions and bypass xterm's theme setter.
const XTERM_THEME = Object.freeze({
  background: '#040406', // Near-black void (glacier glow)
  foreground: '#E2E8F0', // slate-200
  cursor: TERMINAL_ACCENT,
  cursorAccent: '#040406',
  selectionBackground: `${TERMINAL_ACCENT}33`,
  black: '#030712', // gray-950
  red: '#FCA5A5', // red-300
  green: '#86EFAC', // green-300
  yellow: '#FDE68A', // amber-200
  blue: '#7DD3FC', // sky-300
  magenta: '#D8B4FE', // purple-300
  cyan: '#67E8F9', // cyan-300
  white: '#E2E8F0', // slate-200
  brightBlack: '#64748B', // slate-500
  brightRed: '#FDA4AF', // rose-300
  brightGreen: '#A7F3D0', // emerald-200
  brightYellow: '#FEF3C7', // amber-100
  brightBlue: '#BAE6FD', // sky-200
  brightMagenta: '#E9D5FF', // purple-200
  brightCyan: '#A5F3FC', // cyan-200
  brightWhite: '#F8FAFC', // slate-50
});

export const XTERM_OPTIONS: ITerminalOptions = Object.freeze({
  // registerDecoration (shell-integration gutter markers) is proposed API in
  // @xterm/xterm 6. Without this flag the OSC 133 'D' handler throws inside
  // xterm's parser, which permanently stalls its write loop — the terminal
  // stops rendering all output after the first command completes.
  allowProposedApi: true,
  theme: XTERM_THEME,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 13.5,
  fontWeight: 500,
  lineHeight: 1.3,
  letterSpacing: 0,
});

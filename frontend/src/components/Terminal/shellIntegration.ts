// OSC 133 shell-integration: parse semantic-prompt sequences and render gutter
// markers (red = failed, neutral = success) plus separators between command
// blocks. Parsing lives entirely in xterm; this only consumes 133 events.

export interface ShellIntegrationColors {
  fail: string;
  ok: string;
  separator: string;
}

export interface ShellIntegration {
  dispose(): void;
}

interface Disposable {
  dispose(): void;
}

interface Marker extends Disposable {
  dispose(): void;
}

interface Decoration extends Disposable {
  onRender(cb: (el: HTMLElement) => void): void;
}

// Structural subset of xterm's Terminal we depend on — lets tests pass a fake
// and the real Terminal satisfy the same shape.
export interface IntegrationTerminal {
  cols: number;
  parser: {
    registerOscHandler(ident: number, cb: (data: string) => boolean): Disposable;
  };
  registerMarker(): Marker | undefined;
  registerDecoration(opts: { marker: Marker; x?: number; width?: number }): Decoration | undefined;
}

interface PromptBlock {
  marker: Marker;
  executed: boolean;
  decorated: boolean;
}

export function createShellIntegration(
  term: IntegrationTerminal,
  colors: ShellIntegrationColors
): ShellIntegration {
  let current: PromptBlock | null = null;
  let decoratedCount = 0;
  const tracked: Disposable[] = [];
  const markers: Marker[] = [];

  // Fail open: xterm.open() may not initialize the parser in headless/jsdom
  // environments (term.parser is undefined). Without the OSC parser there is
  // nothing to integrate, so degrade to a no-op rather than crash the mount.
  const parser = term.parser as IntegrationTerminal['parser'] | undefined;
  if (!parser || typeof parser.registerOscHandler !== 'function') {
    return { dispose() {} };
  }

  const handler = parser.registerOscHandler(133, (data: string): boolean => {
    const parts = data.split(';');
    switch (parts[0]) {
      case 'A': {
        // Drop a stale marker from a prompt that ran no command (empty enters).
        if (current && !current.executed && !current.decorated) {
          current.marker.dispose();
        }
        const marker = term.registerMarker();
        if (marker) markers.push(marker);
        current = marker ? { marker, executed: false, decorated: false } : null;
        break;
      }
      case 'C':
        if (current) current.executed = true;
        break;
      case 'D':
        if (current && current.executed && !current.decorated) {
          const exit = Number.parseInt(parts[1] ?? '0', 10);
          const failed = !Number.isNaN(exit) && exit !== 0;
          decorate(current.marker, failed, decoratedCount > 0);
          current.decorated = true;
          decoratedCount += 1;
        }
        break;
    }
    return true; // handled — xterm will not print the sequence
  });

  function decorate(marker: Marker, failed: boolean, withSeparator: boolean): void {
    const bar = term.registerDecoration({ marker, x: 0, width: 1 });
    if (bar) {
      bar.onRender((el) => {
        el.style.backgroundColor = failed ? colors.fail : colors.ok;
        el.style.width = '3px';
      });
      tracked.push(bar);
    }
    if (withSeparator) {
      const sep = term.registerDecoration({ marker, x: 0, width: term.cols });
      if (sep) {
        sep.onRender((el) => {
          el.style.borderTop = `1px solid ${colors.separator}`;
          el.style.pointerEvents = 'none';
        });
        tracked.push(sep);
      }
    }
  }

  return {
    dispose(): void {
      handler.dispose();
      for (const d of tracked) d.dispose();
      for (const marker of markers) marker.dispose();
      tracked.length = 0;
      markers.length = 0;
      current = null;
    },
  };
}

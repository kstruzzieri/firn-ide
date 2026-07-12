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
  // Fired when xterm disposes the marker (e.g. its line scrolls out of the
  // scrollback buffer). Optional: absent on minimal/test doubles.
  onDispose?(listener: () => void): void;
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
  decorations: Decoration[];
}

export function createShellIntegration(
  term: IntegrationTerminal,
  colors: ShellIntegrationColors
): ShellIntegration {
  let current: PromptBlock | null = null;
  let decoratedCount = 0;
  // Live command blocks. Pruned as xterm disposes their markers (lines scrolling
  // out of scrollback), so this stays bounded over a long-lived terminal.
  const blocks = new Set<PromptBlock>();

  // Fail open: xterm.open() may not initialize the parser in headless/jsdom
  // environments (term.parser is undefined). Without the OSC parser there is
  // nothing to integrate, so degrade to a no-op rather than crash the mount.
  const parser = term.parser as IntegrationTerminal['parser'] | undefined;
  if (!parser || typeof parser.registerOscHandler !== 'function') {
    return { dispose() {} };
  }

  let warned = false;

  const handler = parser.registerOscHandler(133, (data: string): boolean => {
    // An exception escaping an OSC handler kills xterm's write loop: the
    // terminal permanently stops rendering output (it looks wedged, while the
    // shell stays alive). Decorations are cosmetic — contain any failure here.
    try {
      handle(data);
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn('Shell integration marker failed; continuing without decorations.', err);
      }
    }
    return true; // handled — xterm will not print the sequence
  });

  function handle(data: string): void {
    const parts = data.split(';');
    switch (parts[0]) {
      case 'A': {
        // Drop a stale marker from a prompt that ran no command (empty enters).
        if (current && !current.executed && !current.decorated) {
          discard(current);
        }
        const marker = term.registerMarker();
        if (marker) {
          const block: PromptBlock = { marker, executed: false, decorated: false, decorations: [] };
          blocks.add(block);
          // When xterm disposes the marker, drop our reference so blocks stays bounded.
          marker.onDispose?.(() => blocks.delete(block));
          current = block;
        } else {
          current = null;
        }
        break;
      }
      case 'C':
        if (current) current.executed = true;
        break;
      case 'D':
        if (current && current.executed && !current.decorated) {
          const exit = Number.parseInt(parts[1] ?? '0', 10);
          const failed = !Number.isNaN(exit) && exit !== 0;
          decorate(current, failed, decoratedCount > 0);
          current.decorated = true;
          decoratedCount += 1;
        }
        break;
    }
  }

  function discard(block: PromptBlock): void {
    for (const d of block.decorations) d.dispose();
    block.marker.dispose();
    blocks.delete(block);
  }

  function decorate(block: PromptBlock, failed: boolean, withSeparator: boolean): void {
    const bar = term.registerDecoration({ marker: block.marker, x: 0, width: 1 });
    if (bar) {
      bar.onRender((el) => {
        el.style.backgroundColor = failed ? colors.fail : colors.ok;
        el.style.width = '3px';
      });
      block.decorations.push(bar);
    }
    if (withSeparator) {
      // ponytail: separator width is fixed at the column count when drawn; it
      // does not re-flow if the terminal is later resized wider. Fine for a hairline.
      const sep = term.registerDecoration({ marker: block.marker, x: 0, width: term.cols });
      if (sep) {
        sep.onRender((el) => {
          el.style.borderTop = `1px solid ${colors.separator}`;
          el.style.pointerEvents = 'none';
        });
        block.decorations.push(sep);
      }
    }
  }

  return {
    dispose(): void {
      handler.dispose();
      for (const block of blocks) {
        for (const d of block.decorations) d.dispose();
        block.marker.dispose();
      }
      blocks.clear();
      current = null;
    },
  };
}

import { createShellIntegration, type IntegrationTerminal } from './shellIntegration';

const COLORS = { fail: '#F87171', ok: '#334155', separator: 'rgba(148,163,184,0.2)' };

interface FakeDecoration {
  opts: { marker: unknown; x?: number; width?: number };
  el: HTMLElement;
  render: () => void;
  disposed: boolean;
}

function makeFakeTerm() {
  const markers: { disposed: boolean; dispose(): void }[] = [];
  const decorations: FakeDecoration[] = [];
  let osc: ((data: string) => boolean) | null = null;

  const term: IntegrationTerminal = {
    cols: 80,
    parser: {
      registerOscHandler: (_id, cb) => {
        osc = cb;
        return { dispose: () => {} };
      },
    },
    registerMarker: () => {
      const listeners: Array<() => void> = [];
      const m = {
        disposed: false,
        dispose() {
          this.disposed = true;
          for (const l of listeners) l();
        },
        onDispose(cb: () => void) {
          listeners.push(cb);
        },
      };
      markers.push(m);
      return m;
    },
    registerDecoration: (opts) => {
      let cb: ((el: HTMLElement) => void) | null = null;
      const el = document.createElement('div');
      const d: FakeDecoration = {
        opts,
        el,
        render: () => cb?.(el),
        disposed: false,
      };
      decorations.push(d);
      return {
        onRender: (fn) => {
          cb = fn;
        },
        dispose() {
          d.disposed = true;
        },
      };
    },
  };

  return {
    term,
    markers,
    decorations,
    fire: (d: string) => osc?.(d),
  };
}

describe('createShellIntegration', () => {
  it('decorates an executed command marker, red on non-zero exit', () => {
    const f = makeFakeTerm();
    createShellIntegration(f.term, COLORS);
    f.fire('A');
    f.fire('C');
    f.fire('D;1');
    const bar = f.decorations[0];
    expect(bar).toBeDefined();
    bar.render();
    expect(bar.el.style.backgroundColor).toBe('rgb(248, 113, 113)'); // #F87171
  });

  it('uses neutral color on zero exit', () => {
    const f = makeFakeTerm();
    createShellIntegration(f.term, COLORS);
    f.fire('A');
    f.fire('C');
    f.fire('D;0');
    const bar = f.decorations[0];
    bar.render();
    expect(bar.el.style.backgroundColor).toBe('rgb(51, 65, 85)'); // #334155
  });

  it('ignores a D with no preceding A', () => {
    const f = makeFakeTerm();
    createShellIntegration(f.term, COLORS);
    f.fire('D;1');
    expect(f.decorations).toHaveLength(0);
  });

  it('does not decorate a prompt with no command (no C)', () => {
    const f = makeFakeTerm();
    createShellIntegration(f.term, COLORS);
    f.fire('A');
    f.fire('D;0');
    expect(f.decorations).toHaveLength(0);
  });

  it('disposes the stale undecorated marker on repeated empty enters', () => {
    const f = makeFakeTerm();
    createShellIntegration(f.term, COLORS);
    f.fire('A'); // marker 0
    f.fire('A'); // marker 1 — marker 0 was never executed/decorated
    expect(f.markers[0].disposed).toBe(true);
    expect(f.markers[1].disposed).toBe(false);
  });

  it('decorates each executed marker only once', () => {
    const f = makeFakeTerm();
    createShellIntegration(f.term, COLORS);
    f.fire('A');
    f.fire('C');
    f.fire('D;1');
    f.fire('D;1'); // duplicate D for same marker
    // one gutter + (no separator on first decorated command) = 1 decoration
    expect(f.decorations).toHaveLength(1);
  });

  it('draws a separator on the second and later executed commands', () => {
    const f = makeFakeTerm();
    createShellIntegration(f.term, COLORS);
    // first command
    f.fire('A');
    f.fire('C');
    f.fire('D;0');
    // second command
    f.fire('A');
    f.fire('C');
    f.fire('D;0');
    // 1 (first: gutter only) + 2 (second: gutter + separator) = 3
    expect(f.decorations).toHaveLength(3);
    const sep = f.decorations[2];
    sep.render();
    expect(sep.el.style.borderTop).toContain('1px solid');
  });

  it('prunes a finished command block when its marker is disposed (scrolled out)', () => {
    const f = makeFakeTerm();
    const integ = createShellIntegration(f.term, COLORS);
    f.fire('A');
    f.fire('C');
    f.fire('D;1'); // block decorated, marker 0 + decoration 0 retained
    // xterm disposes the marker when its line scrolls out of the scrollback buffer.
    f.markers[0].dispose();
    // The block is pruned, so a later dispose() no longer touches its decoration.
    integ.dispose();
    expect(f.decorations[0].disposed).toBe(false);
  });

  it('fails open when the terminal exposes no OSC parser (headless/jsdom)', () => {
    // Under jsdom (and any env where xterm.open() cannot fully init), term.parser
    // is undefined. Integration must degrade to a no-op, not crash the mount.
    const noParser = {
      cols: 80,
      registerMarker: () => undefined,
      registerDecoration: () => undefined,
    } as unknown as IntegrationTerminal;
    let integ: ReturnType<typeof createShellIntegration> | undefined;
    expect(() => {
      integ = createShellIntegration(noParser, COLORS);
    }).not.toThrow();
    expect(() => integ?.dispose()).not.toThrow();
  });

  it('never propagates a decoration failure into the OSC parser (wedge regression)', () => {
    // Real-world failure: registerDecoration is proposed API in @xterm/xterm 6
    // and throws without allowProposedApi. An exception escaping the OSC 133
    // handler kills xterm's write loop permanently — the terminal stops
    // rendering all further output (and looks completely wedged). The handler
    // must contain any decoration error.
    const f = makeFakeTerm();
    f.term.registerDecoration = () => {
      throw new Error('You must set the allowProposedApi option to true to use proposed API');
    };
    createShellIntegration(f.term, COLORS);
    f.fire('A');
    f.fire('C');
    expect(() => f.fire('D;0')).not.toThrow();
    // The parser must keep working for subsequent commands.
    expect(() => {
      f.fire('A');
      f.fire('C');
      f.fire('D;1');
    }).not.toThrow();
  });

  it('dispose() tears down handler, markers and decorations', () => {
    const f = makeFakeTerm();
    const integ = createShellIntegration(f.term, COLORS);
    f.fire('A');
    f.fire('C');
    f.fire('D;1');
    integ.dispose();
    expect(f.markers[0].disposed).toBe(true);
    expect(f.decorations[0].disposed).toBe(true);
  });
});

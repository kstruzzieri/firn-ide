import { act, fireEvent, render, screen } from '@testing-library/react';
import { LanesView, clampSplit, mirrorScrollTop } from '../../../components/RunOutput/LanesView';
import type { OutputEntry } from '../../../types/runOutput';

// LanesView renders OutputLine, which imports the generated Wails bindings via
// editorNavigation; mock it so the suite doesn't load untransformed ESM.
jest.mock('../../../utils/editorNavigation', () => ({
  navigateToEditorLocation: jest.fn(),
}));

const entry = (stream: 'stdout' | 'stderr', text: string): OutputEntry => ({
  stream,
  text,
  timestamp: 0,
});

describe('clampSplit', () => {
  it('keeps a usable split in range', () => {
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(0.05)).toBe(0.2); // below min
    expect(clampSplit(0.95)).toBe(0.8); // above max
    expect(clampSplit(NaN)).toBe(0.5); // bad persisted value falls back
  });
});

describe('mirrorScrollTop', () => {
  it('maps the source scroll fraction onto the target range', () => {
    // Source scrolled to 50% of its range -> target lands at 50% of its own.
    expect(
      mirrorScrollTop(
        { scrollTop: 50, scrollHeight: 200, clientHeight: 100 },
        { scrollHeight: 400, clientHeight: 100 }
      )
    ).toBe(150);
  });

  it('keeps the target at the top when the source is at the top', () => {
    expect(
      mirrorScrollTop(
        { scrollTop: 0, scrollHeight: 200, clientHeight: 100 },
        { scrollHeight: 400, clientHeight: 100 }
      )
    ).toBe(0);
  });

  it('returns 0 when the source cannot scroll', () => {
    expect(
      mirrorScrollTop(
        { scrollTop: 0, scrollHeight: 80, clientHeight: 100 },
        { scrollHeight: 400, clientHeight: 100 }
      )
    ).toBe(0);
  });
});

describe('LanesView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders both lane headers and a resize separator', () => {
    render(
      <LanesView
        entries={[entry('stdout', 'building'), entry('stderr', 'warning')]}
        autoScroll={false}
      />
    );

    expect(screen.getByText('stdout')).toBeInTheDocument();
    expect(screen.getByText('stderr')).toBeInTheDocument();
    expect(
      screen.getByRole('separator', { name: 'Resize stdout and stderr lanes' })
    ).toBeInTheDocument();
  });

  it('gives each stream its own independent scroll column', () => {
    const { container } = render(
      <LanesView
        entries={[entry('stdout', 'banner'), entry('stderr', 'noise')]}
        autoScroll={false}
      />
    );

    const stdoutCol = container.querySelector('[data-stream="stdout"]');
    const stderrCol = container.querySelector('[data-stream="stderr"]');
    expect(stdoutCol).toBeInTheDocument();
    expect(stderrCol).toBeInTheDocument();
    // Distinct elements -> distinct scrollbars, so neither lane is masked by the other.
    expect(stdoutCol).not.toBe(stderrCol);
  });

  it('defaults the sync-scroll toggle off and persists it when enabled', () => {
    render(
      <LanesView
        entries={[entry('stdout', 'building'), entry('stderr', 'warning')]}
        autoScroll={false}
      />
    );

    const toggle = screen.getByRole('button', { name: /sync scroll/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('firn.lanesSyncScroll')).toBe('true');
  });

  it('restores a persisted sync-scroll preference on mount', () => {
    localStorage.setItem('firn.lanesSyncScroll', 'true');

    render(
      <LanesView
        entries={[entry('stdout', 'building'), entry('stderr', 'warning')]}
        autoScroll={false}
      />
    );

    expect(screen.getByRole('button', { name: /sync scroll/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  // jsdom can't lay out the virtualizers, so give the columns explicit scroll
  // geometry to exercise the ratio-coupling wiring (onScroll -> sibling moves).
  const setupCoupledLanes = () => {
    const { container } = render(
      <LanesView
        entries={[entry('stdout', 'banner'), entry('stderr', 'noise')]}
        autoScroll={false}
      />
    );
    const stdoutCol = container.querySelector('[data-stream="stdout"]') as HTMLElement;
    const stderrCol = container.querySelector('[data-stream="stderr"]') as HTMLElement;
    const geometry = (el: HTMLElement, scrollHeight: number) => {
      Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
      Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    };
    geometry(stdoutCol, 1000); // scrollable range 900
    geometry(stderrCol, 500); // scrollable range 400
    return { stdoutCol, stderrCol };
  };

  it('drives the sibling lane by scroll fraction when sync is on', () => {
    const { stdoutCol, stderrCol } = setupCoupledLanes();

    fireEvent.click(screen.getByRole('button', { name: /sync scroll/i }));

    stdoutCol.scrollTop = 450; // 50% of its 900px range
    fireEvent.scroll(stdoutCol);

    expect(stderrCol.scrollTop).toBe(200); // 50% of stderr's 400px range
  });

  it('leaves the sibling lane untouched when sync is off', () => {
    const { stdoutCol, stderrCol } = setupCoupledLanes();

    stdoutCol.scrollTop = 450;
    fireEvent.scroll(stdoutCol);

    expect(stderrCol.scrollTop).toBe(0);
  });

  it('stops resizing when the window loses focus', () => {
    render(
      <LanesView
        entries={[entry('stdout', 'building'), entry('stderr', 'warning')]}
        autoScroll={false}
      />
    );

    const separator = screen.getByRole('separator', {
      name: 'Resize stdout and stderr lanes',
    });
    const body = separator.parentElement as HTMLDivElement;
    body.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 100,
      }) as DOMRect;

    fireEvent.pointerDown(separator, { clientX: 50 });
    act(() => {
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 80 }));
    });
    expect(separator).toHaveStyle({ left: '80%' });

    fireEvent.blur(window);
    act(() => {
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 20 }));
    });
    expect(separator).toHaveStyle({ left: '80%' });
  });

  it('resizes from the keyboard', () => {
    render(
      <LanesView
        entries={[entry('stdout', 'building'), entry('stderr', 'warning')]}
        autoScroll={false}
      />
    );

    const separator = screen.getByRole('separator', {
      name: 'Resize stdout and stderr lanes',
    });

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveStyle({ left: '51%' });
    expect(separator).toHaveAttribute('aria-valuenow', '51');

    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveStyle({ left: '80%' });
    expect(separator).toHaveAttribute('aria-valuenow', '80');
  });
});

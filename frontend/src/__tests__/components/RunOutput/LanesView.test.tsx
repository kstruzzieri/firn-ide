import { act, fireEvent, render, screen } from '@testing-library/react';
import { LanesView, clampSplit } from '../../../components/RunOutput/LanesView';
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
    const scrollParent = separator.parentElement?.parentElement as HTMLDivElement;
    scrollParent.getBoundingClientRect = () =>
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

import { renderHook, act } from '@testing-library/react';
import { useResize } from '../../hooks/useResize';

// Mock document.documentElement.style.setProperty
const setPropertySpy = jest.spyOn(document.documentElement.style, 'setProperty');

beforeEach(() => {
  setPropertySpy.mockClear();
  // Set initial CSS var value
  document.documentElement.style.setProperty('--panel-left-width', '260px');
});

describe('useResize', () => {
  it('should return onMouseDown handler', () => {
    const { result } = renderHook(() =>
      useResize({
        direction: 'horizontal',
        cssVar: '--panel-left-width',
        min: 150,
        max: 500,
      })
    );

    expect(result.current.onMouseDown).toBeDefined();
    expect(typeof result.current.onMouseDown).toBe('function');
  });

  it('should update CSS variable on horizontal drag', () => {
    const { result } = renderHook(() =>
      useResize({
        direction: 'horizontal',
        cssVar: '--panel-left-width',
        min: 150,
        max: 500,
      })
    );

    // Simulate mousedown
    act(() => {
      result.current.onMouseDown({
        clientX: 260,
        clientY: 0,
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    // Simulate mousemove
    act(() => {
      const event = new MouseEvent('mousemove', { clientX: 310, clientY: 0 });
      document.dispatchEvent(event);
    });

    // Should have updated the CSS var (260 + 50 = 310)
    expect(setPropertySpy).toHaveBeenCalledWith('--panel-left-width', '310px');
  });

  it('should clamp to minimum value', () => {
    const { result } = renderHook(() =>
      useResize({
        direction: 'horizontal',
        cssVar: '--panel-left-width',
        min: 150,
        max: 500,
      })
    );

    act(() => {
      result.current.onMouseDown({
        clientX: 260,
        clientY: 0,
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    // Drag far left (260 - 200 = 60, below min 150)
    act(() => {
      const event = new MouseEvent('mousemove', { clientX: 60, clientY: 0 });
      document.dispatchEvent(event);
    });

    expect(setPropertySpy).toHaveBeenCalledWith('--panel-left-width', '150px');
  });

  it('should clamp to maximum value', () => {
    const { result } = renderHook(() =>
      useResize({
        direction: 'horizontal',
        cssVar: '--panel-left-width',
        min: 150,
        max: 500,
      })
    );

    act(() => {
      result.current.onMouseDown({
        clientX: 260,
        clientY: 0,
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    // Drag far right (260 + 300 = 560, above max 500)
    act(() => {
      const event = new MouseEvent('mousemove', { clientX: 560, clientY: 0 });
      document.dispatchEvent(event);
    });

    expect(setPropertySpy).toHaveBeenCalledWith('--panel-left-width', '500px');
  });

  it('should stop updating after mouseup', () => {
    const { result } = renderHook(() =>
      useResize({
        direction: 'horizontal',
        cssVar: '--panel-left-width',
        min: 150,
        max: 500,
      })
    );

    act(() => {
      result.current.onMouseDown({
        clientX: 260,
        clientY: 0,
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    // Mouseup to stop dragging
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    setPropertySpy.mockClear();

    // Further mousemove should not update
    act(() => {
      const event = new MouseEvent('mousemove', { clientX: 400, clientY: 0 });
      document.dispatchEvent(event);
    });

    // setProperty should NOT have been called with our var after mouseup
    const calls = setPropertySpy.mock.calls.filter((c) => c[0] === '--panel-left-width');
    expect(calls).toHaveLength(0);
  });

  it('should clean up event listeners on unmount during active drag', () => {
    const { result, unmount } = renderHook(() =>
      useResize({
        direction: 'horizontal',
        cssVar: '--panel-left-width',
        min: 150,
        max: 500,
      })
    );

    // Start a drag
    act(() => {
      result.current.onMouseDown({
        clientX: 260,
        clientY: 0,
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    setPropertySpy.mockClear();

    // Unmount while drag is active
    unmount();

    // Further mousemove should not update (listeners cleaned up)
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 0 }));
    });

    const calls = setPropertySpy.mock.calls.filter((c) => c[0] === '--panel-left-width');
    expect(calls).toHaveLength(0);
  });

  it('should resize via keyboard arrow keys', () => {
    const { result } = renderHook(() =>
      useResize({
        direction: 'horizontal',
        cssVar: '--panel-left-width',
        min: 150,
        max: 500,
      })
    );

    // Press ArrowRight to increase size
    act(() => {
      result.current.onKeyDown({
        key: 'ArrowRight',
        preventDefault: jest.fn(),
      } as unknown as React.KeyboardEvent);
    });

    // 260 + 20 = 280
    expect(setPropertySpy).toHaveBeenCalledWith('--panel-left-width', '280px');
  });

  it('should clamp keyboard resize to min/max', () => {
    // Set near max
    document.documentElement.style.setProperty('--panel-left-width', '495px');

    const { result } = renderHook(() =>
      useResize({
        direction: 'horizontal',
        cssVar: '--panel-left-width',
        min: 150,
        max: 500,
      })
    );

    // Press ArrowRight — 495 + 20 = 515, clamped to 500
    act(() => {
      result.current.onKeyDown({
        key: 'ArrowRight',
        preventDefault: jest.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(setPropertySpy).toHaveBeenCalledWith('--panel-left-width', '500px');
  });

  it('should invert direction for right panel', () => {
    document.documentElement.style.setProperty('--panel-right-width', '280px');

    const { result } = renderHook(() =>
      useResize({
        direction: 'horizontal',
        cssVar: '--panel-right-width',
        min: 150,
        max: 500,
        inverted: true,
      })
    );

    act(() => {
      result.current.onMouseDown({
        clientX: 500,
        clientY: 0,
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    // Drag left by 50px — inverted means panel gets LARGER
    act(() => {
      const event = new MouseEvent('mousemove', { clientX: 450, clientY: 0 });
      document.dispatchEvent(event);
    });

    expect(setPropertySpy).toHaveBeenCalledWith('--panel-right-width', '330px');
  });
});

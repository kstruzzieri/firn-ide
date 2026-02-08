import { useCallback, useEffect, useRef } from 'react';

export interface UseResizeOptions {
  /** Drag direction */
  direction: 'horizontal' | 'vertical';
  /** CSS custom property to update (e.g. '--panel-left-width') */
  cssVar: string;
  /** Minimum panel size in px */
  min: number;
  /** Maximum panel size in px */
  max: number;
  /** Invert drag direction (for right/bottom panels where dragging left/up increases size) */
  inverted?: boolean;
  /** Callback fired when resize completes (mouseup or keyboard pause) with the final size */
  onResizeEnd?: (size: number) => void;
}

/** Step size in px for keyboard-based resize */
const KEYBOARD_STEP = 20;
/** Delay before firing onResizeEnd for keyboard resize (ms) */
const KEYBOARD_RESIZE_END_DELAY = 300;

/** Read current pixel size from a CSS custom property */
export function readCssVarSize(cssVar: string): number {
  if (typeof document === 'undefined') return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar);
  return parseInt(value, 10) || 0;
}

export function useResize({
  direction,
  cssVar,
  min,
  max,
  inverted = false,
  onResizeEnd,
}: UseResizeOptions) {
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onResizeEndRef = useRef(onResizeEnd);
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep onResizeEnd ref in sync with latest callback
  useEffect(() => {
    onResizeEndRef.current = onResizeEnd;
  }, [onResizeEnd]);

  // Clean up any active drag listeners and keyboard timer on unmount
  useEffect(() => {
    return () => {
      if (keyboardTimerRef.current) {
        clearTimeout(keyboardTimerRef.current);
        keyboardTimerRef.current = null;
      }
      if (cleanupRef.current) {
        // Fire onResizeEnd with current size before cleanup so state is persisted
        const finalSize = readCssVarSize(cssVar);
        cleanupRef.current();
        cleanupRef.current = null;
        onResizeEndRef.current?.(finalSize);
      }
    };
    // cssVar is stable for the lifetime of a given ResizeHandle instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      // Guard: tear down any existing drag session before starting a new one
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      isDragging.current = true;
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;

      startSize.current = readCssVarSize(cssVar);

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;

        const currentPos = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
        const delta = currentPos - startPos.current;
        const newSize = inverted ? startSize.current - delta : startSize.current + delta;
        const clamped = Math.min(max, Math.max(min, newSize));

        document.documentElement.style.setProperty(cssVar, `${clamped}px`);
      };

      const cleanup = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
        cleanupRef.current = null;
      };

      const onMouseUp = () => {
        const finalSize = readCssVarSize(cssVar);
        cleanup();
        onResizeEndRef.current?.(finalSize);
      };

      // Set cursor for the entire document during drag
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      // Store cleanup for unmount safety
      cleanupRef.current = cleanup;
    },
    [direction, cssVar, min, max, inverted]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isHorizontal = direction === 'horizontal';
      let delta = 0;

      if (isHorizontal) {
        if (e.key === 'ArrowLeft') delta = inverted ? KEYBOARD_STEP : -KEYBOARD_STEP;
        else if (e.key === 'ArrowRight') delta = inverted ? -KEYBOARD_STEP : KEYBOARD_STEP;
      } else {
        if (e.key === 'ArrowUp') delta = inverted ? KEYBOARD_STEP : -KEYBOARD_STEP;
        else if (e.key === 'ArrowDown') delta = inverted ? -KEYBOARD_STEP : KEYBOARD_STEP;
      }

      if (delta === 0) return;

      e.preventDefault();
      const currentSize = readCssVarSize(cssVar);
      const clamped = Math.min(max, Math.max(min, currentSize + delta));
      document.documentElement.style.setProperty(cssVar, `${clamped}px`);

      // Debounce onResizeEnd for keyboard: fires after user stops pressing keys
      if (keyboardTimerRef.current) {
        clearTimeout(keyboardTimerRef.current);
      }
      keyboardTimerRef.current = setTimeout(() => {
        keyboardTimerRef.current = null;
        onResizeEndRef.current?.(clamped);
      }, KEYBOARD_RESIZE_END_DELAY);
    },
    [direction, cssVar, min, max, inverted]
  );

  return { onMouseDown, onKeyDown };
}

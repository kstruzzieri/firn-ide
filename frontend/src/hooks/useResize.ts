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
}

/** Step size in px for keyboard-based resize */
const KEYBOARD_STEP = 20;

export function useResize({ direction, cssVar, min, max, inverted = false }: UseResizeOptions) {
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Clean up any active drag listeners on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;

      // Read current size from CSS var
      const currentValue = getComputedStyle(document.documentElement).getPropertyValue(cssVar);
      startSize.current = parseInt(currentValue, 10) || 0;

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
        cleanup();
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
      const currentValue = getComputedStyle(document.documentElement).getPropertyValue(cssVar);
      const currentSize = parseInt(currentValue, 10) || 0;
      const clamped = Math.min(max, Math.max(min, currentSize + delta));
      document.documentElement.style.setProperty(cssVar, `${clamped}px`);
    },
    [direction, cssVar, min, max, inverted]
  );

  return { onMouseDown, onKeyDown };
}

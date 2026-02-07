import { useCallback, useRef } from 'react';

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

export function useResize({ direction, cssVar, min, max, inverted = false }: UseResizeOptions) {
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

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

      const onMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
      };

      // Set cursor for the entire document during drag
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [direction, cssVar, min, max, inverted]
  );

  return { onMouseDown };
}

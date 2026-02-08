import { useResize } from '../../hooks/useResize';
import { ChevronRightIcon, ChevronDownIcon } from '../icons';
import styles from './ResizeHandle.module.css';

/** Stable style objects to avoid creating new references on each render */
const ROTATE_180 = { transform: 'rotate(180deg)' } as const;

interface ResizeHandleProps {
  /** Which boundary this handle controls */
  direction: 'horizontal' | 'vertical';
  /** CSS variable to update */
  cssVar: string;
  /** Minimum panel size */
  min: number;
  /** Maximum panel size */
  max: number;
  /** Invert drag (for right/bottom panels) */
  inverted?: boolean;
  /** Whether the associated panel is collapsed */
  isCollapsed?: boolean;
  /** Toggle collapse callback */
  onToggleCollapse?: () => void;
  /** Collapse chevron direction when panel is visible */
  collapseDirection?: 'left' | 'right' | 'up' | 'down';
  /** Callback fired when drag ends with the final size */
  onResizeEnd?: (size: number) => void;
  /** Current panel size from store (used for aria-valuenow) */
  panelSize?: number;
}

export function ResizeHandle({
  direction,
  cssVar,
  min,
  max,
  inverted = false,
  isCollapsed = false,
  onToggleCollapse,
  collapseDirection = 'left',
  onResizeEnd,
  panelSize = 0,
}: ResizeHandleProps) {
  const { onMouseDown, onKeyDown } = useResize({
    direction,
    cssVar,
    min,
    max,
    inverted,
    onResizeEnd,
  });

  const isHorizontal = direction === 'horizontal';

  // Determine chevron icon based on collapse state and direction
  const getChevronIcon = () => {
    if (isCollapsed) {
      // When collapsed, point toward the hidden panel (to expand)
      if (collapseDirection === 'left') return <ChevronRightIcon />;
      if (collapseDirection === 'right') return <ChevronRightIcon style={ROTATE_180} />;
      if (collapseDirection === 'up') return <ChevronDownIcon style={ROTATE_180} />;
      return <ChevronDownIcon />;
    }
    // When visible, point away from panel (to collapse)
    if (collapseDirection === 'left') return <ChevronRightIcon style={ROTATE_180} />;
    if (collapseDirection === 'right') return <ChevronRightIcon />;
    if (collapseDirection === 'up') return <ChevronDownIcon />;
    return <ChevronDownIcon style={ROTATE_180} />;
  };

  const currentSize = isCollapsed ? 0 : panelSize;

  return (
    <div
      className={`${styles.handle} ${isHorizontal ? styles.horizontal : styles.vertical}`}
      data-testid="resize-handle"
    >
      <div
        className={styles.dragZone}
        onMouseDown={isCollapsed ? undefined : onMouseDown}
        onKeyDown={isCollapsed ? undefined : onKeyDown}
        role="separator"
        aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
        aria-label={`Resize ${cssVar.replace('--', '').replace(/-/g, ' ')}`}
        aria-valuenow={currentSize}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={isCollapsed ? -1 : 0}
      />
      {onToggleCollapse && (
        <button
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
          type="button"
        >
          {getChevronIcon()}
        </button>
      )}
    </div>
  );
}

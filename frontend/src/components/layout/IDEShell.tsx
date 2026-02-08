import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ToggleMaximize } from '../../../wailsjs/go/main/App';
import {
  useIDEStore,
  useIsLeftPanelCollapsed,
  useIsRightPanelCollapsed,
  useIsBottomPanelCollapsed,
} from '../../stores/ideStore';
import { ResizeHandle } from './ResizeHandle';
import styles from './IDEShell.module.css';

/** Maximum fraction of viewport a single panel may occupy */
const MAX_PANEL_FRACTION = 0.4;
/** Absolute ceiling in px (never exceed even on ultra-wide) */
const MAX_PANEL_PX = 600;
/** Minimum width reserved for the center editor */
const MIN_CENTER_WIDTH = 200;
/** Minimum panel size for horizontal panels */
const MIN_PANEL_WIDTH = 180;
/** Minimum panel size for bottom panel */
const MIN_PANEL_HEIGHT = 100;

/** Layout chrome dimensions matching CSS tokens */
const SIDEBAR_WIDTH = 56; // --sidebar-width
const HEADER_HEIGHT = 44; // --header-height
const STATUSBAR_HEIGHT = 26; // --statusbar-height
const CONTENT_PADDING = 6; // --content-padding (per side)
const PANEL_GAP = 6; // --panel-gap (resize handle width)

/** Horizontal layout overhead: left+right content padding + 2 horizontal resize handle gaps */
const HORIZONTAL_OVERHEAD = CONTENT_PADDING * 2 + PANEL_GAP * 2;
/** Vertical layout overhead: header + statusbar + top+bottom content padding + 1 vertical handle */
const VERTICAL_OVERHEAD = HEADER_HEIGHT + STATUSBAR_HEIGHT + CONTENT_PADDING * 2 + PANEL_GAP;

interface IDEShellProps {
  header: ReactNode;
  sidebar: ReactNode;
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
  bottomPanel: ReactNode;
  statusBar: ReactNode;
  accent?: 'project' | 'blue' | 'green' | 'cyan' | 'orange' | 'purple' | 'amber';
}

export function IDEShell({
  header,
  sidebar,
  leftPanel,
  centerPanel,
  rightPanel,
  bottomPanel,
  statusBar,
  accent = 'project',
}: IDEShellProps) {
  const isLeftPanelCollapsed = useIsLeftPanelCollapsed();
  const isRightPanelCollapsed = useIsRightPanelCollapsed();
  const isBottomPanelCollapsed = useIsBottomPanelCollapsed();
  const toggleLeftPanel = useIDEStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useIDEStore((s) => s.toggleRightPanel);
  const toggleBottomPanel = useIDEStore((s) => s.toggleBottomPanel);
  const setPanelSize = useIDEStore((s) => s.setPanelSize);
  const leftPanelSize = useIDEStore((s) => s.panelSizes.left);
  const rightPanelSize = useIDEStore((s) => s.panelSizes.right);
  const bottomPanelSize = useIDEStore((s) => s.panelSizes.bottom);

  // Track viewport dimensions for dynamic max constraints
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  useEffect(() => {
    let rafId: number;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setViewport({ width: window.innerWidth, height: window.innerHeight });
      });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  const handleHeaderDoubleClick = useCallback(() => {
    ToggleMaximize();
  }, []);

  // Dynamic max constraints: min of (absolute cap, fraction cap, available space), floored at min
  const maxLeft = useMemo(() => {
    const rightWidth = isRightPanelCollapsed ? 0 : rightPanelSize;
    const available =
      viewport.width - rightWidth - MIN_CENTER_WIDTH - SIDEBAR_WIDTH - HORIZONTAL_OVERHEAD;
    return Math.max(
      MIN_PANEL_WIDTH,
      Math.min(MAX_PANEL_PX, viewport.width * MAX_PANEL_FRACTION, available)
    );
  }, [isRightPanelCollapsed, rightPanelSize, viewport.width]);

  const maxRight = useMemo(() => {
    const leftWidth = isLeftPanelCollapsed ? 0 : leftPanelSize;
    const available =
      viewport.width - leftWidth - MIN_CENTER_WIDTH - SIDEBAR_WIDTH - HORIZONTAL_OVERHEAD;
    return Math.max(
      MIN_PANEL_WIDTH,
      Math.min(MAX_PANEL_PX, viewport.width * MAX_PANEL_FRACTION, available)
    );
  }, [isLeftPanelCollapsed, leftPanelSize, viewport.width]);

  const maxBottom = useMemo(() => {
    return Math.max(
      MIN_PANEL_HEIGHT,
      Math.min(MAX_PANEL_PX, viewport.height - VERTICAL_OVERHEAD - MIN_CENTER_WIDTH)
    );
  }, [viewport.height]);

  const handleLeftResizeEnd = useCallback(
    (size: number) => setPanelSize('left', size),
    [setPanelSize]
  );
  const handleRightResizeEnd = useCallback(
    (size: number) => setPanelSize('right', size),
    [setPanelSize]
  );
  const handleBottomResizeEnd = useCallback(
    (size: number) => setPanelSize('bottom', size),
    [setPanelSize]
  );

  return (
    <div
      className={styles.ide}
      data-accent={accent}
      data-left-collapsed={isLeftPanelCollapsed || undefined}
      data-right-collapsed={isRightPanelCollapsed || undefined}
      data-bottom-collapsed={isBottomPanelCollapsed || undefined}
    >
      <header className={styles.header} onDoubleClick={handleHeaderDoubleClick}>
        {header}
      </header>
      <aside className={styles.sidebar}>{sidebar}</aside>
      <main className={styles.content}>
        {!isLeftPanelCollapsed && <section className={styles.leftPanel}>{leftPanel}</section>}
        <ResizeHandle
          direction="horizontal"
          cssVar="--panel-left-width"
          min={MIN_PANEL_WIDTH}
          max={maxLeft}
          isCollapsed={isLeftPanelCollapsed}
          onToggleCollapse={toggleLeftPanel}
          collapseDirection="left"
          onResizeEnd={handleLeftResizeEnd}
          panelSize={leftPanelSize}
        />
        <div className={styles.centerArea}>
          <section className={styles.centerPanel}>{centerPanel}</section>
          <ResizeHandle
            direction="vertical"
            cssVar="--panel-bottom-height"
            min={MIN_PANEL_HEIGHT}
            max={maxBottom}
            inverted
            isCollapsed={isBottomPanelCollapsed}
            onToggleCollapse={toggleBottomPanel}
            collapseDirection="down"
            onResizeEnd={handleBottomResizeEnd}
            panelSize={bottomPanelSize}
          />
          {!isBottomPanelCollapsed && (
            <section className={styles.bottomPanel}>{bottomPanel}</section>
          )}
        </div>
        <ResizeHandle
          direction="horizontal"
          cssVar="--panel-right-width"
          min={MIN_PANEL_WIDTH}
          max={maxRight}
          inverted
          isCollapsed={isRightPanelCollapsed}
          onToggleCollapse={toggleRightPanel}
          collapseDirection="right"
          onResizeEnd={handleRightResizeEnd}
          panelSize={rightPanelSize}
        />
        {!isRightPanelCollapsed && <section className={styles.rightPanel}>{rightPanel}</section>}
      </main>
      <footer className={styles.statusBar}>{statusBar}</footer>
    </div>
  );
}

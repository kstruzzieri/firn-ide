import { ReactNode, useCallback } from 'react';
import { ToggleMaximize } from '../../../wailsjs/go/main/App';
import {
  useIDEStore,
  useIsLeftPanelCollapsed,
  useIsRightPanelCollapsed,
  useIsBottomPanelCollapsed,
} from '../../stores/ideStore';
import { ResizeHandle } from './ResizeHandle';
import styles from './IDEShell.module.css';

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

  const handleHeaderDoubleClick = useCallback(() => {
    ToggleMaximize();
  }, []);

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
          min={180}
          max={500}
          isCollapsed={isLeftPanelCollapsed}
          onToggleCollapse={toggleLeftPanel}
          collapseDirection="left"
        />
        <div className={styles.centerArea}>
          <section className={styles.centerPanel}>{centerPanel}</section>
          {!isBottomPanelCollapsed && (
            <>
              <ResizeHandle
                direction="vertical"
                cssVar="--panel-bottom-height"
                min={100}
                max={500}
                inverted
                isCollapsed={isBottomPanelCollapsed}
                onToggleCollapse={toggleBottomPanel}
                collapseDirection="down"
              />
              <section className={styles.bottomPanel}>{bottomPanel}</section>
            </>
          )}
        </div>
        <ResizeHandle
          direction="horizontal"
          cssVar="--panel-right-width"
          min={180}
          max={500}
          inverted
          isCollapsed={isRightPanelCollapsed}
          onToggleCollapse={toggleRightPanel}
          collapseDirection="right"
        />
        {!isRightPanelCollapsed && <section className={styles.rightPanel}>{rightPanel}</section>}
      </main>
      <footer className={styles.statusBar}>{statusBar}</footer>
    </div>
  );
}

import { ReactNode, useCallback } from 'react';
import { ToggleMaximize } from '../../../wailsjs/go/main/App';
import { useIsLeftPanelCollapsed } from '../../stores/ideStore';
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

  const handleHeaderDoubleClick = useCallback(() => {
    ToggleMaximize();
  }, []);

  return (
    <div
      className={styles.ide}
      data-accent={accent}
      data-left-collapsed={isLeftPanelCollapsed || undefined}
    >
      <header className={styles.header} onDoubleClick={handleHeaderDoubleClick}>
        {header}
      </header>
      <aside className={styles.sidebar}>{sidebar}</aside>
      <main className={styles.content}>
        {!isLeftPanelCollapsed && <section className={styles.leftPanel}>{leftPanel}</section>}
        <div className={styles.centerArea}>
          <section className={styles.centerPanel}>{centerPanel}</section>
          <section className={styles.bottomPanel}>{bottomPanel}</section>
        </div>
        <section className={styles.rightPanel}>{rightPanel}</section>
      </main>
      <footer className={styles.statusBar}>{statusBar}</footer>
    </div>
  );
}

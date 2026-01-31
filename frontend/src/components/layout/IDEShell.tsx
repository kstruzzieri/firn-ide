import { ReactNode } from 'react';
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
  return (
    <div className={styles.ide} data-accent={accent}>
      <header className={styles.header}>{header}</header>
      <aside className={styles.sidebar}>{sidebar}</aside>
      <main className={styles.content}>
        <section className={styles.leftPanel}>{leftPanel}</section>
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

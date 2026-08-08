import { type KeyboardEvent } from 'react';
import { GolemPanel } from '../Golem';
import { RunProfiles } from '../RunProfiles';
import { useGolemStore } from '../../stores/golemStore';
import styles from './RightPanel.module.css';

/**
 * The right panel's two modes (#226 Task B8).
 *
 * A tab list, not a docking abstraction: there are exactly two alternative
 * contents for one region, which is what `tablist` describes. Selection lives
 * in `golemStore` because this component unmounts whenever the right panel
 * collapses, and the mode has to survive that.
 */

const PANEL_ID = 'right-panel-view';
const GOLEM_TAB_ID = 'right-panel-golem-tab';
const RUNS_TAB_ID = 'right-panel-runs-tab';

/**
 * Roving-tabindex focus movement. Activation stays manual (click or Enter on
 * the focused tab) so arrowing past a tab never mounts its panel.
 */
function moveTabFocus(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (target.getAttribute('role') !== 'tab') return;

  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const index = tabs.indexOf(target);
  let next: number | null = null;

  switch (event.key) {
    case 'ArrowRight':
      next = index < tabs.length - 1 ? index + 1 : 0;
      break;
    case 'ArrowLeft':
      next = index > 0 ? index - 1 : tabs.length - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = tabs.length - 1;
      break;
  }

  if (next === null) return;
  event.preventDefault();
  tabs[next]?.focus();
}

export function RightPanel() {
  const mode = useGolemStore((state) => state.panelMode);
  const isGolem = mode === 'golem';

  return (
    <div className={styles.panel}>
      <div
        className={styles.tabBar}
        role="tablist"
        aria-label="Right panel view"
        onKeyDown={moveTabFocus}
      >
        <button
          type="button"
          id={GOLEM_TAB_ID}
          role="tab"
          aria-selected={isGolem}
          aria-controls={PANEL_ID}
          tabIndex={isGolem ? 0 : -1}
          className={styles.tab}
          onClick={() => useGolemStore.getState().setPanelMode('golem')}
        >
          Golem
        </button>
        <button
          type="button"
          id={RUNS_TAB_ID}
          role="tab"
          aria-selected={!isGolem}
          aria-controls={PANEL_ID}
          tabIndex={isGolem ? -1 : 0}
          className={styles.tab}
          onClick={() => useGolemStore.getState().setPanelMode('runs')}
        >
          Runs
        </button>
      </div>
      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={isGolem ? GOLEM_TAB_ID : RUNS_TAB_ID}
        className={styles.body}
      >
        {isGolem ? <GolemPanel /> : <RunProfiles />}
      </div>
    </div>
  );
}

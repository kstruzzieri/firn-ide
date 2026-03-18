import { useIDEStore, useRunOutputs, useActiveRunOutputId } from '../../stores/ideStore';
import { getVisualState } from '../../utils/visualState';
import { ALL_PROFILES_ID } from '../../types/runOutput';
import type { VisualState } from '../../types/runOutput';
import styles from './RunOutputTabs.module.css';

export function RunOutputTabs() {
  const runOutputs = useRunOutputs();
  const activeId = useActiveRunOutputId();
  const stoppingIds = useIDEStore((s) => s.stoppingProfileIds);
  const restartingIds = useIDEStore((s) => s.restartingProfileIds);
  const setActiveRunOutput = useIDEStore((s) => s.setActiveRunOutput);
  const profiles = useIDEStore((s) => s.runProfiles);

  const outputIds = Object.keys(runOutputs);
  if (outputIds.length === 0) return null;

  const getProfileName = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    return profile?.name ?? id;
  };

  return (
    <div className={styles.tabBar}>
      {outputIds.map((id) => {
        const vs: VisualState = getVisualState(
          id,
          runOutputs[id]?.state,
          stoppingIds,
          restartingIds
        );
        const isActive = activeId === id;
        return (
          <button
            key={id}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            onClick={() => setActiveRunOutput(id)}
          >
            <span className={`${styles.tabDot} ${styles[`dot${capitalize(vs)}`] ?? ''}`} />
            <span className={isActive ? (styles[`name${capitalize(vs)}`] ?? '') : ''}>
              {getProfileName(id)}
            </span>
          </button>
        );
      })}
      {outputIds.length >= 2 && (
        <button
          className={`${styles.tab} ${activeId === ALL_PROFILES_ID ? styles.tabActive : ''} ${styles.tabAll}`}
          onClick={() => setActiveRunOutput(ALL_PROFILES_ID)}
        >
          All
        </button>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

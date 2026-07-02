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
  const runCompounds = useIDEStore((s) => s.runCompounds);

  // Ordinary run outputs: exclude compound aggregates. A compound emits an
  // aggregate run:status, so runOutputs[compoundId] exists for the card badge —
  // but it must not be treated as an ordinary timeline source (its output lives
  // in runCompounds[id].stepOutputs).
  const ordinaryIds = Object.keys(runOutputs).filter((id) => !runCompounds[id]);
  // Compound runs render their own tab (with compound state/name).
  const compoundIds = Object.keys(runCompounds);
  const tabIds = [...ordinaryIds, ...compoundIds];
  if (tabIds.length === 0) return null;

  const getProfileName = (id: string) => {
    return profiles.find((p) => p.id === id)?.name ?? runCompounds[id]?.name ?? id;
  };

  return (
    <div className={styles.tabBar}>
      {tabIds.map((id) => {
        const vs: VisualState = getVisualState(
          id,
          runOutputs[id]?.state ?? runCompounds[id]?.state,
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
      {/* Timeline ("All") is ordinary-profiles-only; compounds have their own
          all-steps view, so gate this tab on the ordinary outputs count. */}
      {ordinaryIds.length >= 2 && (
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

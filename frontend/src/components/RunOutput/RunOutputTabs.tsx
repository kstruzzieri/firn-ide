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
  const compoundIdByRunInstance = useIDEStore((s) => s.compoundIdByRunInstance);
  const runInstanceIdsByProfile = useIDEStore((s) => s.runInstanceIdsByProfile);
  const latestRunInstanceIdByProfile = useIDEStore((s) => s.latestRunInstanceIdByProfile);

  const ordinaryIds = Object.values(runInstanceIdsByProfile)
    .flat()
    .filter((id) => runOutputs[id]);
  const compoundIds = Object.values(runCompounds).map((run) => run.runInstanceId);
  const tabIds = [...ordinaryIds, ...compoundIds];
  const latestOrdinaryCount = Object.values(latestRunInstanceIdByProfile).filter(
    (id) => runOutputs[id]
  ).length;
  if (tabIds.length === 0) return null;

  const getTabLabel = (id: string) => {
    const output = runOutputs[id];
    if (output) {
      const name =
        profiles.find((profile) => profile.id === output.profileId)?.name ?? output.profileId;
      return `${name} · ${id}`;
    }
    const compoundId = compoundIdByRunInstance[id];
    return runCompounds[compoundId]?.name ?? id;
  };

  return (
    <div className={styles.tabBar}>
      {tabIds.map((id) => {
        const output = runOutputs[id];
        const compoundId = compoundIdByRunInstance[id];
        const compound = compoundId ? runCompounds[compoundId] : undefined;
        const visualStateId = output
          ? latestRunInstanceIdByProfile[output.profileId] === id
            ? output.profileId
            : id
          : (compoundId ?? id);
        const vs: VisualState = getVisualState(
          visualStateId,
          output?.state ?? compound?.state,
          stoppingIds,
          restartingIds
        );
        const isActive = activeId === id;
        return (
          <button
            type="button"
            key={id}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            onClick={() => setActiveRunOutput(id)}
          >
            <span className={`${styles.tabDot} ${styles[`dot${capitalize(vs)}`] ?? ''}`} />
            <span className={isActive ? (styles[`name${capitalize(vs)}`] ?? '') : ''}>
              {getTabLabel(id)}
            </span>
          </button>
        );
      })}
      {/* Timeline ("All") is ordinary-profiles-only; compounds have their own
          all-steps view, so gate this tab on the ordinary outputs count. */}
      {latestOrdinaryCount >= 2 && (
        <button
          type="button"
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

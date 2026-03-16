import { Panel } from '../layout';
import { PlusIcon } from '../icons';
import { RunProfileCard } from './RunProfileCard';
import { ProfileBrowser } from './ProfileBrowser';
import {
  useRunProfiles,
  useIsLoadingProfiles,
  useProfilesError,
  useIDEStore,
} from '../../stores/ideStore';
import { getVisualState } from '../../utils/visualState';
import type { RunProfile } from '../../types/runProfile';
import styles from './RunProfiles.module.css';

export function RunProfiles() {
  const profiles = useRunProfiles();
  const isLoading = useIsLoadingProfiles();
  const error = useProfilesError();
  const runOutputs = useIDEStore((s) => s.runOutputs);
  const runHistory = useIDEStore((s) => s.runHistory);
  const waveformData = useIDEStore((s) => s.waveformData);
  const hiddenProfileIds = useIDEStore((s) => s.hiddenProfileIds);
  const stoppingIds = useIDEStore((s) => s.stoppingProfileIds);
  const restartingIds = useIDEStore((s) => s.restartingProfileIds);
  const focusProfileOutput = useIDEStore((s) => s.focusProfileOutput);

  // Filter out hidden profiles
  const visibleProfiles = profiles.filter((p) => !hiddenProfileIds.includes(p.id));

  // Detect duplicate names for disambiguation
  const nameCounts = new Map<string, number>();
  for (const p of visibleProfiles) {
    nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  }

  const savedProfiles = visibleProfiles.filter((p) => p.source === 'user');
  const detectedProfiles = visibleProfiles.filter((p) => p.source === 'detected');

  const renderCard = (profile: RunProfile) => {
    const vs = getVisualState(
      profile.id,
      runOutputs[profile.id]?.state,
      stoppingIds,
      restartingIds
    );
    const isDormant = !runOutputs[profile.id] && !runHistory[profile.id]?.length;
    const isDuplicate = (nameCounts.get(profile.name) ?? 0) > 1;

    return (
      <RunProfileCard
        key={profile.id}
        profile={profile}
        visualState={vs}
        runOutput={runOutputs[profile.id]}
        runHistory={runHistory[profile.id] ?? []}
        waveformData={waveformData[profile.id] ?? []}
        isDormant={isDormant}
        isDuplicate={isDuplicate}
        onFocusOutput={focusProfileOutput}
      />
    );
  };

  return (
    <Panel
      title="Run Profiles"
      actions={<ProfileBrowser allProfiles={profiles} hiddenProfileIds={hiddenProfileIds} />}
    >
      <div className={styles.list}>
        {isLoading ? (
          <div className={styles.empty}>
            <p>Loading profiles...</p>
          </div>
        ) : error ? (
          <div className={styles.empty}>
            <p className={styles.errorText}>{error}</p>
          </div>
        ) : visibleProfiles.length === 0 ? (
          <RunProfilesEmpty />
        ) : (
          <>
            {savedProfiles.length > 0 && (
              <div className={styles.group}>
                <span className={styles.groupLabel}>Saved</span>
                {savedProfiles.map(renderCard)}
              </div>
            )}
            {detectedProfiles.length > 0 && (
              <div className={styles.group}>
                <span className={styles.groupLabel}>Detected</span>
                {detectedProfiles.map(renderCard)}
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function RunProfilesEmpty() {
  return (
    <div className={styles.empty}>
      <p>No run profiles configured</p>
      <p className={styles.emptyHint}>
        Open a folder with package.json, go.mod, or Makefile to auto-detect profiles
      </p>
      <button className={styles.addButton} disabled title="Coming soon">
        <PlusIcon aria-hidden="true" />
        Add Profile
      </button>
    </div>
  );
}

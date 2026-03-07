import { useState } from 'react';
import { Panel, PanelAction } from '../layout';
import { PlusIcon, PlayIcon } from '../icons';
import {
  useRunProfiles,
  useIsLoadingProfiles,
  useProfilesError,
  useIDEStore,
} from '../../stores/ideStore';
import { PinRunProfile } from '../../../wailsjs/go/main/App';
import type { RunProfile as RunProfileType } from '../../types/runProfile';
import styles from './RunProfiles.module.css';

export function RunProfiles() {
  const profiles = useRunProfiles();
  const isLoading = useIsLoadingProfiles();
  const error = useProfilesError();

  const savedProfiles = profiles.filter((p) => p.source === 'user');
  const detectedProfiles = profiles.filter((p) => p.source === 'detected');

  return (
    <Panel
      title="Run Profiles"
      actions={
        <PanelAction
          icon={<PlusIcon />}
          title="Add Profile (coming soon)"
          ariaLabel="Add Profile (coming soon)"
          disabled
        />
      }
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
        ) : profiles.length === 0 ? (
          <RunProfilesEmpty />
        ) : (
          <>
            {savedProfiles.length > 0 && (
              <div className={styles.group}>
                <span className={styles.groupLabel}>Saved</span>
                {savedProfiles.map((profile) => (
                  <RunProfileItem key={profile.id} profile={profile} />
                ))}
              </div>
            )}
            {detectedProfiles.length > 0 && (
              <div className={styles.group}>
                <span className={styles.groupLabel}>Detected</span>
                {detectedProfiles.map((profile) => (
                  <RunProfileItem key={profile.id} profile={profile} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

interface RunProfileItemProps {
  profile: RunProfileType;
}

function RunProfileItem({ profile }: RunProfileItemProps) {
  const isDetected = profile.source === 'detected';
  const isCompound = profile.type === 'compound';
  const [isPinning, setIsPinning] = useState(false);

  const handlePin = () => {
    setIsPinning(true);
    PinRunProfile(profile.id)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        useIDEStore.getState().showToast(`Failed to pin "${profile.name}": ${message}`, 'error');
      })
      .finally(() => {
        setIsPinning(false);
      });
  };

  return (
    <div className={styles.profile}>
      <button
        className={styles.runButton}
        aria-label={`Run ${profile.name}`}
        disabled
        title="Execution engine coming soon"
      >
        <PlayIcon aria-hidden="true" />
      </button>
      <div className={styles.profileInfo}>
        <div className={styles.profileHeader}>
          <span className={styles.profileName}>
            {isCompound && (
              <span className={styles.compoundIcon} aria-label="Compound profile">
                {'▶▶ '}
              </span>
            )}
            {profile.name}
          </span>
          {isDetected && (
            <button
              className={styles.pinButton}
              onClick={handlePin}
              disabled={isPinning}
              aria-label={`Pin ${profile.name}`}
              title="Save this profile"
            >
              {isPinning ? 'Pinning…' : 'Pin'}
            </button>
          )}
        </div>
        {profile.command && <span className={styles.profileCommand}>{profile.command}</span>}
        {profile.tags && profile.tags.length > 0 && (
          <div className={styles.tagList}>
            {profile.tags.map((tag) => (
              <span key={tag} className={styles.tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
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

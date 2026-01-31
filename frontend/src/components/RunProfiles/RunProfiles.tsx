import { Panel, PanelAction } from '../layout';
import { PlusIcon, PlayIcon } from '../icons';
import styles from './RunProfiles.module.css';

export function RunProfiles() {
  // Profiles will be populated from backend when workspace is loaded
  const profiles: RunProfile[] = [];

  return (
    <Panel
      title="Run Profiles"
      actions={
        <PanelAction
          icon={<PlusIcon />}
          title="Add Profile"
          ariaLabel="Add Profile"
        />
      }
    >
      <div className={styles.list}>
        {profiles.length === 0 ? (
          <RunProfilesEmpty />
        ) : (
          profiles.map((profile) => (
            <RunProfileItem key={profile.id} profile={profile} />
          ))
        )}
      </div>
    </Panel>
  );
}

interface RunProfile {
  id: string;
  name: string;
  command: string;
  workingDir: string;
  isRunning: boolean;
}

interface RunProfileItemProps {
  profile: RunProfile;
}

function RunProfileItem({ profile }: RunProfileItemProps) {
  return (
    <div className={styles.profile}>
      <button
        className={styles.runButton}
        aria-label={`Run ${profile.name}`}
        disabled={profile.isRunning}
      >
        <PlayIcon aria-hidden="true" />
      </button>
      <div className={styles.profileInfo}>
        <span className={styles.profileName}>{profile.name}</span>
        <span className={styles.profileCommand}>{profile.command}</span>
      </div>
    </div>
  );
}

function RunProfilesEmpty() {
  return (
    <div className={styles.empty}>
      <p>No run profiles configured</p>
      <button className={styles.addButton}>
        <PlusIcon aria-hidden="true" />
        Add Profile
      </button>
    </div>
  );
}

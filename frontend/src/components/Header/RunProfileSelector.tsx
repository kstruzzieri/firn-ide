import { useState } from 'react';
import { PlayIcon, StopIcon, RestartIcon, LoaderIcon, ChevronDownIcon } from '../icons';
import { useIDEStore } from '../../stores/ideStore';
import { useEffectiveRunTarget } from '../../hooks/useEffectiveRunTarget';
import { getVisualState } from '../../utils/visualState';
import { startProfile, stopProfile, restartProfile } from '../../utils/profileActions';
import styles from './RunProfileSelector.module.css';

export function RunProfileSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const profiles = useIDEStore((s) => s.runProfiles);
  const runOutputs = useIDEStore((s) => s.runOutputs);
  const stoppingIds = useIDEStore((s) => s.stoppingProfileIds);
  const restartingIds = useIDEStore((s) => s.restartingProfileIds);
  const effectiveId = useEffectiveRunTarget();

  const target = profiles.find((p) => p.id === effectiveId) ?? null;
  const vs = target
    ? getVisualState(target.id, runOutputs[target.id]?.state, stoppingIds, restartingIds)
    : 'idle';

  const onAction = () => {
    if (!target) return;
    if (vs === 'stopping') return;
    if (vs === 'running') stopProfile(target.id, target.name);
    else if (vs === 'failed' || vs === 'stopped') restartProfile(target.id, target.name);
    else startProfile(target.id, target.name);
  };

  const actionIcon =
    vs === 'stopping' ? (
      <LoaderIcon aria-hidden="true" />
    ) : vs === 'running' ? (
      <StopIcon aria-hidden="true" />
    ) : vs === 'failed' || vs === 'stopped' ? (
      <RestartIcon aria-hidden="true" />
    ) : (
      <PlayIcon aria-hidden="true" />
    );

  const actionLabel = !target
    ? 'No run profile selected'
    : vs === 'running'
      ? `Stop selected profile: ${target.name}`
      : vs === 'stopping'
        ? `Stopping ${target.name}`
        : vs === 'failed' || vs === 'stopped'
          ? `Restart selected profile: ${target.name}`
          : `Run selected profile: ${target.name}`;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.action} ${styles[`state_${vs}`] ?? ''}`}
        onClick={onAction}
        disabled={!target || vs === 'stopping'}
        aria-label={actionLabel}
      >
        <span className={styles.dot} data-state={vs} aria-hidden="true" />
        {actionIcon}
      </button>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setIsOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'run-profile-popover' : undefined}
      >
        <span className={styles.name}>{target ? target.name : 'No profile'}</span>
        <ChevronDownIcon className={styles.chevron} aria-hidden="true" />
      </button>
      {/* Popover added in Task 9 */}
    </div>
  );
}

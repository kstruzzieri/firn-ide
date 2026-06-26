import { useState, useEffect, useRef } from 'react';
import { PlayIcon, StopIcon, RestartIcon, LoaderIcon, ChevronDownIcon } from '../icons';
import {
  useIDEStore,
  useTreeViewMode,
  useActiveWorkspaceId,
  useWorkspaces,
} from '../../stores/ideStore';
import { useEffectiveRunTarget } from '../../hooks/useEffectiveRunTarget';
import { getVisualState } from '../../utils/visualState';
import { startProfile, stopProfile, restartProfile } from '../../utils/profileActions';
import { SetActiveVariant } from '../../../wailsjs/go/main/App';
import { groupProfiles, SECTION_LABEL, type ProfileSection } from '../../utils/groupProfiles';
import type { RunProfile } from '../../types/runProfile';
import styles from './RunProfileSelector.module.css';

export function RunProfileSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const profiles = useIDEStore((s) => s.runProfiles);
  const runOutputs = useIDEStore((s) => s.runOutputs);
  const stoppingIds = useIDEStore((s) => s.stoppingProfileIds);
  const restartingIds = useIDEStore((s) => s.restartingProfileIds);
  const setSelectedProfile = useIDEStore((s) => s.setSelectedProfile);
  const runProfileState = useIDEStore((s) => s.runProfileState);
  const hiddenProfileIds = useIDEStore((s) => s.hiddenProfileIds);
  const viewMode = useTreeViewMode();
  const activeWorkspaceId = useActiveWorkspaceId();
  const workspaces = useWorkspaces();
  const popRef = useRef<HTMLDivElement>(null);
  const effectiveId = useEffectiveRunTarget();

  const target = profiles.find((p) => p.id === effectiveId) ?? null;
  const visible = profiles.filter((p) => !hiddenProfileIds.includes(p.id));
  // Ids actually rendered by renderSections(visible): workspace view scopes to the
  // active workspace; project view shows all. The effective target may sit outside
  // this set (a pick in another workspace) — surface it explicitly so it's never hidden.
  const renderedIds = new Set(
    (viewMode === 'workspace'
      ? visible.filter((p) => (p.workspaceId ?? '') === activeWorkspaceId)
      : visible
    ).map((p) => p.id)
  );
  const targetOutsideView = !!target && !renderedIds.has(target.id);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const selectRow = (id: string) => {
    setSelectedProfile(id);
    setIsOpen(false);
  };
  const runRow = (p: RunProfile) => startProfile(p.id, p.name);
  const onVariantChange = (p: RunProfile, value: string) => {
    SetActiveVariant(p.id, value)
      .then(() => useIDEStore.getState().addOrUpdateProfile({ ...p, activeVariant: value }))
      .catch((err: unknown) =>
        useIDEStore
          .getState()
          .showToast(
            `Failed to switch "${p.name}" env: ${err instanceof Error ? err.message : String(err)}`,
            'error'
          )
      );
  };
  const renderRow = (p: RunProfile) => {
    const rvs = getVisualState(p.id, runOutputs[p.id]?.state, stoppingIds, restartingIds);
    const variants = (p.envVariants ?? []).filter((v) => v.name);
    return (
      <div key={p.id} className={`${styles.row} ${p.id === effectiveId ? styles.rowSel : ''}`}>
        <button
          type="button"
          className={styles.rowSelect}
          onClick={() => selectRow(p.id)}
          aria-pressed={p.id === effectiveId}
        >
          <span className={styles.mk} aria-hidden="true">
            {p.id === effectiveId ? '◉' : ''}
          </span>
          <span className={styles.rowName}>{p.name}</span>
          {p.id === effectiveId && <span className={styles.srOnly}>Selected target</span>}
        </button>
        {variants.length > 0 && (
          <select
            className={styles.env}
            value={p.activeVariant ?? variants[0].name}
            aria-label={`Env variant for ${p.name}`}
            onChange={(e) => onVariantChange(p, e.currentTarget.value)}
          >
            {variants.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={styles.rowRun}
          onClick={() => runRow(p)}
          disabled={rvs === 'running' || rvs === 'stopping'}
          aria-label={`Run ${p.name}`}
        >
          <PlayIcon aria-hidden="true" />
        </button>
      </div>
    );
  };

  const renderSectionRows = (key: ProfileSection, list: RunProfile[]) =>
    list.length > 0 ? (
      <div key={key} className={styles.section}>
        <div className={styles.sectionLabel}>{SECTION_LABEL[key]}</div>
        {list.map(renderRow)}
      </div>
    ) : null;

  const renderSections = (list: RunProfile[]) => {
    const grouped = groupProfiles(list, runProfileState, { viewMode, activeWorkspaceId });
    if (viewMode === 'project') {
      return grouped.workspaceGroups.map((wg) => (
        <div key={wg.workspaceId} className={styles.group}>
          <div className={styles.groupHead}>
            <span
              className={styles.wsDot}
              style={{
                background: `var(--accent-${workspaces.find((w) => w.id === wg.workspaceId)?.accent ?? 'project'})`,
              }}
            />
            {wg.workspaceName}
          </div>
          {wg.sections.map((s) => renderSectionRows(s.key, s.profiles))}
        </div>
      ));
    }
    return grouped.sections.map((s) => renderSectionRows(s.key, s.profiles));
  };

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
        className={styles.action}
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
      {isOpen && (
        <div
          ref={popRef}
          id="run-profile-popover"
          className={styles.popover}
          role="dialog"
          aria-label="Run profiles"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsOpen(false);
          }}
        >
          {targetOutsideView && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Selected (outside this view)</div>
              {renderRow(target)}
            </div>
          )}
          {renderSections(visible)}
          <div className={styles.footer}>
            <span>⌘R runs ◉ selected</span>
          </div>
        </div>
      )}
    </div>
  );
}

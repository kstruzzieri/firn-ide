import { useEffect, useMemo, useState } from 'react';
import { Panel } from '../layout';
import { RunProfileCard } from './RunProfileCard';
import { ProfileBrowser } from './ProfileBrowser';
import {
  useRunProfiles,
  useIsLoadingProfiles,
  useProfilesError,
  useIDEStore,
  useRunProfileState,
  useTreeViewMode,
  useActiveWorkspaceId,
} from '../../stores/ideStore';
import { getVisualState } from '../../utils/visualState';
import { estimateRemaining } from '../../utils/estimateCompletion';
import { groupProfiles, SECTION_LABEL, type SectionGroup } from '../../utils/groupProfiles';
import type { RunProfile } from '../../types/runProfile';
import styles from './RunProfiles.module.css';

export function RunProfiles() {
  const profiles = useRunProfiles();
  const isLoading = useIsLoadingProfiles();
  const error = useProfilesError();
  const runOutputs = useIDEStore((s) => s.runOutputs);
  const runHistory = useIDEStore((s) => s.runHistory);
  const hiddenProfileIds = useIDEStore((s) => s.hiddenProfileIds);
  const stoppingIds = useIDEStore((s) => s.stoppingProfileIds);
  const restartingIds = useIDEStore((s) => s.restartingProfileIds);
  const runStartTimestamps = useIDEStore((s) => s.runStartTimestamps);
  const focusProfileOutput = useIDEStore((s) => s.focusProfileOutput);
  const runProfileState = useRunProfileState();
  const viewMode = useTreeViewMode(); // 'project' | 'workspace'
  const activeWorkspaceId = useActiveWorkspaceId();

  // Filter out hidden profiles
  const visibleProfiles = useMemo(
    () => profiles.filter((p) => !hiddenProfileIds.includes(p.id)),
    [profiles, hiddenProfileIds]
  );

  // Detect duplicate names for disambiguation
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of visibleProfiles) {
      counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
    }
    return counts;
  }, [visibleProfiles]);

  // Periodic tick to refresh ETA sort order while profiles are running.
  // Without this, Date.now() in the sort memo stales until a store change.
  const hasRunning = useMemo(
    () =>
      visibleProfiles.some(
        (p) =>
          getVisualState(p.id, runOutputs[p.id]?.state, stoppingIds, restartingIds) === 'running'
      ),
    [visibleProfiles, runOutputs, stoppingIds, restartingIds]
  );
  const [etaTick, setEtaTick] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(() => setEtaTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, [hasRunning]);

  // Helper: sort running profiles by ETA ascending (finishing soonest first),
  // then non-running profiles in their original order.
  const sortByEta = useMemo(() => {
    return (profiles: RunProfile[]): RunProfile[] => {
      const now = Date.now();
      const running: { profile: RunProfile; eta: number }[] = [];
      const rest: RunProfile[] = [];

      for (const p of profiles) {
        const vs = getVisualState(p.id, runOutputs[p.id]?.state, stoppingIds, restartingIds);
        if (vs === 'running') {
          const startTs = runStartTimestamps[p.id] ?? now;
          const elapsed = now - startTs;
          const history = runHistory[p.id] ?? [];
          const eta = estimateRemaining(history, elapsed);
          // null ETA (insufficient data) sorts to end of running group
          running.push({ profile: p, eta: eta ?? Infinity });
        } else {
          rest.push(p);
        }
      }

      running.sort((a, b) => a.eta - b.eta);
      return [...running.map((r) => r.profile), ...rest];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- etaTick forces re-sort when ETA estimates update
  }, [runOutputs, stoppingIds, restartingIds, runHistory, runStartTimestamps, etaTick]);

  // Apply ETA sort BEFORE grouping so running-soonest profiles bubble up within
  // their section (groupProfiles preserves input order for activated/pinned/detected).
  const sortedVisible = useMemo(() => sortByEta(visibleProfiles), [visibleProfiles, sortByEta]);
  const grouped = useMemo(
    () => groupProfiles(sortedVisible, runProfileState, { viewMode, activeWorkspaceId }),
    [sortedVisible, runProfileState, viewMode, activeWorkspaceId]
  );

  const renderCard = (profile: RunProfile, section: SectionGroup['key']) => {
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
        isDormant={isDormant}
        isDuplicate={isDuplicate}
        section={section}
        isFreshestRun={grouped.freshestRunId === profile.id}
        onFocusOutput={focusProfileOutput}
      />
    );
  };

  const renderSection = (g: SectionGroup, collapseDetected: boolean) => {
    if (collapseDetected && g.key === 'detected') {
      return (
        <details key={g.key} className={styles.group}>
          <summary className={styles.groupLabel}>
            {SECTION_LABEL[g.key]} <span className={styles.sectionCount}>{g.profiles.length}</span>
          </summary>
          {g.profiles.map((p) => renderCard(p, g.key))}
        </details>
      );
    }
    return (
      <div key={g.key} className={styles.group}>
        <span className={styles.groupLabel}>
          {SECTION_LABEL[g.key]} <span className={styles.sectionCount}>{g.profiles.length}</span>
        </span>
        {g.profiles.map((p) => renderCard(p, g.key))}
      </div>
    );
  };

  // Counter scoped to the current view: running count + total.
  const scopedProfiles = useMemo(
    () =>
      viewMode === 'workspace'
        ? visibleProfiles.filter((p) => (p.workspaceId ?? '') === activeWorkspaceId)
        : visibleProfiles,
    [visibleProfiles, viewMode, activeWorkspaceId]
  );
  const runningCount = scopedProfiles.filter(
    (p) => getVisualState(p.id, runOutputs[p.id]?.state, stoppingIds, restartingIds) === 'running'
  ).length;
  const totalCountScoped = scopedProfiles.length;

  // Derive hidden count from intersection with current profiles to avoid
  // stale IDs inflating the counter after profiles are removed/renamed
  const hiddenCount = useMemo(() => {
    const profileIds = new Set(profiles.map((p) => p.id));
    return hiddenProfileIds.filter((id) => profileIds.has(id)).length;
  }, [profiles, hiddenProfileIds]);

  const title = (
    <>
      Run Profiles
      {runningCount > 0 && <span className={styles.runningCount}>● {runningCount} running</span>}
      <span className={styles.totalCount}>{totalCountScoped} total</span>
      {hiddenCount > 0 && <span className={styles.hiddenCount}>({hiddenCount} hidden)</span>}
    </>
  );

  return (
    <Panel
      title={title}
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
        ) : viewMode === 'project' ? (
          grouped.workspaceGroups.map((wg) => (
            <div key={wg.workspaceId} className={styles.workspaceGroup}>
              <div className={styles.workspaceHeader}>
                <span className={styles.workspaceDot} />
                <span className={styles.workspaceName}>{wg.workspaceName}</span>
              </div>
              {wg.sections.map((s) => renderSection(s, true))}
            </div>
          ))
        ) : (
          grouped.sections.map((s) => renderSection(s, false))
        )}
      </div>
    </Panel>
  );
}

function RunProfilesEmpty() {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyText}>No profiles detected.</span>
      <span className={styles.emptyHint}>
        Add a profile with <strong>+</strong> or open a project with package.json, go.mod, or
        Makefile.
      </span>
    </div>
  );
}

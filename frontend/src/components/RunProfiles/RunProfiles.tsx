import { useEffect, useMemo, useState } from 'react';
import { useEffectiveRunTarget } from '../../hooks/useEffectiveRunTarget';
import { Panel } from '../layout';
import { RunProfileCard } from './RunProfileCard';
import { RunProfileForm } from './RunProfileForm';
import { TreeViewToggle } from '../FileExplorer/TreeViewToggle';
import {
  useRunProfiles,
  useIsLoadingProfiles,
  useProfilesError,
  useIDEStore,
  useRunProfileState,
  useRunProfileForm,
  useTreeViewMode,
  useActiveWorkspaceId,
  useWorkspaces,
} from '../../stores/ideStore';
import { getVisualState } from '../../utils/visualState';
import { estimateRemaining } from '../../utils/estimateCompletion';
import {
  groupProfiles,
  isJustRan,
  SECTION_LABEL,
  type SectionGroup,
  type WorkspaceGroup,
} from '../../utils/groupProfiles';
import type { RunProfile } from '../../types/runProfile';
import styles from './RunProfiles.module.css';

// Accents that have a defined --accent-{name} token; anything else falls back to
// the neutral "project" accent. Mirrors WorkspaceSelector/WorkspaceTabs so the
// per-workspace dot here colors identically to the rest of the IDE.
const VALID_ACCENTS = new Set([
  'project',
  'blue',
  'cyan',
  'green',
  'purple',
  'orange',
  'amber',
  'general',
]);

function accentVar(accent: string | undefined): string {
  return `var(--accent-${accent && VALID_ACCENTS.has(accent) ? accent : 'project'})`;
}

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
  const runProfileForm = useRunProfileForm();
  const openRunProfileForm = useIDEStore((s) => s.openRunProfileForm);
  const viewMode = useTreeViewMode(); // 'project' | 'workspace'
  const activeWorkspaceId = useActiveWorkspaceId();
  const workspaces = useWorkspaces();
  const effectiveTargetId = useEffectiveRunTarget();

  // Render-time "now" for the just-ran recency window. Kept out of any memo deps
  // so grouping stays pure/memoized; recomputed each render (e.g. via etaTick).
  const nowMs = Date.now();

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
        isSelectedTarget={effectiveTargetId === profile.id}
        isFreshestRun={
          grouped.freshestRunId === profile.id &&
          isJustRan(runProfileState[profile.id]?.lastRunAt, nowMs)
        }
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
  // Running count for an arbitrary profile list (used for both the global header
  // counter and the per-workspace group counter in Project View).
  const countRunning = (list: RunProfile[]): number =>
    list.filter(
      (p) => getVisualState(p.id, runOutputs[p.id]?.state, stoppingIds, restartingIds) === 'running'
    ).length;
  const runningCount = countRunning(scopedProfiles);
  const totalCountScoped = scopedProfiles.length;

  // Per-workspace running·total for Project-View group headers. Flatten the
  // group's section profiles so the counter reflects that workspace only.
  const groupCounts = (wg: WorkspaceGroup): { running: number; total: number } => {
    const groupProfilesList = wg.sections.flatMap((s) => s.profiles);
    return { running: countRunning(groupProfilesList), total: groupProfilesList.length };
  };

  // Derive hidden count from intersection with the *view-scoped* profile set so a
  // hidden profile in another workspace doesn't inflate the Workspace-View count.
  const hiddenCount = useMemo(() => {
    const scopedHideable =
      viewMode === 'workspace'
        ? profiles.filter((p) => (p.workspaceId ?? '') === activeWorkspaceId)
        : profiles;
    const profileIds = new Set(scopedHideable.map((p) => p.id));
    return hiddenProfileIds.filter((id) => profileIds.has(id)).length;
  }, [profiles, hiddenProfileIds, viewMode, activeWorkspaceId]);

  const title = (
    <>
      Run Profiles
      {runningCount > 0 && <span className={styles.runningCount}>● {runningCount} running</span>}
      <span className={styles.totalCount}>{totalCountScoped} total</span>
      {hiddenCount > 0 && <span className={styles.hiddenCount}>({hiddenCount} hidden)</span>}
    </>
  );

  // View-aware "nothing to show" gate. The active workspace may have zero
  // profiles while other workspaces have some, so we can't gate on the global
  // visible list — that left Workspace View blank. Gate on the rendered set.
  const isViewEmpty =
    viewMode === 'project' ? grouped.workspaceGroups.length === 0 : grouped.sections.length === 0;

  return (
    <Panel
      title={title}
      actions={
        runProfileForm ? null : (
          <>
            <TreeViewToggle ariaLabel="Run profiles view" />
            <button
              className={styles.createButton}
              onClick={() => openRunProfileForm({ mode: 'create' })}
              aria-label="New profile"
              title="New profile"
            >
              +
            </button>
          </>
        )
      }
    >
      {runProfileForm ? (
        <RunProfileForm state={runProfileForm} />
      ) : (
        <div className={styles.list}>
          {isLoading ? (
            <div className={styles.empty}>
              <p>Loading profiles...</p>
            </div>
          ) : error ? (
            <div className={styles.empty}>
              <p className={styles.errorText}>{error}</p>
            </div>
          ) : isViewEmpty ? (
            <RunProfilesEmpty />
          ) : viewMode === 'project' ? (
            grouped.workspaceGroups.map((wg) => {
              const counts = groupCounts(wg);
              const accent = workspaces.find((w) => w.id === wg.workspaceId)?.accent;
              return (
                <div key={wg.workspaceId} className={styles.workspaceGroup}>
                  <div className={styles.workspaceHeader}>
                    <span
                      className={styles.workspaceDot}
                      style={{ background: accentVar(accent) }}
                    />
                    <span className={styles.workspaceName}>{wg.workspaceName}</span>
                    {counts.running > 0 && (
                      <span className={styles.runningCount}>● {counts.running} running</span>
                    )}
                    <span className={styles.groupTotal}>· {counts.total}</span>
                  </div>
                  {wg.sections.map((s) => renderSection(s, true))}
                </div>
              );
            })
          ) : (
            grouped.sections.map((s) => renderSection(s, false))
          )}
          <HiddenSection profiles={profiles} hiddenProfileIds={hiddenProfileIds} />
        </div>
      )}
    </Panel>
  );
}

function HiddenSection({
  profiles,
  hiddenProfileIds,
}: {
  profiles: RunProfile[];
  hiddenProfileIds: string[];
}) {
  const unhideProfile = useIDEStore((s) => s.unhideProfile);
  const hidden = profiles.filter((p) => hiddenProfileIds.includes(p.id));
  if (hidden.length === 0) return null;
  return (
    <details className={styles.group}>
      <summary className={styles.groupLabel}>
        Hidden <span className={styles.sectionCount}>{hidden.length}</span>
      </summary>
      {hidden.map((p) => (
        <div key={p.id} className={styles.hiddenRow}>
          <div className={styles.hiddenName}>{p.name}</div>
          <button className={styles.hiddenShow} onClick={() => unhideProfile(p.id)}>
            Show
          </button>
        </div>
      ))}
    </details>
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

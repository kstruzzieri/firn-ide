import { useIDEStore, type NavigationLocation } from '../stores/ideStore';
import { useSearchStore } from '../stores/searchStore';
import { navigateToEditorLocation } from './editorNavigation';
import { startProfile, restartProfile } from './profileActions';
import { resolveEffectiveRunTargetId } from './resolveEffectiveRunTarget';
import { getVisualState } from './visualState';

export interface Command {
  id: string;
  title: string;
  keywords?: readonly string[];
  shortcut?: string;
  run: () => void;
  enabled?: () => boolean;
}

const normalize = (value: string) => value.trim().toLowerCase();

const isSubsequence = (value: string, query: string, wordStartsOnly = false): boolean => {
  let nextIndex = 0;

  for (const character of query) {
    let index = value.indexOf(character, nextIndex);
    while (index !== -1 && wordStartsOnly && index > 0 && /[a-z0-9_]/i.test(value[index - 1])) {
      index = value.indexOf(character, index + 1);
    }
    if (index === -1) return false;
    nextIndex = index + 1;
  }

  return true;
};

const rankField = (value: string, query: string): number | undefined => {
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  if (isSubsequence(value, query, true)) return 2;
  if (isSubsequence(value, query)) return 3;
  return undefined;
};

export const matchCommands = (commands: readonly Command[], query: string): Command[] => {
  const normalizedQuery = normalize(query);

  return commands
    .map((command, index) => {
      if (command.enabled?.() === false) return undefined;
      if (!normalizedQuery) return { command, index, rank: 0 };

      const rank = [command.title, ...(command.keywords ?? [])]
        .map((field) => rankField(normalize(field), normalizedQuery))
        .reduce<number | undefined>((best, candidate) => {
          if (candidate === undefined) return best;
          return best === undefined || candidate < best ? candidate : best;
        }, undefined);

      return rank === undefined ? undefined : { command, index, rank };
    })
    .filter(
      (match): match is { command: Command; index: number; rank: number } => match !== undefined
    )
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ command }) => command);
};

export function showSidebarView(view: 'explorer' | 'search' | 'git' | 'structure'): void {
  const state = useIDEStore.getState();
  if (state.activeSidebarView !== view) state.setSidebarView(view);
  if (state.isLeftPanelCollapsed) state.toggleLeftPanel();
  if (view === 'search') useSearchStore.getState().requestInputFocus();
}

export function showRunProfiles(): void {
  const state = useIDEStore.getState();
  if (state.isRightPanelCollapsed) state.toggleRightPanel();
}

const currentEditorLocation = (
  state: ReturnType<typeof useIDEStore.getState>
): NavigationLocation | null => {
  const fileId = state.activeFileId;
  if (!fileId) return null;

  const cursor = state.cursorPositions[fileId] ?? state.cursorPosition;
  return { fileId, line: cursor.line, column: cursor.column };
};

export function navigateBack(): void {
  const state = useIDEStore.getState();
  const current = currentEditorLocation(state);
  if (!current) return;
  const target = state.goBack(current);
  if (!target) return;
  navigateToEditorLocation(target.fileId, target.line, target.column);
}

export function navigateForward(): void {
  const state = useIDEStore.getState();
  const current = currentEditorLocation(state);
  if (!current) return;
  const target = state.goForward(current);
  if (!target) return;
  navigateToEditorLocation(target.fileId, target.line, target.column);
}

const selectedRunTarget = () => {
  const state = useIDEStore.getState();
  const id = resolveEffectiveRunTargetId({
    selectedProfileId: state.selectedProfileId,
    profiles: state.runProfiles,
    profileState: state.runProfileState,
    hiddenProfileIds: state.hiddenProfileIds,
    activeWorkspaceId: state.activeWorkspaceId,
  });
  if (!id) return null;
  const profile = state.runProfiles.find((item) => item.id === id);
  if (!profile) return null;
  return { state, id, profile };
};

export function runOrRestartSelectedProfile(): void {
  const selection = selectedProfileAction();
  if (!selection) return;
  const {
    target: { id, profile },
    action,
  } = selection;
  if (action === 'restart') restartProfile(id, profile.name);
  else startProfile(id, profile.name);
}

const selectedProfileAction = () => {
  const target = selectedRunTarget();
  if (!target) return null;
  const { state, id } = target;
  if (state.restartingProfileIds.includes(id)) return null;
  const runInstanceId = state.latestRunInstanceIdByProfile[id];
  const compoundId = state.compoundIdByRunInstance[runInstanceId];
  const visualState = getVisualState(
    id,
    state.runOutputs[runInstanceId]?.state ?? state.runCompounds[compoundId]?.state,
    state.stoppingProfileIds,
    state.restartingProfileIds
  );
  if (visualState === 'stopping') return null;
  return { target, action: visualState === 'running' ? 'restart' : 'run' } as const;
};

const canNavigate = (direction: 'back' | 'forward'): boolean => {
  const state = useIDEStore.getState();
  return Boolean(
    state.activeFileId &&
    state[direction === 'back' ? 'navigationHistory' : 'navigationForward'].length
  );
};

const canRunSelectedProfile = (): boolean => selectedProfileAction()?.action === 'run';

const canRestartSelectedProfile = (): boolean => selectedProfileAction()?.action === 'restart';

export const createCommands = (openFolder: () => void): Command[] => [
  {
    id: 'open-folder',
    title: 'Open Folder',
    keywords: ['folder', 'workspace'],
    shortcut: '⌘O',
    run: openFolder,
  },
  { id: 'show-explorer', title: 'Show Explorer', run: () => showSidebarView('explorer') },
  {
    id: 'show-search',
    title: 'Show Search',
    keywords: ['find', 'workspace'],
    shortcut: '⌘⇧F',
    run: () => showSidebarView('search'),
  },
  {
    id: 'show-source-control',
    title: 'Show Source Control',
    keywords: ['git'],
    run: () => showSidebarView('git'),
  },
  { id: 'show-run-profiles', title: 'Show Run Profiles', run: showRunProfiles },
  {
    id: 'show-structure',
    title: 'Show Structure',
    keywords: ['symbols', 'outline'],
    shortcut: '⌘⇧Y',
    run: () => showSidebarView('structure'),
  },
  {
    id: 'navigate-back',
    title: 'Navigate Back',
    run: navigateBack,
    enabled: () => canNavigate('back'),
  },
  {
    id: 'navigate-forward',
    title: 'Navigate Forward',
    run: navigateForward,
    enabled: () => canNavigate('forward'),
  },
  {
    id: 'run-selected-profile',
    title: 'Run Selected Profile',
    shortcut: '⌘R',
    run: runOrRestartSelectedProfile,
    enabled: canRunSelectedProfile,
  },
  {
    id: 'restart-selected-profile',
    title: 'Restart Selected Profile',
    shortcut: '⌘R',
    run: runOrRestartSelectedProfile,
    enabled: canRestartSelectedProfile,
  },
];

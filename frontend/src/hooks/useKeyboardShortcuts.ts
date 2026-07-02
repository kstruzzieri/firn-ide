import { useEffect } from 'react';
import { useOpenFolder } from './useOpenFolder';
import { isMac } from '../utils/platform';
import { useIDEStore, type NavigationLocation } from '../stores/ideStore';
import { useSearchStore } from '../stores/searchStore';
import { navigateToEditorLocation } from '../utils/editorNavigation';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { resolveEffectiveRunTargetId } from '../utils/resolveEffectiveRunTarget';
import { getVisualState } from '../utils/visualState';
import { startProfile, restartProfile } from '../utils/profileActions';

function navigateBack() {
  const state = useIDEStore.getState();
  const current = currentEditorLocation(state);
  if (!current) return;
  const target = state.goBack(current);
  if (!target) return;
  navigateToEditorLocation(target.fileId, target.line, target.column);
}

function navigateForward() {
  const state = useIDEStore.getState();
  const current = currentEditorLocation(state);
  if (!current) return;
  const target = state.goForward(current);
  if (!target) return;
  navigateToEditorLocation(target.fileId, target.line, target.column);
}

/**
 * Registers global keyboard shortcuts for the IDE.
 * Call this hook exactly ONCE at the app level (e.g., in IDEShell).
 *
 * On macOS, Cmd+[ / Cmd+] are intercepted by WKWebView for browser
 * back/forward navigation before JavaScript can handle them. The app
 * registers native Wails menu items with these accelerators, which emit
 * "navigate:back" / "navigate:forward" events to the frontend. Both
 * the native events and the JS keydown handler call the same nav functions.
 */
export function useKeyboardShortcuts() {
  const { openFolder } = useOpenFolder();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const mac = isMac();
      const modifier = mac ? e.metaKey : e.ctrlKey;

      // Cmd+O / Ctrl+O — Open folder
      if (modifier && e.key === 'o') {
        e.preventDefault();
        openFolder();
        return;
      }

      // Cmd+R / Ctrl+R — run (or restart) the selected run-profile target.
      // preventDefault is essential: WKWebView treats Cmd+R as page reload.
      if (modifier && (e.key === 'r' || e.key === 'R') && !e.shiftKey) {
        e.preventDefault();
        const s = useIDEStore.getState();
        const id = resolveEffectiveRunTargetId({
          selectedProfileId: s.selectedProfileId,
          profiles: s.runProfiles,
          profileState: s.runProfileState,
          hiddenProfileIds: s.hiddenProfileIds,
          activeWorkspaceId: s.activeWorkspaceId,
        });
        if (!id) return;
        if (s.restartingProfileIds.includes(id)) return; // restart already in flight
        const target = s.runProfiles.find((p) => p.id === id);
        if (!target) return;
        const vs = getVisualState(
          id,
          s.runOutputs[id]?.state,
          s.stoppingProfileIds,
          s.restartingProfileIds
        );
        if (vs === 'stopping') return; // includes stop-in-flight
        if (vs === 'running') restartProfile(id, target.name);
        else startProfile(id, target.name);
        return;
      }

      // Cmd+Shift+F / Ctrl+Shift+F — Workspace search.
      if (modifier && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        const ide = useIDEStore.getState();
        if (ide.activeSidebarView !== 'search') {
          ide.setSidebarView('search');
        }
        if (ide.isLeftPanelCollapsed) {
          ide.toggleLeftPanel();
        }
        useSearchStore.getState().requestInputFocus();
        return;
      }

      // Cmd+[ / Cmd+] on macOS, Alt+Left / Alt+Right elsewhere — editor navigation history.
      // On macOS these may also arrive via Wails native menu events (navigate:back/forward)
      // because WKWebView sometimes intercepts Cmd+[/Cmd+] before JavaScript can handle them.
      const isBack = mac
        ? e.metaKey && (e.key === '[' || e.code === 'BracketLeft')
        : e.altKey && e.key === 'ArrowLeft';
      const isForward = mac
        ? e.metaKey && (e.key === ']' || e.code === 'BracketRight')
        : e.altKey && e.key === 'ArrowRight';

      if (isBack || isForward) {
        const state = useIDEStore.getState();
        const current = currentEditorLocation(state);
        if (!current) return;

        const target = isBack ? state.goBack(current) : state.goForward(current);
        if (!target) return;

        e.preventDefault();
        navigateToEditorLocation(target.fileId, target.line, target.column);
      }
    };

    // Native menu events from Wails (needed on macOS where WKWebView
    // may intercept Cmd+[ / Cmd+] for browser navigation).
    const cancelBack = EventsOn('navigate:back', navigateBack);
    const cancelForward = EventsOn('navigate:forward', navigateForward);

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      cancelBack();
      cancelForward();
    };
  }, [openFolder]);
}

function currentEditorLocation(
  state: ReturnType<typeof useIDEStore.getState>
): NavigationLocation | null {
  const fileId = state.activeFileId;
  if (!fileId) return null;

  const cursor = state.cursorPositions[fileId] ?? state.cursorPosition;
  return {
    fileId,
    line: cursor.line,
    column: cursor.column,
  };
}

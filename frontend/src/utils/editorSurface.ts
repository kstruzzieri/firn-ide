import { useGitStore, type EditorFocus } from '../stores/gitStore';
import { useGolemStore } from '../stores/golemStore';

/**
 * Select one of the three git-store-owned editor surfaces (#263 spec §3.1).
 *
 * Editor focus is exclusive, so choosing any of them also retires the app-global
 * Golem configuration tab's focus. It lives here rather than inside
 * `gitStore.setEditorFocus` so the git store never has to know the configuration
 * surface exists — and rather than at each call site, so the two flags cannot
 * drift into disagreeing about which tab is selected.
 */
export function focusEditorSurface(focus: EditorFocus): void {
  useGitStore.getState().setEditorFocus(focus);
  useGolemStore.getState().setConfigTabFocused(false);
}

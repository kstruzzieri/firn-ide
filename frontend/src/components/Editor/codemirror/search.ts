/**
 * In-File Search and Replace Wiring
 *
 * Centralizes the editor's integration with `@codemirror/search` so the
 * find/replace panel, match decorations, and shortcut bindings have a single,
 * testable source of truth.
 *
 * Responsibilities:
 *  - Activate the search state field and panel via `search({ top: true })`.
 *  - Highlight other instances of the current selection.
 *  - Expose a filtered search keymap that omits any shortcut reserved for the
 *    rest of the IDE (notably `Mod-Shift-f`, which is owned by project search).
 *
 * This module deliberately does not import the rest of the editor's extension
 * graph (LSP, autocomplete, hover, definition) so it can be unit tested
 * without depending on the Wails-generated runtime bindings.
 */

import type { Extension } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';

/**
 * Reserved shortcut keys that the editor must never claim through the
 * `@codemirror/search` keymap. These shortcuts are owned at the application
 * level and adding them to the editor scope would either swallow the global
 * handler or trigger destructive in-file replace behavior.
 *
 * `Mod-Shift-f` is reserved for the workspace-wide Search panel.
 */
export const RESERVED_GLOBAL_SHORTCUT_KEYS: readonly string[] = ['Mod-Shift-f'];

/**
 * Filtered upstream `searchKeymap` that omits any binding whose shortcut is
 * reserved for the rest of the IDE. The default `@codemirror/search` keymap
 * does not currently bind `Mod-Shift-f`, but a future upstream release could
 * add it; this filter keeps the contract explicit and stable across upgrades.
 *
 * `KeyBinding` may declare its shortcut through the cross-platform `key` field
 * or through a platform-specific `mac` / `win` / `linux` field. We check every
 * field so a future binding cannot smuggle a reserved shortcut through a
 * platform-only entry.
 */
function isReservedShortcut(shortcut: string | undefined): boolean {
  return shortcut !== undefined && RESERVED_GLOBAL_SHORTCUT_KEYS.includes(shortcut);
}

export const inFileSearchKeymap: readonly KeyBinding[] = searchKeymap.filter(
  (binding) =>
    !isReservedShortcut(binding.key) &&
    !isReservedShortcut(binding.mac) &&
    !isReservedShortcut(binding.win) &&
    !isReservedShortcut(binding.linux)
);

/**
 * Search and selection extensions.
 *
 * Wires the in-file find/replace panel from `@codemirror/search` so that
 * `Mod-f` opens the panel, `Mod-g` / `F3` navigate matches, and the panel's
 * Replace / Replace All buttons mutate the document through the editor's
 * normal change pipeline (which keeps `onContentChange`, autosave, and
 * modified-tab indicators consistent). All match decorations and the panel
 * UI are styled by the Firn Glacier theme.
 */
export function inFileSearchExtensions(): Extension[] {
  return [
    // Activates the in-file search state field, panel, and match decorations.
    // `top: true` keeps the panel anchored above the editor content so it does
    // not overlap the bottom-aligned status bar or terminal panel.
    search({ top: true }),
    // Highlights other instances of the current selection so `Mod-d` /
    // multi-cursor flows still work alongside the search panel.
    highlightSelectionMatches(),
  ];
}

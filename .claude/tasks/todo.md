# Firn IDE - Current Tasks

## Completed
- [x] **Issue #7: Editor - Autosave (JetBrains-style)** - merged
- [x] **Issue #33: Panel Resize & Collapse System** - merged (PR #1)
- [x] **Issue #34: Icon System & Dark Background Fixes** - merged (PR #1)
- [x] **Phase 0: LSP contract and doc alignment** - merged (PR #77)
- [x] **Phase 1 (#19): Backend LSP foundation** - JSON-RPC, stdio transport, lifecycle, crash recovery, URI normalization - merged (PR #77)
- [x] **Phase 2 (#73): Frontend document sync** - didOpen/didChange/didSave/didClose, reconnect, flush-on-close - merged (PR #77)
- [x] **Lint/act() warning cleanup** - merged (PR #78)
- [x] **Phase 3 (#20): TypeScript vertical slice** - lspStore, useLSPEvents hook, workspace-scoped diagnostics events, Toast error notifications - merged (PR #79)
- [x] **LSP server cwd fix** - set cmd.Dir to workspace root, capture stderr for crash diagnostics - merged (PR #80)
- [x] **LSP tsserver-path fix** - move --tsserver-path from CLI flag to initializationOptions for typescript-language-server v4+ - merged (PR #82)
- [x] **Phase 4 (#21): Diagnostics UX** - editor underlines/gutter markers, real Problems panel, lspStore reactive selectors, shared URI/navigation utilities, platform-correct path handling, URI canonicalization - merged (PR #81)
- [x] **Phase 5 (#22): Completion, hover, and definition UX** - LSP autocomplete with SVG icons/snippets, hover tooltips with syntax highlighting/quick actions, F12/Cmd+Click go-to-definition with back/forward navigation, compartment lifecycle wiring, Firn Glacier theme styles - merged (PR #83, merge 46758a49 on 2026-05-03)
- [x] **Terminal close-all session behavior** - closing the final terminal now leaves the panel empty, preserves manual new-session creation, and retries initial auto-create after spawn failures - merged (PR #84, merge df883e5 on 2026-05-03)
- [x] **Phase 6: LSP Hardening** - Go/Python LSP enablement, workspace-switching lifecycle hardening, completion/hover cancellation, document sync race fixes, structured failure reporting, and URI/path/binary hardening - merged (PR #85, merge 682462b on 2026-05-04)

## Current Focus (Milestone 6: Search)
- [x] **Current status snapshot (2026-05-09)** - `origin/develop` is at `fab40eb` after PR #88 merge; PR #84/#85/#86/#87/#88 merged; only Task 3 and Task 5 remain for M6
- [x] **Milestone 6 (#23-25): Search implementation plan** - lives at `docs/plans/milestone-6-search-implementation-plan.md` (carved out of `.gitignore` so parallel workers share one source-of-truth)
- [x] **Task 1 (#23): Backend ripgrep integration** - `internal/search` package with runner/parser/manager, Wails `SearchWorkspace`/`CancelSearch` bindings, cancelation, 30s timeout, 5000-match cap, full Go test coverage. Merged via PR #86 (merge `fc9e45c`, 2026-05-09)
- [x] **Task 4 (#25): Find in file and replace** - `@codemirror/search` wired through new `codemirror/search.ts` wrapper, Firn Glacier panel/match styling, no-file `Cmd+F` browser-find suppression, `Mod-Shift-f` reserved across `key`/`mac`/`win`/`linux` `KeyBinding` fields. Merged via PR #86 (merge `fc9e45c`, 2026-05-09)
- [x] **Task 2 (#24): Frontend search client/state** - typed `SearchUIState` discriminated union, `searchStore`, `useWorkspaceSearch` hook with 250ms debounce + monotonic request id + stale-drop + workspace-switch/unmount cancellation, `searchRanges.ts` UTF-8 byte → JS UTF-16 offset converter (handles surrogate pairs, combining marks, ZWJ sequences) + overlap-merging line splitter, `DEFAULT_EXPAND_FILE_LIMIT = 10` auto-expansion cap. 73 new tests. Merged via PR #88 (merge `fab40eb`, 2026-05-09)
- [ ] **Task 3 (#24): Search UI panel/navigation** - render the Search tool view, options, grouped results, shortcut integration, and result navigation. Consumes Task 2's stable APIs: `useSearchStore` (pattern-match on `uiState.kind`), `useWorkspaceSearch` (mount once in `App.tsx`), `splitLineByByteRanges` (highlight rendering), `byteColumnToCharColumn` (for `navigateToEditorLocation`). Owns the `Cmd+Shift+F` global binding and `App.tsx` left-panel routing
- [ ] **Task 5: Milestone 6 final integration** - run full verification, update docs/tracker, and record final smoke/review notes

## Known Bugs
- [ ] Issue #31: Window dragging not working on macOS
- [ ] Issue #32: Button type attributes missing

## Future Tickets
- [ ] **LSP follow-ons after Phase 6** - find references, rename symbol, code actions/quick fixes, document/range formatting, semantic highlighting, and workspace trust UI
- [ ] **Line number gutter too wide** - lintGutter() adds a separate gutter column for diagnostic markers, widening the left margin; investigate using a combined gutter or styling the lint gutter narrower
- [ ] **Markdown preview** - add a split or toggle view for .md files that renders a live Markdown preview alongside the raw editor
- [ ] **File tree loads too slowly on workspace open** - editor content appears immediately but the file explorer has a noticeable delay; investigate prefetching the directory tree in parallel with file content restoration

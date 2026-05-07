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
- [x] **Current status snapshot (2026-05-04)** - local `develop` and `origin/develop` are synced at PR #85 merge `682462b`; PR #84 and PR #85 are merged; no newer upstream merge is visible after fetch
- [x] **Milestone 6 (#23-25): Search implementation plan** - created `docs/plans/milestone-6-search-implementation-plan.md` (untracked) with task-by-task code review and adversarial review gates
- [x] **Task 1 (#23): Backend ripgrep integration** - `internal/search` package with runner/parser/manager, Wails `SearchWorkspace`/`CancelSearch` bindings, cancelation, 30s timeout, 5000-match cap, full Go test coverage. Implemented in worktree, code-reviewed + criticize-reviewed (added `searchManager.CancelAll()` to `beforeClose`; regenerated Wails bindings via `wails generate module` to restore canonical alphabetical namespace order and pull in pre-existing `lsp.ServerStatus.command` drift). Local commit `816d5ab` on `develop`.
- [x] **Task 4 (#25): Find in file and replace** - `@codemirror/search` wired through new `codemirror/search.ts` wrapper, Firn Glacier panel/match styling, no-file `Cmd+F` browser-find suppression, `Mod-Shift-f` reserved across `key`/`mac`/`win`/`linux` `KeyBinding` fields. Implemented in worktree, code-reviewed + criticize-reviewed (extended platform-specific reserved-shortcut filter). Local commit `cf51a76` on `develop`.
- [ ] **Task 2 (#24): Frontend search client/state** - add typed search store/hook, stale request handling, range conversion, and focused tests. Mirror Go shapes from Task 1: `SearchRequest { requestId, root, query, options }`, `SearchResponse { requestId, status, message?, files, totalFiles, totalLines, truncated, matchCap, durationMs }`. Convert byte offsets to JS string offsets in `utils/searchRanges.ts`.
- [ ] **Task 3 (#24): Search UI panel/navigation** - render the Search tool view, options, grouped results, shortcut integration, and result navigation. Owns the `Cmd+Shift+F` global binding (Task 4 leaves it free).
- [ ] **Task 5: Milestone 6 final integration** - run full verification, update docs/tracker, and record final smoke/review notes

## Known Bugs
- [ ] Issue #31: Window dragging not working on macOS
- [ ] Issue #32: Button type attributes missing

## Future Tickets
- [ ] **LSP follow-ons after Phase 6** - find references, rename symbol, code actions/quick fixes, document/range formatting, semantic highlighting, and workspace trust UI
- [ ] **Line number gutter too wide** - lintGutter() adds a separate gutter column for diagnostic markers, widening the left margin; investigate using a combined gutter or styling the lint gutter narrower
- [ ] **Markdown preview** - add a split or toggle view for .md files that renders a live Markdown preview alongside the raw editor
- [ ] **File tree loads too slowly on workspace open** - editor content appears immediately but the file explorer has a noticeable delay; investigate prefetching the directory tree in parallel with file content restoration

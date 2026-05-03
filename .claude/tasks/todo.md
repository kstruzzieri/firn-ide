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

## Current Focus (Milestone 5: LSP)
- [ ] **Phase 6: Hardening** - follow `docs/lsp-phase-6-hardening-plan.md`; Tasks 1-6 implementation and review gates complete, final manual smoke/final review remains before closeout

## Known Bugs
- [ ] Issue #31: Window dragging not working on macOS
- [ ] Issue #32: Button type attributes missing

## Future Tickets
- [ ] **Line number gutter too wide** - lintGutter() adds a separate gutter column for diagnostic markers, widening the left margin; investigate using a combined gutter or styling the lint gutter narrower
- [ ] **Markdown preview** - add a split or toggle view for .md files that renders a live Markdown preview alongside the raw editor
- [ ] **File tree loads too slowly on workspace open** - editor content appears immediately but the file explorer has a noticeable delay; investigate prefetching the directory tree in parallel with file content restoration

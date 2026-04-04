# Firn IDE - Current Tasks

## Completed
- [x] **Issue #7: Editor - Autosave (JetBrains-style)** - merged
- [x] **Issue #33: Panel Resize & Collapse System** - merged (PR #1)
- [x] **Issue #34: Icon System & Dark Background Fixes** - merged (PR #1)
- [x] **Phase 0: LSP contract and doc alignment** - merged (PR #77)
- [x] **Phase 1 (#19): Backend LSP foundation** - JSON-RPC, stdio transport, lifecycle, crash recovery, URI normalization - merged (PR #77)
- [x] **Phase 2 (#73): Frontend document sync** - didOpen/didChange/didSave/didClose, reconnect, flush-on-close - merged (PR #77)
- [x] **Lint/act() warning cleanup** - merged (PR #78)
- [x] **Phase 3 (#20): TypeScript vertical slice** - --tsserver-path for mixed installs, lspStore, useLSPEvents hook, workspace-scoped diagnostics events, Toast error notifications - merged (PR #79)

## Current Focus (Milestone 5: LSP)
- [x] **Phase 4 (#21): Diagnostics UX** - editor underlines/gutter markers, real Problems panel, lspStore reactive selectors, ideStore diagnostic state removal, shared URI/navigation utilities — code-reviewed, on feature/diagnostics-ux branch, pending PR
- [ ] **Phase 5 (#22): Completion, hover, and definition UX** - CodeMirror completion source, hover tooltips, F12/Cmd+Click
- [ ] **Phase 6: Hardening** - Go/Python follow-ons, performance tuning

## Detailed Strategy
- See `docs/lsp-implementation-strategy.md`
- Phase 4 execution plan: `docs/superpowers/plans/2026-04-03-diagnostics-ux.md`

## Known Bugs
- [ ] Issue #31: Window dragging not working on macOS
- [ ] Issue #32: Button type attributes missing

## Future Tickets
- [ ] **Line number gutter too wide** - lintGutter() adds a separate gutter column for diagnostic markers, widening the left margin; investigate using a combined gutter or styling the lint gutter narrower
- [ ] **Markdown preview** - add a split or toggle view for .md files that renders a live Markdown preview alongside the raw editor

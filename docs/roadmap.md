# Firn IDE — Roadmap

> A lightweight, workspace-focused desktop IDE for macOS, Linux, and Windows.
> Built with [Wails](https://wails.io) (Go backend + system WebView + React frontend).

## Vision

Firn IDE brings the focused, keyboard-first productivity of JetBrains IDEs to a lightweight, open-source package. Instead of loading an entire monorepo into one IDE instance, Firn lets you define **multiple workspaces** within a single repository — each with its own layout state, language servers, and run profiles.

**Key Differentiators:**
- **Workspace-first design** — One repo, multiple focused workspaces (frontend, backend, infra)
- **Lightweight binary** — ~15MB via Wails (vs ~150MB+ for Electron apps)
- **JetBrains-inspired UX** — Dockable tool windows, keyboard-first, search everywhere
- **Run Profiles** — First-class build/lint/test/deploy configurations per workspace
- **Firn Glacier theme** — Blue-tinted gradient dark theme with workspace-specific accent colors

## Progress Summary

| Milestone | Status | Issues |
|-----------|--------|--------|
| Infrastructure | **COMPLETE** | #26-30 |
| Milestone 1: Core File Operations | **COMPLETE** | #1-7 |
| UI/UX Polish | **COMPLETE** | #33-34 |
| **Milestone 2: Terminal Integration** | **NEXT** | #8-10 |
| Milestone 3: Workspace Management | Not started | #11-13 |
| Milestone 4: Run Profiles | Not started | #14-16 |
| Milestone 5: Language Server Protocol | Not started | #17-20 |
| Milestone 6: Search | Not started | #21-23 |
| Milestone 7: Git Integration | Not started | #24-25 |
| Performance | Not started | #35-37 |
| Dependency Upgrades | Not started | #38 |
| Code Quality | Not started | #39-40 |
| Accessibility | Not started | #41 |
| Future Features | Not started | #42-44 |
| Bug Fixes | Not started | #31-32 |

---

## Milestone 1: Core File Operations (COMPLETE)

### Issue #1: File System - Read Directory Tree ✅
`ReadDirectory(path string)` returns nested file/folder structure with .gitignore support, file metadata, graceful error handling.

### Issue #2: File System - Read File Contents ✅
`ReadFile(path string)` with UTF-8/UTF-16/Latin-1 encoding detection, binary file handling, metadata.

### Issue #3: File System - Write File Contents ✅
`WriteFile(path, content)` with encoding preservation, backup creation, error handling.

### Issue #4: File System - Watch for Changes ✅
OS-native file watcher with 100ms debounce, create/modify/delete/rename events.

### Issue #5: File Explorer - Display Directory Tree ✅
Tree UI with expand/collapse, file type icons, loading states, click-to-open.

### Issue #6: Editor - Open Files from Explorer ✅
Double-click opens in CodeMirror, tab created, language detection from extension.

### Issue #7: Editor - Autosave (JetBrains-style) ✅
Debounced autosave after ~1.5s idle, save on focus loss, Cmd+S support, error toast on failure.

---

## Milestone 2: Terminal Integration (NEXT)

### Issue #8: Terminal - PTY Backend
- [ ] Create PTY session with shell (bash/zsh)
- [ ] Bidirectional communication (stdin/stdout)
- [ ] Handle terminal resize (SIGWINCH)
- [ ] Support ANSI escape codes
- [ ] Clean session termination

### Issue #9: Terminal - xterm.js Integration
- [ ] Install and configure xterm.js
- [ ] Connect to backend PTY via Wails bindings
- [ ] Render terminal output with ANSI colors
- [ ] Send keyboard input to backend
- [ ] Handle resize events, match Firn Glacier theme

### Issue #10: Terminal - Multiple Sessions & Unified Tab Bar
- [x] Unified single-row tab bar (Output/Problems/Terminal + session tabs)
- [x] Create/switch/close terminal session tabs
- [x] Rename terminal tabs (double-click or right-click context menu)
- [x] Drag-and-drop tab reorder
- [x] Right-click context menu (Rename, Close Terminal)
- [x] Fixed orange accent for bottom panel (`data-accent="orange"`)
- [x] xterm.js theme: near-black bg, warm foreground, orange cursor
- [ ] Kill process on tab close (backend: sends SIGHUP on CloseTerminal)

---

## Milestone 3: Workspace Management

### Issue #11: Workspace - Open Folder Dialog
- [ ] Menu item and keyboard shortcut (Cmd+O)
- [ ] Native folder picker dialog
- [ ] Load selected folder into file explorer
- [ ] Update window title with folder name

### Issue #12: Workspace - Persistence
- [ ] Save/restore open files, cursor positions, scroll state
- [ ] Save panel sizes and layout
- [ ] Save active workspace/folder
- [ ] Store in `~/.firn/workspaces/`

### Issue #13: Workspace - Recent Projects
- [ ] Store last 10 opened folders
- [ ] Display in welcome screen and File menu
- [ ] Click to reopen project

---

## Milestone 4: Run Profiles

### Issue #14: Run Profiles - Configuration Schema
- [ ] JSON/YAML schema (name, command, cwd, env, envFile)
- [ ] Auto-detect from package.json, go.mod, Makefile
- [ ] Validate profile configuration

### Issue #15: Run Profiles - Execution Engine
- [ ] Start process with configured env/cwd
- [ ] Stream stdout/stderr to frontend
- [ ] Handle process termination, support stop/restart
- [ ] Parse clickable file:line:col references

### Issue #16: Run Profiles - UI Integration
- [ ] Display configured profiles with play/stop buttons
- [ ] Show running status indicator
- [ ] Output panel with streaming logs

---

## Milestone 5: Language Server Protocol

### Issue #17: LSP - Client Implementation
- [ ] JSON-RPC 2.0 message handling
- [ ] Initialize/shutdown lifecycle
- [ ] textDocument/didOpen, didChange, didSave
- [ ] Support stdio and TCP transports

### Issue #18: LSP - TypeScript Integration
- [ ] Auto-detect TypeScript projects
- [ ] Start/stop tsserver appropriately
- [ ] Diagnostics, hover, go-to-definition

### Issue #19: LSP - Diagnostics Display
- [ ] Underline errors/warnings in editor
- [ ] Gutter icons, problems panel
- [ ] Click to navigate to issue

### Issue #20: LSP - Autocomplete
- [ ] Trigger on typing (configurable)
- [ ] Display completion items with icons and docs
- [ ] Insert with Tab/Enter, support snippets

---

## Milestone 6: Search

### Issue #21: Search - ripgrep Integration
- [ ] Call rg binary with search parameters
- [ ] Parse structured results, respect .gitignore
- [ ] Support regex, case sensitivity, whole word

### Issue #22: Search - UI Panel
- [ ] Search input with options (regex, case, whole word)
- [ ] Results grouped by file with context
- [ ] Click result to open file at location (Cmd+Shift+F)

### Issue #23: Search - Find in File
- [ ] Cmd+F opens search bar in editor
- [ ] Highlight all matches, navigate between
- [ ] Replace and Replace All, regex support

---

## Milestone 7: Git Integration

### Issue #24: Git - Status Display
- [ ] Show current branch in status bar
- [ ] Color-code modified/added/deleted files in explorer
- [ ] Refresh on file system changes

### Issue #25: Git - Basic Operations
- [ ] Stage/unstage files, commit with message
- [ ] Pull/push, branch switching
- [ ] Error handling for conflicts

---

## UI/UX Polish (COMPLETE)

### Issue #33: Panel Resize & Collapse System ✅
Drag-to-resize handles between all panel junctions, collapse/expand chevrons, CSS variable-driven sizing, min-size constraints.

### Issue #34: Icon System & Dark Background Fixes ✅
currentColor SVGs, sidebar active indicators, devicons light fills for dark backgrounds, binary file type icons.

---

## Performance

### Issue #35: File Tree Virtualization & Lazy Loading
Virtual scrolling for 10k+ file trees, lazy-load directory children on expand.

### Issue #36: TreeNode Memoization
`React.memo` with custom comparison to prevent re-renders of unchanged tree nodes.

### Issue #37: Dynamic CodeMirror Language Loading
Dynamic `import()` for language extensions per file type to reduce initial bundle.

---

## Dependency Upgrades

### Issue #38: Upgrade TypeScript, Vite & Test Tooling
TypeScript 5.7+, Vite 6.x, @swc/jest, path aliases, optimizeDeps.

---

## Code Quality

### Issue #39: Split Zustand Store into Domain Slices
Split 255-line monolithic store into workspace/fileTree/editor/terminal/ui slices.

### Issue #40: Fix Hardcoded macOS Paths
Cross-platform path handling for macOS, Linux, and Windows support.

---

## Accessibility

### Issue #41: Accessibility Improvements (WCAG AA)
Fix contrast ratios, skip-to-content link, aria-busy, roving tabindex for tree, aria-live regions.

---

## Future Features

### Issue #42: Command Palette
Cmd+Shift+P opens fuzzy-search command palette with keyboard shortcuts display.

### Issue #43: Context Menus
Right-click menus for file explorer (new/rename/delete/copy path) and editor tabs (close/close others).

### Issue #44: Breadcrumb Navigation
Clickable file path breadcrumbs above editor with sibling dropdown navigation.

### AI Chat Panel (v1.5)
Claude integration with context-aware code assistance, diff preview, provider architecture.

### gRPC Service Integration (v2.0+)
Service Adapter Pattern for connecting to external backends. See `docs/plans/grpc-service-integration-concept.md`.

---

## Bug Fixes

### Issue #31: Window Dragging Not Working
Window cannot be dragged from header area on macOS.

### Issue #32: Add Button Type Attributes
Missing explicit `type` attributes on non-submit buttons.

---

## Infrastructure (COMPLETE)

### Issue #26: Testing - Setup Jest + React Testing Library ✅
### Issue #27: Testing - Setup Go Tests ✅
### Issue #28: CI/CD - GitHub Actions ✅
### Issue #29: Code Quality - ESLint + Prettier ✅
### Issue #30: Documentation - Architecture Guide ✅

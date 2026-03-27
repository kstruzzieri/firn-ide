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

> **Note:** Issue numbers below are **GitHub issue numbers**. See the [design specification](design-specification.md) for detailed UI/UX requirements.

| Milestone | Status | GitHub Issues |
|-----------|--------|---------------|
| Infrastructure | **COMPLETE** | #28-32 |
| Milestone 1: Core File Operations | **COMPLETE** | #3-9 |
| UI/UX Polish | **COMPLETE** | #35-36 |
| Milestone 2: Terminal Integration | **COMPLETE** | #10-12, #47 |
| Milestone 3: Workspace Management | **IN PROGRESS** | #13-15, #53, #54 |
| Milestone 4: Run Profiles | **IN PROGRESS** | #16-18 |
| Milestone 5: Language Server Protocol | Not started | #19-22 |
| Milestone 6: Search | Not started | #23-25 |
| Milestone 7: Git Integration | Not started | #26-27 |
| Performance | Not started | #37-39 |
| Dependency Upgrades | **COMPLETE** | #40 |
| Code Quality | Not started | #41-42 |
| Accessibility | Not started | #43 |
| Future Features | Not started | #44-46 |
| Bug Fixes | Not started | #33-34 |

---

## Milestone 1: Core File Operations (COMPLETE)

### #3: File System - Read Directory Tree ✅
`ReadDirectory(path string)` returns nested file/folder structure with .gitignore support, file metadata, graceful error handling.

### #4: File System - Read File Contents ✅
`ReadFile(path string)` with UTF-8/UTF-16/Latin-1 encoding detection, binary file handling, metadata.

### #5: File System - Write File Contents ✅
`WriteFile(path, content)` with encoding preservation, backup creation, error handling.

### #6: File System - Watch for Changes ✅
OS-native file watcher with 100ms debounce, create/modify/delete/rename events.

### #7: File Explorer - Display Directory Tree ✅
Tree UI with expand/collapse, file type icons, loading states, click-to-open.

### #8: Editor - Open Files from Explorer ✅
Double-click opens in CodeMirror, tab created, language detection from extension.

### #9: Editor - Autosave (JetBrains-style) ✅
Debounced autosave after ~1.5s idle, save on focus loss, Cmd+S support, error toast on failure.

---

## Milestone 2: Terminal Integration (COMPLETE)

### #10: Terminal - PTY Backend ✅
- [x] Create PTY session with shell (bash/zsh)
- [x] Bidirectional communication (stdin/stdout)
- [x] Handle terminal resize (SIGWINCH)
- [x] Support ANSI escape codes
- [x] Clean session termination

### #11: Terminal - xterm.js Integration ✅
- [x] Install and configure xterm.js
- [x] Connect to backend PTY via Wails bindings
- [x] Render terminal output with ANSI colors
- [x] Send keyboard input to backend
- [x] Handle resize events, match Firn Glacier theme

### #12: Terminal - Multiple Sessions & Unified Tab Bar ✅
- [x] Unified single-row tab bar (Output/Problems/Terminal + session tabs)
- [x] Create/switch/close terminal session tabs
- [x] Rename terminal tabs (double-click or right-click context menu)
- [x] Drag-and-drop tab reorder
- [x] Right-click context menu (Rename, Close Terminal)
- [x] Fixed orange accent for bottom panel (`data-accent="orange"`)
- [x] xterm.js theme: near-black bg, warm foreground, orange cursor
- [x] Kill process on tab close (graceful SIGHUP via PTY close + SIGKILL fallback)

### #47: Terminal - Shell Integration (Error Markers & Command Separators)
- [ ] Error markers on failed commands
- [ ] Visual command separators

---

## Milestone 3: Workspace Management

### #13: Workspace - Open Folder Dialog ✅
- [x] Menu item and keyboard shortcut (Cmd+O)
- [x] Native folder picker dialog
- [x] Load selected folder into file explorer
- [x] Update window title with folder name

### #14: Workspace - Persistence
- [ ] Save/restore open files, cursor positions, scroll state
- [ ] Save panel sizes and layout
- [ ] Save active workspace/folder
- [ ] Store in `~/.firn/workspaces/`

### #15: Workspace - Recent Projects
- [ ] Store last 10 opened folders
- [ ] Display in welcome screen and File menu
- [ ] Click to reopen project

### #53: Workspace - Identity & Accent System (NEW)
Defines workspace identity: type, accent color, and how workspaces are configured within a repo.
- [ ] Workspace configuration schema (name, root dir, type, accent color)
- [ ] Store workspace definitions in `.firn/workspaces.json`
- [ ] Auto-detect workspace type from content (package.json → Frontend, go.mod → Go, etc.)
- [ ] CSS accent system wired to active workspace (`.ide--accent-blue`, `.ide--accent-green`, etc.)
- [ ] Workspace selector dropdown in header (with accent dot per workspace)
- [ ] `⌘⇧W` keyboard shortcut for quick workspace switching

> **Design spec ref:** Sections 2 (Accent Colors), 4 (Workspace Model & Multi-Workspace Editing)

### #54: Workspace - File Tree Views (NEW)
Project View (unified) vs Workspace View (focused) with color-coded regions.
- [ ] Toggle dropdown: "PROJECT" vs "WORKSPACE" at top of file tree panel
- [ ] Project View: full repo tree with color-coded workspace regions (~4% accent tint)
- [ ] Workspace View: scoped tree with workspace tabs for switching
- [ ] File type association for tinting (e.g., `docker-compose.yml` gets Infrastructure tint at root)

> **Design spec ref:** Section 4 (File Tree Views)

---

## Milestone 4: Run Profiles

### #16: Run Profiles - Configuration Schema ✅
- [x] JSON schema (name, command, cwd, env, envFile, envVariants, tags, steps)
- [x] Auto-detect from package.json, go.mod, Makefile, pyproject.toml, docker-compose
- [x] Validate profile configuration
- [x] Persistent storage in `.firn/run-profiles.json`
- [x] Reactive re-detection on config file changes via file watcher
- [x] Pin detected profiles to saved profiles
- [x] Backend: 7 Wails bindings (Load/GetAll/Save/Delete/Pin/Validate/Detect)
- [x] Frontend: Zustand store slice, useRunProfiles hook, basic sidebar panel

### #17: Run Profiles - Execution Engine [Epic]
Sub-issues:
- [ ] #59: Core Process Runner — `os/exec` implementation, env/cwd/envFile, start/stop bindings
- [ ] #60: Output Streaming — pipe stdout/stderr, Wails events, output panel
- [ ] #61: Process Lifecycle UI — play/stop/restart controls, state indicators
- [ ] #62: Clickable Error Links — `file:line:col` parsing, jump-to-error
- [ ] #63: Compound Profile Execution — sequential steps, stop-on-failure
- [ ] #64: Environment Variants — env file swapping by active variant

### #18: Run Profiles - UI Integration
- [ ] Profile selector dropdown in header toolbar (`[▶ Profile ▾]`)
- [ ] Play/stop/restart controls
- [ ] Running status indicator (green dot running, red dot failed)
- [ ] Output panel with streaming logs and clickable file:line:col
- [ ] Compound execution view with stage indicators
- [ ] Environment variant selector (`[env: dev ▾]`)
- [ ] Edit profile form (create/modify saved profiles)
- [ ] Profiles grouped by workspace with accent colors (depends on #48)
- [ ] Status bar: click running profile → opens output panel

> **Design spec ref:** Section 5 (Run Profiles UI)

---

## Milestone 5: Language Server Protocol

### #19: LSP - Client Implementation
- [ ] JSON-RPC 2.0 message handling
- [ ] Initialize/shutdown lifecycle
- [ ] textDocument/didOpen, didChange, didSave
- [ ] Support stdio and TCP transports

### #20: LSP - TypeScript Integration
- [ ] Auto-detect TypeScript projects
- [ ] Start/stop tsserver appropriately
- [ ] Diagnostics, hover, go-to-definition

### #21: LSP - Diagnostics Display
- [ ] Underline errors/warnings in editor
- [ ] Gutter icons, problems panel
- [ ] Click to navigate to issue

### #22: LSP - Autocomplete
- [ ] Trigger on typing (configurable)
- [ ] Display completion items with icons and docs
- [ ] Insert with Tab/Enter, support snippets

---

## Milestone 6: Search

### #23: Search - ripgrep Integration
- [ ] Call rg binary with search parameters
- [ ] Parse structured results, respect .gitignore
- [ ] Support regex, case sensitivity, whole word

### #24: Search - UI Panel
- [ ] Search input with options (regex, case, whole word)
- [ ] Results grouped by file with context
- [ ] Click result to open file at location (Cmd+Shift+F)

### #25: Search - Find in File
- [ ] Cmd+F opens search bar in editor
- [ ] Highlight all matches, navigate between
- [ ] Replace and Replace All, regex support

---

## Milestone 7: Git Integration

### #26: Git - Status Display
- [ ] Show current branch in status bar
- [ ] Color-code modified/added/deleted files in explorer
- [ ] Refresh on file system changes

### #27: Git - Basic Operations
- [ ] Stage/unstage files, commit with message
- [ ] Pull/push, branch switching
- [ ] Error handling for conflicts

---

## UI/UX Polish (COMPLETE)

### #35: Panel Resize & Collapse System ✅
Drag-to-resize handles between all panel junctions, collapse/expand chevrons, CSS variable-driven sizing, min-size constraints.

### #36: Icon System & Dark Background Fixes ✅
currentColor SVGs, sidebar active indicators, devicons light fills for dark backgrounds, binary file type icons.

---

## Performance

### #37: File Tree Virtualization & Lazy Loading
Virtual scrolling for 10k+ file trees, lazy-load directory children on expand.

### #38: TreeNode Memoization
`React.memo` with custom comparison to prevent re-renders of unchanged tree nodes.

### #39: Dynamic CodeMirror Language Loading
Dynamic `import()` for language extensions per file type to reduce initial bundle.

---

## Dependency Upgrades (COMPLETE)

### #40: Upgrade TypeScript, Vite & Test Tooling ✅
TypeScript 5.7+, Vite 6.x, @swc/jest, path aliases, optimizeDeps.

---

## Code Quality

### #41: Split Zustand Store into Domain Slices
Split monolithic store into workspace/fileTree/editor/terminal/ui slices.

### #42: Fix Hardcoded macOS Paths
Cross-platform path handling for macOS, Linux, and Windows support.

---

## Accessibility

### #43: Accessibility Improvements (WCAG AA)
Fix contrast ratios, skip-to-content link, aria-busy, roving tabindex for tree, aria-live regions.

---

## Future Features

### #44: Command Palette
Cmd+Shift+P opens fuzzy-search command palette with keyboard shortcuts display.

### #45: Context Menus
Right-click menus for file explorer (new/rename/delete/copy path) and editor tabs (close/close others).

### #46: Breadcrumb Navigation
Clickable file path breadcrumbs above editor with sibling dropdown navigation.

### AI Chat Panel (v1.5)
Claude integration with context-aware code assistance, diff preview, provider architecture.

### gRPC Service Integration (v2.0+)
Service Adapter Pattern for connecting to external backends.

---

## Bug Fixes

### #33: Window Dragging Not Working
Window cannot be dragged from header area on macOS.

### #34: Add Button Type Attributes
Missing explicit `type` attributes on non-submit buttons.

---

## Infrastructure (COMPLETE)

### #28: Testing - Setup Jest + React Testing Library ✅
### #29: Testing - Setup Go Tests ✅
### #30: CI/CD - GitHub Actions ✅
### #31: Code Quality - ESLint + Prettier ✅
### #32: Documentation - Architecture Guide ✅

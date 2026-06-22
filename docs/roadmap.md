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
| Milestone 2: Terminal Integration | **IN PROGRESS** | #10-12 + #116 complete, #47 open |
| Milestone 3: Workspace Management | **COMPLETE** | #13-15, #53-54 complete |
| Milestone 4: Run Profiles | **IN PROGRESS** | #16-17, #59-64 complete; #18, #71, #103, #107 open |
| Milestone 5: Language Server Protocol | **COMPLETE** | #19-22, #73-76 complete |
| Milestone 6: Search | **COMPLETE** | #23-25 |
| Milestone 7: Git Integration | Not started | #26-27 |
| Performance | **IN PROGRESS** | #38 complete; #37 virtualization shipped (#111), lazy-load deferred; #39 open |
| Editor & LSP DX | **IN PROGRESS** | #113/#114 theme system + #119 picker a11y shipped; #112 open |
| Dependency Upgrades | **COMPLETE** | #40 |
| Code Quality | Not started | #41-42 |
| Accessibility | Not started | #43 |
| Future Features | Not started | #44-46 |
| Bug Fixes | Not started | #33-34 |

---

## Next Priorities

Current status: **Editor theme system + diagnostic tooltip (#113/#114) shipped via PR #117** — 7 selectable syntax themes (default Abyssal Current, refactored `palettes.ts`/`buildTheme` registry), StatusBar popover picker, Python highlight overlay (self/cls, builtins, decorators, kwargs via a syntax-tree decoration overlay), palette-tinted gutter, opaque lint tooltip; picker keyboard-focus polish in #119. Also shipped: **terminal PTY-exhaustion actionable error (#116)** and **file-tree / tab-bar scrollbar fixes (#118)**. Milestone 3 (Workspace Management) complete; file-tree virtualization shipped (#37/#38, PR #111). The #17 Run Profiles Execution Engine epic (#59-64) is complete; remaining Run Profiles work is the UI layer. Lazy-loading (#37 Phase 2) deferred to its own spec.

1. **#18 / #71: Run Profiles UI Integration and Activated State** — profile selector dropdown, edit form, activation working set, and selection persistence. **#71 also now owns the Run-Profiles-by-workspace view filtering/grouping** deferred from #54 (Workspace View filters to the active workspace; Project View groups by workspace) — prerequisite is per-workspace detection so profiles carry an owning workspace.
2. **#107: LANES output view polish** — resizable stdout/stderr columns, STDERR header glyph color, and sticky-header bleed-through on scroll (UI-only follow-up).
3. **#103: Formalize run execution identity for compound profiles** — follow-up hardening spun out of #63.
4. **#47: Terminal shell integration** — error markers & command separators (last open item in Milestone 2).
5. **#112: Editor & LSP developer experience** (surfaced while testing the Python workspace during #111): auto-provision language servers + wire the project environment (zero-config, no raw error). The larger remaining Editor/LSP item now that #113/#114 are shipped.
6. **#37 (Phase 2): File tree lazy loading** — load directory children on expand; own spec (backend per-dir read, watcher reconcile, #54 scoped-tree/active-file reconciliation).
7. **NEW (needs issue): Workspace-colored open-file tabs** — surfaced while reviewing #117: open editor tabs should always carry their owning workspace's accent (tab/font) regardless of the active workspace, so files are instantly attributable; future stretch is filtering open tabs to the active workspace. Bundle the **button-in-button DOM fix** in the editor tab bar (close `<button>` nested inside the tab `<button role="tab">` → React hydration warning) since it touches the same component.

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

## Milestone 2: Terminal Integration (IN PROGRESS)

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

### #14: Workspace - Persistence ✅
- [x] Save/restore open files, cursor positions, scroll state
- [x] Save panel sizes and layout
- [x] Save active workspace/folder
- [x] Store in `~/.firn/workspaces/`

### #15: Workspace - Recent Projects ✅
- [x] Store recent opened folders
- [x] Display in workspace menu
- [x] Click to reopen project

### #53: Workspace - Identity & Accent System (COMPLETE)
Defines workspace identity: type, accent color, and how workspaces are configured within a repo.
- [x] Workspace configuration schema (name, root dir, type, accent color)
- [ ] Store workspace definitions in `.firn/workspaces.json` (deferred — detection is read-only/in-memory; see design spec §1)
- [x] Auto-detect workspace type from content (package.json → Frontend, go.mod → Go, etc.)
- [x] CSS accent system wired to active workspace (`.ide--accent-blue`, `.ide--accent-green`, etc.)
- [x] Workspace selector dropdown in header (with accent dot per workspace)
- [x] `⌘⇧.` keyboard shortcut for quick workspace switching

> **Design spec ref:** Sections 2 (Accent Colors), 4 (Workspace Model & Multi-Workspace Editing)

### #54: Workspace - File Tree Views (NEW)
Project View (unified) vs Workspace View (focused) with color-coded regions.
- [x] Segmented PROJECT / WORKSPACE toggle at top of file tree panel
- [x] Project View: full repo tree with color-coded workspace regions (~6% accent tint)
- [x] Workspace View: scoped tree with workspace tabs for switching
- [x] File type association for tinting (e.g., `docker-compose.yml` gets Infrastructure tint at root)

> **Bridge note:** Run Profiles grouping/filtering by view intentionally deferred to #71/#18; the Run Profiles panel behavior is unchanged across tree views.

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

### #17: Run Profiles - Execution Engine [Epic] ✅
Sub-issues:
- [x] #59: Core Process Runner — `os/exec` implementation, env/cwd/envFile, start/stop bindings
- [x] #60: Output Streaming — pipe stdout/stderr, Wails events, output panel
- [x] #61: Process Lifecycle UI — play/stop/restart controls, state indicators
- [x] #62: Clickable Error Links — `file:line:col` parsing, stable run-time working-dir resolution, jump-to-error
- [x] #63: Compound Profile Execution — sequential steps, stop-on-failure
- [x] #64: Environment Variants — env file swapping by active variant

### #71: Run Profiles - Activated State, Section Reorganization, and Selection Persistence
- [ ] Activated profile working set
- [ ] Reorganize sections into Activated, Pinned, and Detected
- [ ] Persist activation state per workspace
- [ ] Header counter with active/total counts

### #18: Run Profiles - UI Integration
- [ ] Profile selector dropdown in header toolbar (`[▶ Profile ▾]`)
- [x] Play/stop/restart controls in run profile cards
- [x] Running status indicators and status badges
- [x] Output panel with streaming logs
- [x] Clickable file:line:col output links with historical working-dir stability
- [x] Compound execution view with stage indicators
- [x] Environment variant selector (`[env: dev ▾]`)
- [ ] Edit profile form (create/modify saved profiles)
- [ ] Profiles grouped by workspace with accent colors (depends on #53)
- [x] Status bar / output focus integration for running profiles

> **Design spec ref:** Section 5 (Run Profiles UI)

### #107: Run Profiles - LANES Output View Polish
UI-only follow-up on the run-output LANES tab.
- [ ] Resizable stdout/stderr columns (currently hard-split 50/50 via `flex: 1`)
- [ ] STDERR header glyph color (final letter renders off-color; likely sticky-header bleed-through)
- [ ] Sticky header bleed-through — virtualized rows paint over the header on fast scroll; remove the `.outputContent` top-padding gap above `top: 0`

### Run-output preview (shipped, PR #106)
- [x] Scrollable in-card output preview (`overflow-y: auto`, taller `max-height`)
- [x] Click/keyboard-activatable preview opens the full virtualized Output tab; selection-safe click

---

## Milestone 5: Language Server Protocol (COMPLETE)

### #74: LSP - Language Intelligence [Epic] ✅
Epic for Firn's production LSP foundation and TypeScript vertical slice.
- [x] Backend LSP foundation
- [x] Frontend document sync
- [x] Diagnostics UX and Problems panel
- [x] Completion, hover, and definition UX
- [x] TypeScript project-root detection completion (#20)
- [x] Go/Python project-root detection completion (#75/#76 via PR #96)

### #19: LSP - Client Foundation ✅
- [x] JSON-RPC 2.0 message handling
- [x] Initialize/shutdown lifecycle
- [x] `textDocument/didOpen`, `didChange`, `didSave`, `didClose`
- [x] stdio transport
- [x] Capability negotiation and storage
- [x] Path/URI normalization for macOS, Linux, and Windows
- [x] Crash detection and safe restart behavior
- [x] Graceful teardown on last document close and app shutdown
- [x] Request timeout/cancellation plumbing
- [x] Backend diagnostics, status, and error events

### #73: LSP - Frontend Document Sync ✅
- [x] Send `didOpen` for newly opened/restored editor files
- [x] Maintain per-file document versions
- [x] Debounced `didChange` without dropping latest state
- [x] Send `didSave` after successful save
- [x] Send `didClose` on tab close and workspace switch
- [x] Reconnect handling after language-server crash recovery
- [x] Surface backend LSP status/errors through frontend events

### #20: LSP - TypeScript Integration ✅
- [x] PR #95 merged into `develop` with per-package TypeScript project-root detection and nested-root reconnect handling
- [x] Auto-detect TypeScript/JavaScript projects by nearest `tsconfig.json`, `jsconfig.json`, or `package.json` (bounded by active workspace)
- [x] Resolve `typescript-language-server` from project-local install first, then PATH
- [x] Launch `typescript-language-server --stdio`
- [x] Start/stop the server based on open TS/JS documents (per detected project root, so monorepo packages get separate servers)
- [x] Route diagnostics, hover, definition, and completion requests through the shared client
- [x] Surface actionable errors when server startup fails

### #21: LSP - Diagnostics UX & Problems Panel ✅
- [x] Convert LSP diagnostics into CodeMirror lint diagnostics
- [x] Editor underlines and lint gutter markers
- [x] Problems tab grouped by file
- [x] Click diagnostics to open and position the editor
- [x] Status bar counts derived from `lspStore`
- [x] Clear stale diagnostics on workspace switch

### #22: LSP - Completion, Hover & Definition UX ✅
- [x] CodeMirror completion source backed by LSP completion requests
- [x] Trigger-character support and non-blocking request behavior
- [x] Completion details, documentation, and snippets
- [x] Hover tooltips backed by LSP hover responses
- [x] F12 and Cmd/Ctrl-click go-to-definition
- [x] Cross-file definition navigation through the existing editor open flow

### #75: LSP - Go Integration ✅
- [x] Auto-detect Go workspaces by nearest `go.mod`
- [x] Resolve and launch `gopls` through the shared LSP client
- [x] Use shared diagnostics, hover, definition, and completion plumbing
- [x] Handle multi-module edge cases explicitly through nearest-module root routing

### #76: LSP - Python Integration ✅
- [x] Auto-detect Python projects by nearest `pyproject.toml`, `requirements.txt`, or `setup.py`
- [x] Resolve `pyright-langserver` from active virtual environment before PATH
- [x] Resolve and launch `pyright-langserver --stdio` through the shared LSP client
- [x] Use shared diagnostics, hover, definition, and completion plumbing

---

## Milestone 6: Search (COMPLETE)

### #23: Search - ripgrep Integration ✅
- [x] Call `rg` with structured arguments
- [x] Parse JSON results and respect ignore files
- [x] Support regex, case sensitivity, and whole word
- [x] Typed statuses for no matches, missing tool, invalid regex, canceled, and failed

### #24: Search - UI Panel ✅
- [x] Search input with regex, case, and whole-word toggles
- [x] Results grouped by file with context and highlights
- [x] Cmd+Shift+F opens workspace search
- [x] Click result to open the file at the match location
- [x] Keyboard navigation and robust loading/error states

### #25: Search - Find in File ✅
- [x] Cmd+F opens CodeMirror's in-file search panel
- [x] Highlight all matches and navigate between them
- [x] Replace and Replace All through CodeMirror search
- [x] Regex support

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

### #37: File Tree Virtualization & Lazy Loading (IN PROGRESS)
- [x] **Virtualization + memoization — shipped (PR #111).** Pure `flattenVisibleTree` lowers the expanded tree into a flat `FlatRow[]` (precomputed region accent + aria level/setsize/posinset); `@tanstack/react-virtual` mounts only the visible window; `TreeRow` is `React.memo` over primitive props. The region resolver runs once per visible row instead of per node per render. Off-screen rows do not mount (5k-node tree → bounded window, asserted by a regression test). WAI-ARIA single-tab-stop keyboard nav via `aria-activedescendant`. Selected/active rows inherit their region/workspace accent (consistent Project + Workspace views).
- [ ] **Lazy loading — Phase 2 (remaining).** Load directory children on expand: backend `ReadDirectory`-per-dir, file-watcher reconcile, and reconciling #54 assumptions (scoped-tree lookup, region resolver, active-file ancestor-expand all currently assume the full eager tree). Deferred to its own spec.

### #38: TreeNode Memoization ✅
Shipped in PR #111 (closed). Flattening lowers `expandedPaths` (a fresh `Set` each update) and the region resolver (a closure) into per-row primitives, so `React.memo` on the row actually holds; toggling/selecting re-renders only changed rows.

### #39: Dynamic CodeMirror Language Loading
Dynamic `import()` for language extensions per file type to reduce initial bundle.

---

## Editor & LSP Developer Experience (NEW)

Surfaced while testing a Python workspace (`quantum_trader`) during the file-tree work (#111).

### #112: LSP - auto-provision language servers + wire project environment
Zero-config language support. Two layers: (a) provision the server **binary** itself (managed download of a pinned version into an app cache — e.g. `basedpyright` standalone to avoid a Node dependency — never the user's global env), and (b) auto-detect and forward the project **environment** (interpreter/venv, `extraPaths` for `src` layouts, `pythonVersion`) via `workspace/configuration` / `didChangeConfiguration`. Today `resolvePythonServer` finds only the binary and sends no env, so imports report false errors. Must generalize to gopls/tsserver/rust-analyzer and degrade to actionable UI (select interpreter / create venv / retry), never a raw error string.

### #113: Editor - diagnostic hover tooltip has no background ✅
Shipped: the lint tooltip content (`.cm-tooltip-lint`, which renders inside the intentionally-transparent `.cm-tooltip-hover` container) now gets an opaque surface — background, border, padding, shadow, z-index — with per-severity (error/warning/info/hint) left-accent borders, all from the shared chrome design tokens.

### #114: Editor - syntax highlighting color enhancements ✅
Shipped as a **selectable syntax theme system**: `theme.ts` refactored into a pure palette registry (`palettes.ts`) + builders (`buildHighlightStyle` / `buildChrome` / `buildTheme`); 7 themes (Firn Glacier refined, Solar Flare, Tropic Coral Reef, Nebula Jewel, Ember Bifrost, Aurora Bloom, and the default Abyssal Current with its own deeper canvas), live-swapped via the editor `themeCompartment`, chosen from a StatusBar picker, and persisted globally in `localStorage`. Follow-up: per-workspace theme override (Go workspace field + regenerated bindings) and an optional darker-canvas toggle for the other themes.

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
Likely fixed in code via Wails macOS titlebar configuration and `--wails-draggable: drag` on the header; keep open until verified in a packaged macOS app smoke test.

### #34: Add Button Type Attributes
Missing explicit `type` attributes on non-submit buttons.

---

## Infrastructure (COMPLETE)

### #28: Testing - Setup Jest + React Testing Library ✅
### #29: Testing - Setup Go Tests ✅
### #30: CI/CD - GitHub Actions ✅
### #31: Code Quality - ESLint + Prettier ✅
### #32: Documentation - Architecture Guide ✅

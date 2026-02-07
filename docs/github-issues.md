# GitHub Issues - Flux IDE

Implementation roadmap. Flux is first and foremost an IDE.

**Last updated:** 2026-02-06
**UI/UX Review:** Findings from `docs/ui-ux-review-report.md` are tracked in Issues #35-44.

---

## Progress Summary

| Milestone | Status | Issues |
|-----------|--------|--------|
| Infrastructure | **COMPLETE** | #26-30 |
| Milestone 1: Core File Operations | **IN PROGRESS** | #1-7 (6/7 done) |
| Milestone 2: Terminal Integration | Not started | #8-10 |
| Milestone 3: Workspace Management | Not started | #11-13 |
| Milestone 4: Run Profiles | Not started | #14-16 |
| Milestone 5: Language Server Protocol | Not started | #17-20 |
| Milestone 6: Search | Not started | #21-23 |
| Milestone 7: Git Integration | Not started | #24-25 |
| UI/UX Polish | Not started | #33-34 |
| Performance | Not started | #35-37 |
| Dependency Upgrades | Not started | #38 |
| Code Quality | Not started | #39-40 |
| Accessibility | Not started | #41 |
| Future Features | Not started | #42-44 |
| Bug Fixes / Polish | Not started | #31-32 |

---

## Milestone 1: Core File Operations

### Issue #1: File System - Read Directory Tree ✅
**Labels:** `enhancement`, `backend`, `priority:high`
**Commit:** `5171d52` (PR #40)

**Description:**
Implement Go backend function to read and return directory tree structure for the file explorer.

**Acceptance Criteria:**
- [x] `ReadDirectory(path string)` returns nested file/folder structure
- [x] Respects `.gitignore` patterns
- [x] Returns file metadata (size, modified date, type)
- [x] Handles permission errors gracefully
- [x] Unit tests with mock filesystem

---

### Issue #2: File System - Read File Contents ✅
**Labels:** `enhancement`, `backend`, `priority:high`
**Commit:** `d99fe47` (PR #43)

**Description:**
Implement Go backend function to read file contents with encoding detection.

**Acceptance Criteria:**
- [x] `ReadFile(path string)` returns file content as string
- [x] Detects and handles UTF-8, UTF-16, Latin-1 encodings
- [x] Returns file metadata (encoding, line endings, size)
- [x] Handles binary file detection
- [x] Unit tests for various file types

---

### Issue #3: File System - Write File Contents ✅
**Labels:** `enhancement`, `backend`, `priority:high`
**Commit:** `4c6e741` (PR #44)

**Description:**
Implement Go backend function to write/save file contents.

**Acceptance Criteria:**
- [x] `WriteFile(path string, content string)` saves file
- [x] Preserves original encoding and line endings
- [x] Creates backup before overwrite (configurable)
- [x] Handles write permission errors
- [x] Unit tests including error cases

---

### Issue #4: File System - Watch for Changes ✅
**Labels:** `enhancement`, `backend`, `priority:medium`
**Commit:** `3f94991` (PR #45)

**Description:**
Implement file system watcher to detect external changes.

**Acceptance Criteria:**
- [x] Watch workspace directory for changes
- [x] Debounce rapid changes (100ms)
- [x] Emit events: created, modified, deleted, renamed
- [x] Efficient - no polling, use OS-native events
- [x] Unit tests with simulated file changes

---

### Issue #5: File Explorer - Display Directory Tree ✅
**Labels:** `enhancement`, `frontend`, `priority:high`
**Commit:** `cc3e077` (PR #46)

**Description:**
Connect file explorer UI to backend directory reading.

**Acceptance Criteria:**
- [x] Display folder/file tree from backend data
- [x] Expand/collapse folders
- [x] File type icons based on extension
- [x] Loading states and error handling
- [x] Click to open file in editor
- [x] Integration tests

---

### Issue #6: Editor - Open Files from Explorer ✅
**Labels:** `enhancement`, `frontend`, `priority:high`
**Commit:** `8d20874` (PR #48)

**Description:**
Wire up file explorer clicks to open files in the editor.

**Acceptance Criteria:**
- [x] Single click selects, double click opens
- [x] File content loaded into CodeMirror
- [x] Tab created for opened file
- [x] Language detection from extension
- [x] Handle large files gracefully
- [x] Integration tests

---

### Issue #7: Editor - Autosave (JetBrains-style) ⬅️ NEXT
**Labels:** `enhancement`, `frontend`, `backend`, `priority:high`

**Description:**
Implement JetBrains-style autosave: files save automatically on idle and focus loss. No manual save required, but Cmd+S still works for muscle memory. No "unsaved changes" dialogs needed.

**Acceptance Criteria:**
- [ ] Debounced autosave after ~1.5s of idle (no typing)
- [ ] Immediate save on editor/app focus loss
- [ ] Cmd+S / Ctrl+S triggers explicit save
- [ ] Calls backend WriteFile with correct encoding/lineEndings
- [ ] Clears modified indicator on successful save
- [ ] Shows error toast on save failure
- [ ] Store latest editor content in Zustand for save access
- [ ] Integration tests

---

## Milestone 2: Terminal Integration

### Issue #8: Terminal - PTY Backend
**Labels:** `enhancement`, `backend`, `priority:high`

**Description:**
Implement pseudo-terminal (PTY) in Go backend.

**Acceptance Criteria:**
- [ ] Create PTY session with shell (bash/zsh)
- [ ] Bidirectional communication (stdin/stdout)
- [ ] Handle terminal resize (SIGWINCH)
- [ ] Support ANSI escape codes
- [ ] Clean session termination
- [ ] Unit tests

---

### Issue #9: Terminal - xterm.js Integration
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Replace terminal placeholder with xterm.js terminal emulator.

**Acceptance Criteria:**
- [ ] Install and configure xterm.js
- [ ] Connect to backend PTY via Wails bindings
- [ ] Render terminal output with ANSI colors
- [ ] Send keyboard input to backend
- [ ] Handle resize events
- [ ] Match Deep Ocean theme
- [ ] Integration tests

---

### Issue #10: Terminal - Multiple Sessions
**Labels:** `enhancement`, `frontend`, `priority:medium`

**Description:**
Support multiple terminal sessions with tabs.

**Acceptance Criteria:**
- [ ] Create new terminal tab
- [ ] Switch between terminal sessions
- [ ] Close terminal session
- [ ] Rename terminal tabs
- [ ] Kill process on tab close
- [ ] Integration tests

---

## Milestone 3: Workspace Management

### Issue #11: Workspace - Open Folder Dialog
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Implement "Open Folder" functionality using native dialog.

**Acceptance Criteria:**
- [ ] Menu item and keyboard shortcut (Cmd+O)
- [ ] Native folder picker dialog
- [ ] Load selected folder into file explorer
- [ ] Update window title with folder name
- [ ] Integration tests

---

### Issue #12: Workspace - Persistence
**Labels:** `enhancement`, `backend`, `priority:medium`

**Description:**
Save and restore workspace state between sessions.

**Acceptance Criteria:**
- [ ] Save open files, cursor positions, scroll state
- [ ] Save panel sizes and layout
- [ ] Save active workspace/folder
- [ ] Restore state on app launch
- [ ] Store in `~/.flux/workspaces/`
- [ ] Unit tests

---

### Issue #13: Workspace - Recent Projects
**Labels:** `enhancement`, `frontend`, `priority:medium`

**Description:**
Track and display recently opened projects.

**Acceptance Criteria:**
- [ ] Store last 10 opened folders
- [ ] Display in welcome screen
- [ ] Display in File menu
- [ ] Click to reopen project
- [ ] Clear recent projects option
- [ ] Integration tests

---

## Milestone 4: Run Profiles

### Issue #14: Run Profiles - Configuration Schema
**Labels:** `enhancement`, `backend`, `priority:high`

**Description:**
Define and implement run profile configuration format.

**Acceptance Criteria:**
- [ ] JSON/YAML schema for profiles
- [ ] Fields: name, command, cwd, env, envFile
- [ ] Auto-detect from package.json, go.mod, Makefile
- [ ] Validate profile configuration
- [ ] Unit tests

---

### Issue #15: Run Profiles - Execution Engine
**Labels:** `enhancement`, `backend`, `priority:high`

**Description:**
Execute run profiles and capture output.

**Acceptance Criteria:**
- [ ] Start process with configured env/cwd
- [ ] Stream stdout/stderr to frontend
- [ ] Handle process termination
- [ ] Support stop/restart
- [ ] Parse clickable file:line:col references
- [ ] Unit tests

---

### Issue #16: Run Profiles - UI Integration
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Wire up run profiles panel to execution engine.

**Acceptance Criteria:**
- [ ] Display configured profiles
- [ ] Play/stop buttons per profile
- [ ] Show running status indicator
- [ ] Output panel with streaming logs
- [ ] Click file references to open editor
- [ ] Integration tests

---

## Milestone 5: Language Server Protocol

### Issue #17: LSP - Client Implementation
**Labels:** `enhancement`, `backend`, `priority:high`

**Description:**
Implement LSP client in Go backend.

**Acceptance Criteria:**
- [ ] JSON-RPC 2.0 message handling
- [ ] Initialize/shutdown lifecycle
- [ ] textDocument/didOpen, didChange, didSave
- [ ] Support stdio and TCP transports
- [ ] Unit tests with mock server

---

### Issue #18: LSP - TypeScript Integration
**Labels:** `enhancement`, `backend`, `priority:high`

**Description:**
Integrate typescript-language-server.

**Acceptance Criteria:**
- [ ] Auto-detect TypeScript projects
- [ ] Start/stop tsserver appropriately
- [ ] Diagnostics (errors, warnings)
- [ ] Hover information
- [ ] Go to definition
- [ ] Integration tests

---

### Issue #19: LSP - Diagnostics Display
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Display LSP diagnostics in editor and problems panel.

**Acceptance Criteria:**
- [ ] Underline errors/warnings in editor
- [ ] Gutter icons for lines with issues
- [ ] Problems panel with full list
- [ ] Click to navigate to issue
- [ ] Filter by severity
- [ ] Integration tests

---

### Issue #20: LSP - Autocomplete
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Integrate LSP completions with CodeMirror autocomplete.

**Acceptance Criteria:**
- [ ] Trigger on typing (configurable)
- [ ] Display completion items with icons
- [ ] Show documentation on hover
- [ ] Insert completion with Tab/Enter
- [ ] Support snippets
- [ ] Integration tests

---

## Milestone 6: Search

### Issue #21: Search - ripgrep Integration
**Labels:** `enhancement`, `backend`, `priority:medium`

**Description:**
Integrate ripgrep for fast full-text search.

**Acceptance Criteria:**
- [ ] Call rg binary with search parameters
- [ ] Parse and return structured results
- [ ] Support regex, case sensitivity, whole word
- [ ] Respect .gitignore
- [ ] Handle large result sets (pagination)
- [ ] Unit tests

---

### Issue #22: Search - UI Panel
**Labels:** `enhancement`, `frontend`, `priority:medium`

**Description:**
Implement search panel in sidebar.

**Acceptance Criteria:**
- [ ] Search input with options (regex, case, whole word)
- [ ] Display results grouped by file
- [ ] Show match context (surrounding lines)
- [ ] Click result to open file at location
- [ ] Keyboard shortcut (Cmd+Shift+F)
- [ ] Integration tests

---

### Issue #23: Search - Find in File
**Labels:** `enhancement`, `frontend`, `priority:medium`

**Description:**
Implement in-file search with CodeMirror.

**Acceptance Criteria:**
- [ ] Cmd+F opens search bar in editor
- [ ] Highlight all matches
- [ ] Navigate between matches (Enter, Shift+Enter)
- [ ] Replace and Replace All
- [ ] Regex support
- [ ] Integration tests

---

## Milestone 7: Git Integration

### Issue #24: Git - Status Display
**Labels:** `enhancement`, `backend`, `priority:medium`

**Description:**
Display git status in file explorer and status bar.

**Acceptance Criteria:**
- [ ] Show current branch in status bar
- [ ] Color-code modified/added/deleted files in explorer
- [ ] Show untracked files
- [ ] Refresh on file system changes
- [ ] Unit tests

---

### Issue #25: Git - Basic Operations
**Labels:** `enhancement`, `backend`, `priority:low`

**Description:**
Implement basic git operations.

**Acceptance Criteria:**
- [ ] Stage/unstage files
- [ ] Commit with message
- [ ] Pull/push
- [ ] Branch switching
- [ ] Error handling for conflicts
- [ ] Unit tests

---

## Infrastructure / DevEx (ALL COMPLETE)

### Issue #26: Testing - Setup Jest + React Testing Library ✅
**Commit:** `9642953` (PR #35)

**Acceptance Criteria:**
- [x] Jest configuration for TypeScript
- [x] React Testing Library setup
- [x] Coverage reporting
- [x] CI integration
- [x] Example tests for existing components

---

### Issue #27: Testing - Setup Go Tests ✅
**Commit:** `94d5ecf` (PR #37)

**Acceptance Criteria:**
- [x] Go test configuration
- [x] Mock interfaces for file system, processes
- [x] Coverage reporting
- [x] CI integration
- [x] Example tests for app.go

---

### Issue #28: CI/CD - GitHub Actions ✅
**Commit:** `5f1b73a` (PR #38)

**Acceptance Criteria:**
- [x] Run tests on PR
- [x] Lint checks (ESLint, golangci-lint)
- [x] Build verification
- [x] Release builds for macOS/Linux
- [ ] Automated changelog (deferred)

---

### Issue #29: Code Quality - ESLint + Prettier ✅
**Commit:** `f9a1054` (PR #36)

**Acceptance Criteria:**
- [x] ESLint config with TypeScript rules
- [x] Prettier config
- [x] Pre-commit hooks with husky
- [x] npm scripts for lint/format
- [x] Fix existing lint issues

---

### Issue #30: Documentation - Architecture Guide ✅
**Commit:** `1e55907` (PR #39)

**Acceptance Criteria:**
- [x] Component diagram
- [x] Data flow documentation
- [x] State management patterns
- [x] Adding new features guide
- [x] Wails bindings documentation

---

## UI/UX Polish

### Issue #33: Panel Resize & Collapse System
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Port the panel resize/collapse system from flux-ml. Panels should be resizable by dragging the border between them, with collapse/expand chevron buttons at each panel junction. Reference implementation: `flux-ml/frontend/src/hooks/useResize.ts` and `flux-ml/frontend/src/components/views/ExperimentsView.tsx`.

**Resize handles needed:**
- Left panel ↔ Center (vertical drag)
- Center ↔ Right panel (vertical drag, inverted)
- Center ↔ Bottom panel (horizontal drag, inverted)

**Collapse/expand buttons:**
- Left edge: chevron to collapse left panel, expand button when collapsed
- Right edge: chevron to collapse right panel, expand button when collapsed
- Bottom edge: chevron to toggle bottom panel collapse

**Acceptance Criteria:**
- [ ] Create `useResize` hook (normal, inverted, vertical-inverted variants)
- [ ] Resize handles between all panel junctions (transparent, highlight on hover with accent-dim)
- [ ] Collapse/expand chevron buttons at left, right, and bottom panel edges
- [ ] CSS variables for panel sizes (`--panel-left-width`, `--panel-right-width`, `--panel-output-height`)
- [ ] Body cursor override during drag (`resizing-col` / `resizing-row`)
- [ ] Collapsed panels fully hidden; expand button appears at edge
- [ ] Min-size constraints enforced (100px width, 80px height)
- [ ] Layout state persisted (future: workspace persistence in Issue #12)
- [ ] Integration tests

---

### Issue #34: Icon System & Dark Background Fixes
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Overhaul icons to match flux-ml's system. Use `currentColor` for all SVG icons so they inherit text color and are visible against dark backgrounds. Sidebar/activity bar icons should use `color: var(--color-text-muted)` at rest, `var(--color-accent)` when active, with a left-edge accent indicator. Any black/dark-filled icons must be fixed to use light colors.

**Reference:** flux-ml's `createIcon` factory (`stroke="currentColor"`) and `Icon.css` (file type colors via CSS variables).

**Acceptance Criteria:**
- [ ] All SVG icons use `currentColor` (stroke or fill) — no hardcoded dark colors
- [ ] Sidebar icons: muted at rest, accent when active, with left-edge indicator bar
- [ ] File type icons colored via CSS variables (`--color-icon-folder`, etc.)
- [ ] Icon size variants (sm/md/lg) via CSS classes
- [ ] devicons-react icons (YAML, Markdown, etc.) have light fills for dark backgrounds
- [ ] Audit all icon usages for dark-on-dark visibility issues
- [ ] Integration tests

---

## Performance (from UI/UX Review)

### Issue #35: File Tree Virtualization & Lazy Loading
**Labels:** `enhancement`, `performance`, `priority:high`
**Source:** UI/UX Review C2, C4

**Description:**
The file tree renders all nodes without virtualization and loads the entire directory tree recursively on open. Projects with 10,000+ files will be sluggish. Implement virtual scrolling and on-demand child loading.

**Acceptance Criteria:**
- [ ] Virtual scrolling via `react-window` or `@tanstack/virtual` — only render visible nodes
- [ ] Lazy-load directory children on folder expand (not full recursive on open)
- [ ] Loading indicator during child fetch
- [ ] Cache loaded children in state
- [ ] Constant memory regardless of tree size
- [ ] Performance test: 10k file tree renders in <100ms

---

### Issue #36: TreeNode Memoization
**Labels:** `enhancement`, `performance`, `priority:medium`
**Source:** UI/UX Review 3.1

**Description:**
Wrap `TreeNode` in `React.memo` with custom comparison to prevent re-renders of unchanged nodes during tree operations.

**Acceptance Criteria:**
- [ ] `TreeNode` wrapped in `React.memo` with `path`, `isExpanded`, `selectedPath` comparison
- [ ] Verify reduced re-renders via React DevTools Profiler

---

### Issue #37: Dynamic CodeMirror Language Loading
**Labels:** `enhancement`, `performance`, `priority:medium`
**Source:** UI/UX Review 3.1

**Description:**
Currently all CodeMirror language extensions are eagerly loaded. Dynamically import language support per file type to reduce initial bundle size.

**Acceptance Criteria:**
- [ ] Language extensions loaded via `import()` when file opened
- [ ] Fallback to plain text while loading
- [ ] Languages cached after first load
- [ ] Bundle size reduction measured

---

## Dependency Upgrades (from UI/UX Review)

### Issue #38: Upgrade TypeScript, Vite & Test Tooling
**Labels:** `enhancement`, `devex`, `priority:high`
**Source:** UI/UX Review C3, 6

**Description:**
Core dependencies are significantly outdated: TypeScript 4.6.4 (2+ years behind), Vite 3.0.7. Upgrade for security, performance, and DX improvements.

**Acceptance Criteria:**
- [ ] TypeScript → 5.7+ (fix any type narrowing changes)
- [ ] Vite → 6.x (update config syntax, expect 30-50% faster builds)
- [ ] @vitejs/plugin-react → 4.x
- [ ] ts-jest → @swc/jest (10-20x faster test runs)
- [ ] Add `@/*` path aliases in tsconfig + vite config
- [ ] Add `optimizeDeps` and `server.warmup` to vite config
- [ ] All tests pass after upgrade
- [ ] CI pipeline passes

---

## Code Quality (from UI/UX Review)

### Issue #39: Split Zustand Store into Domain Slices
**Labels:** `enhancement`, `refactoring`, `priority:medium`
**Source:** UI/UX Review 3.2, 5

**Description:**
`ideStore.ts` is a 255-line monolithic store with 17 state properties. Split into focused domain slices for maintainability and to reduce unnecessary re-renders.

**Acceptance Criteria:**
- [ ] Split into slices: `workspaceSlice`, `fileTreeSlice`, `editorSlice`, `terminalSlice`, `uiSlice`
- [ ] Composed back into single store via Zustand `combine` or slice pattern
- [ ] All existing selector hooks still work
- [ ] DevTools integration preserved
- [ ] All tests pass

---

### Issue #40: Fix Hardcoded macOS Paths
**Labels:** `bug`, `priority:medium`
**Source:** UI/UX Review 1

**Description:**
Platform-specific paths (e.g., `/Users/`) are hardcoded in some locations. Use cross-platform path handling for macOS + Linux support.

**Acceptance Criteria:**
- [ ] Audit codebase for hardcoded OS-specific paths
- [ ] Replace with Go's `os.UserHomeDir()` / `filepath.Join()` on backend
- [ ] Frontend uses paths from backend, no assumptions about OS
- [ ] Tests pass on both macOS and Linux path patterns

---

## Accessibility (from UI/UX Review)

### Issue #41: Accessibility Improvements
**Labels:** `enhancement`, `accessibility`, `priority:medium`
**Source:** UI/UX Review 8

**Description:**
Address accessibility gaps identified in the UI/UX review to meet WCAG AA compliance.

**Acceptance Criteria:**
- [ ] Fix disabled text contrast ratio (currently 2.7:1, need 4.5:1) — increase to `#4a6070`
- [ ] Add skip-to-content link in header
- [ ] Add `aria-busy="true"` during loading states
- [ ] Implement roving tabindex for file tree arrow key navigation
- [ ] Announce tab changes with `aria-live` regions
- [ ] Add file count in explorer header for screen readers
- [ ] Keyboard shortcuts for panel show/hide

---

## Future Features (from UI/UX Review)

### Issue #42: Command Palette
**Labels:** `enhancement`, `frontend`, `priority:high`
**Source:** UI/UX Review C1, 7

**Description:**
Implement a VS Code-style command palette (Cmd+Shift+P) for action discovery with keyboard shortcuts. Distinct from file search (Cmd+P / Cmd+K).

**Acceptance Criteria:**
- [ ] Cmd+Shift+P opens command palette modal
- [ ] Fuzzy search over all available actions
- [ ] Display associated keyboard shortcuts
- [ ] Recently used actions prioritized
- [ ] Extensible action registry
- [ ] Focus trap and escape to close

---

### Issue #43: Context Menus
**Labels:** `enhancement`, `frontend`, `priority:medium`
**Source:** UI/UX Review 7

**Description:**
Right-click context menus for file explorer and editor tabs.

**Acceptance Criteria:**
- [ ] File explorer: New file, New folder, Rename, Delete, Copy path, Reveal in Finder
- [ ] Editor tab: Close, Close Others, Close All, Copy path
- [ ] Positioned at cursor, dismiss on click outside
- [ ] Keyboard accessible (Shift+F10 or context menu key)

---

### Issue #44: Breadcrumb Navigation
**Labels:** `enhancement`, `frontend`, `priority:low`
**Source:** UI/UX Review 7

**Description:**
Show current file path as clickable breadcrumb above the editor, allowing navigation to parent folders.

**Acceptance Criteria:**
- [ ] Display file path segments as clickable breadcrumbs
- [ ] Click segment to reveal siblings dropdown
- [ ] Updates when active file changes

---

## Bug Fixes / Polish

### Issue #31: Window Dragging Not Working
**Labels:** `bug`, `priority:high`

**Description:**
Window cannot be dragged from the header area on macOS.

**Steps to Reproduce:**
1. Launch app
2. Try to drag window from header
3. Only works on very edge of window frame

**Expected:** Dragging from header (non-button areas) should move window.

---

### Issue #32: Add Button Type Attributes
**Labels:** `bug`, `accessibility`, `priority:medium`

**Description:**
Buttons missing explicit `type` attribute default to "submit" which can cause issues.

**Acceptance Criteria:**
- [ ] Add `type="button"` to all non-submit buttons
- [ ] Audit all button elements

---

## Additional Commits (Infrastructure)

| Commit | Description |
|--------|-------------|
| `f3858db` | Initial commit: repository setup |
| `5a64b59` | feat: initial application scaffold (#1) (PR #34) |
| `f981b03` | refactor: organize Go code into layered package structure (#41) (PR #42) |
| `ae5a250` | docs: enhance README and reorganize assets for portfolio (PR #47) |
| `af48cce` | docs: add ML ops strategy and roadmap documents (PR #49) |

# GitHub Issues - Flux IDE

Draft issues for GitHub. Review and adjust before creating.

---

## Milestone 1: Core File Operations

### Issue #1: File System - Read Directory Tree
**Labels:** `enhancement`, `backend`, `priority:high`

**Description:**
Implement Go backend function to read and return directory tree structure for the file explorer.

**Acceptance Criteria:**
- [ ] `ReadDirectory(path string)` returns nested file/folder structure
- [ ] Respects `.gitignore` patterns
- [ ] Returns file metadata (size, modified date, type)
- [ ] Handles permission errors gracefully
- [ ] Unit tests with mock filesystem

---

### Issue #2: File System - Read File Contents
**Labels:** `enhancement`, `backend`, `priority:high`

**Description:**
Implement Go backend function to read file contents with encoding detection.

**Acceptance Criteria:**
- [ ] `ReadFile(path string)` returns file content as string
- [ ] Detects and handles UTF-8, UTF-16, Latin-1 encodings
- [ ] Returns file metadata (encoding, line endings, size)
- [ ] Handles binary file detection
- [ ] Unit tests for various file types

---

### Issue #3: File System - Write File Contents
**Labels:** `enhancement`, `backend`, `priority:high`

**Description:**
Implement Go backend function to write/save file contents.

**Acceptance Criteria:**
- [ ] `WriteFile(path string, content string)` saves file
- [ ] Preserves original encoding and line endings
- [ ] Creates backup before overwrite (configurable)
- [ ] Handles write permission errors
- [ ] Unit tests including error cases

---

### Issue #4: File System - Watch for Changes
**Labels:** `enhancement`, `backend`, `priority:medium`

**Description:**
Implement file system watcher to detect external changes.

**Acceptance Criteria:**
- [ ] Watch workspace directory for changes
- [ ] Debounce rapid changes (100ms)
- [ ] Emit events: created, modified, deleted, renamed
- [ ] Efficient - no polling, use OS-native events
- [ ] Unit tests with simulated file changes

---

### Issue #5: File Explorer - Display Directory Tree
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Connect file explorer UI to backend directory reading.

**Acceptance Criteria:**
- [ ] Display folder/file tree from backend data
- [ ] Expand/collapse folders
- [ ] File type icons based on extension
- [ ] Loading states and error handling
- [ ] Click to open file in editor
- [ ] Integration tests

---

### Issue #6: Editor - Open Files from Explorer
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Wire up file explorer clicks to open files in the editor.

**Acceptance Criteria:**
- [ ] Single click selects, double click opens
- [ ] File content loaded into CodeMirror
- [ ] Tab created for opened file
- [ ] Language detection from extension
- [ ] Handle large files gracefully
- [ ] Integration tests

---

### Issue #7: Editor - Save File
**Labels:** `enhancement`, `frontend`, `priority:high`

**Description:**
Implement file saving with keyboard shortcut.

**Acceptance Criteria:**
- [ ] Cmd+S / Ctrl+S triggers save
- [ ] Calls backend WriteFile
- [ ] Clears modified indicator on success
- [ ] Shows error toast on failure
- [ ] Unsaved changes warning on close
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

## Infrastructure / DevEx

### Issue #26: Testing - Setup Jest + React Testing Library
**Labels:** `enhancement`, `testing`, `priority:high`

**Description:**
Configure testing infrastructure for frontend.

**Acceptance Criteria:**
- [ ] Jest configuration for TypeScript
- [ ] React Testing Library setup
- [ ] Coverage reporting
- [ ] CI integration
- [ ] Example tests for existing components

---

### Issue #27: Testing - Setup Go Tests
**Labels:** `enhancement`, `testing`, `priority:high`

**Description:**
Configure testing infrastructure for backend.

**Acceptance Criteria:**
- [ ] Go test configuration
- [ ] Mock interfaces for file system, processes
- [ ] Coverage reporting
- [ ] CI integration
- [ ] Example tests for app.go

---

### Issue #28: CI/CD - GitHub Actions
**Labels:** `enhancement`, `devops`, `priority:medium`

**Description:**
Setup CI/CD pipeline.

**Acceptance Criteria:**
- [ ] Run tests on PR
- [ ] Lint checks (ESLint, golangci-lint)
- [ ] Build verification
- [ ] Release builds for macOS/Linux
- [ ] Automated changelog

---

### Issue #29: Code Quality - ESLint + Prettier
**Labels:** `enhancement`, `devex`, `priority:high`

**Description:**
Add linting and formatting configuration.

**Acceptance Criteria:**
- [ ] ESLint config with TypeScript rules
- [ ] Prettier config
- [ ] Pre-commit hooks with husky
- [ ] npm scripts for lint/format
- [ ] Fix existing lint issues

---

### Issue #30: Documentation - Architecture Guide
**Labels:** `documentation`, `priority:low`

**Description:**
Document system architecture for contributors.

**Acceptance Criteria:**
- [ ] Component diagram
- [ ] Data flow documentation
- [ ] State management patterns
- [ ] Adding new features guide
- [ ] Wails bindings documentation

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

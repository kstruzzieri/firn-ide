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
| Milestone 2: Terminal Integration | **COMPLETE** | #10-12 + #116 + #47 complete |
| Milestone 3: Workspace Management | **COMPLETE** | #13-15, #53-54 complete |
| Milestone 4: Run Profiles | **COMPLETE** | #16-17, #59-64 complete; #18/#71 Phase 1 (#123) + #71 P2 panel (#125) + P2 follow-ups/recency sidecar (#127) + #18 P3 header selector (#129) + lifecycle-script detection fix (#130) + #18 P4 create/edit form (#132) + UI polish (#133) + store persist rollback (#134) shipped → **#18/#71 closed**; LANES output #107 (#138) + #137 (#139) shipped; #103 run execution identity (#144) merged → epic complete |
| Milestone 5: Language Server Protocol | **COMPLETE** | #19-22, #73-76 complete |
| Milestone 6: Search | **COMPLETE** | #23-25 |
| Milestone 7: Git Integration | **COMPLETE** | #26-27 shipped (PR #162); follow-ups #163-#169 |
| Performance | **IN PROGRESS** | #38 complete; #37 virtualization (#111) + lazy directory loading Phase 2 (#147) shipped; follow-ups #148/#149; #39 open |
| Editor & LSP DX | **IN PROGRESS** | #113/#114 theme + #119 picker a11y; #112 Phase 1 env-wiring (#121) + Phase 2 managed provisioning (#150) shipped; per-file undo on tab switch #153 (#154) shipped; follow-ups #151/#152 |
| Dependency Upgrades | **COMPLETE** | #40 |
| Code Quality | Not started | #41-42 |
| Accessibility | Not started | #43 |
| Future Features | Not started | #44-46 |
| Bug Fixes | Not started | #33-34 |

---

## Next Priorities

Current status: **Milestone 7 (Git Integration) is complete and merged (PR #162, develop `eb43370`) — every planned milestone is now shipped.** Working-tree status in the file tree and status bar; a read-only side-by-side diff viewer with next/prev navigation, resizable columns, and a live editor-buffer diff; JetBrains-style commit panel with per-file include checkboxes, stage/commit/pull/push (Publish when there is no upstream), and workspace scoping via the ownership model; a portaled branch switcher shared between the header pill and the status bar; and gutter change bars with a peek popup showing a unified word-level inline diff and one-click revert-to-HEAD. The LSP hover was also reworked to highlight signatures with the file's real language parser (Go and all languages) and render doc links as clickable. Open Git follow-ups: **#163** hunk-level staging, **#164** 3-way merge UI, **#165** go-llm library integration (replace the golem shell-out), **#166** richer branch/VCS menu, **#167** intent-to-add for new files, **#169** editable diff. Other open follow-ups: #151/#152 (LSP provisioning Phase 3 + polish), #148/#149 (lazy-load watcher + nested gitignore), #146 (run-identity Phase 2), #142 (workspace-colored tabs), #168 (Structure view from document symbols).

Earlier: **Milestone 4 (Run Profiles) closed — #103 run execution identity merged via PR #144.** The overloaded `profileId` string (which carried saved-config, compound-aggregate, compound-step, process-key, and event-routing meanings) is replaced by a first-class `RunIdentity{runInstanceId, profileId, parentRunInstanceId?, stepIdx}` embedded in every run event. The executor keys processes/compounds by a per-`Executor` monotonic `runInstanceId` and tracks `activeByProfile` (retiring the old `processAliases`); the synthetic `compound:<base64>:<idx>` step keys and their reserved-namespace validation are deleted; the frontend stores route output by explicit fields with a `runInstanceId`-based stale-drop/rotate rule (no namespace parsing). Documented Stop/Restart/Status semantics: an idle/unknown id is an idempotent no-op, terminal status is retained only for top-level runs. Phase 1 only — **Phase 2** (single-profile output/tabs/history re-keyed to `runInstanceId`, per-run retained tabs, same-profile parallelism, persisted run history) is a separate follow-up ticket. With the #18/#71 UI epic and LANES (#107/#137) already shipped, **Milestone 4 is complete**.

Earlier: **Milestone 2 closed — #47 Terminal shell integration (OSC 133 error markers + command separators) shipped**: embedded zsh/bash wrapper scripts inject `precmd`/`preexec` hooks (fail-open to a plain shell), an xterm OSC 133 state machine renders red/neutral gutter markers + block separators, atomic wrapper writes for concurrent-creation safety, with PTY-gated emission tests. Also **Milestone 4 #18 Run Profiles UI complete — P4 create/edit form shipped via PR #132**, with a UI/UX polish follow-up (PR #133) and a store persist-failure rollback fix (PR #134). This closes the #18/#71 Run Profiles UI epic. The form is a panel-takeover create / edit / **customize** / delete surface for single profiles: a "Start from" detected-command picker, name + command, working directory (native folder picker, relativized to the repo root), inline `KEY=value` env rows with a duplicate-key guard, an env file, and round-tripped env variants. It is the first consumer of `SaveRunProfile` / `DeleteRunProfile` / `ValidateRunProfile`, which now **emit `runprofiles:changed` on success** so the list refreshes with backend-normalized fields (no optimistic store mutation). **Copy-on-write identity:** editing a detected profile reuses its id so the detected twin is suppressed via `combineUnitLocked` — no duplicate. PR #133 retuned the card color scheme to the workspace-accent palette (a deep-navy `--surface-base` card surface matching the bottom output panel, accent-tinted hover / selected / failed / running states, a filled Cmd+R-target dot + full-card highlight, click-anywhere-to-target) and fixed the header run/stop button rendering as a blank, off-center square (the icon components had no intrinsic size). PR #134 makes `Store.Save` / `Store.Delete` roll back their in-memory mutation when the disk write fails, so memory and disk can't diverge (the emit path made that observable). Remaining Run Profiles work: **#103** (compound execution identity hardening) — the LANES output work (#107 via PR #138, #137 via PR #139) is now shipped.

Earlier: **Milestone 4 #71 P2 closed — review follow-ups + recency sidecar shipped via PR #127** (on top of the P2 panel, PR #125). #127 closes the three open P2 review follow-ups: a nil-`executor` guard in `StartRunProfile` (mirrors `StopRunProfile`); **run recency split into the `.firn/run-recency.json` sidecar**, separate from `run-profiles.json` (now profile definitions + adoption only), so stamping a run writes the tiny sidecar *synchronously* and never rewrites profile definitions — fixing per-run write amplification at the root with no debounce timer (and therefore no orphaned-write race, no lost-on-SIGKILL window, and write errors surfaced to the caller); legacy v3 files that embedded recency migrate into the sidecar on load; and `Store.PruneState` drops stale recency-only `profileState` entries on load (saved+detected IDs valid) while preserving `adopted` entries through branch churn. Also a repo-hygiene commit: a `trimws` git clean filter + `.gitattributes` kills the perpetual trailing-whitespace churn Wails emits into `wailsjs/go/*.ts` on every build.

The **P2 panel (PR #125)** is a four-section working set (Working Set / Pinned / RECENT / Detected) driven by a pure `groupProfiles` selector, with per-workspace adoption persisted in `.firn/run-profiles.json` **v3** and run recency in the `.firn/run-recency.json` sidecar, a `RunProfilesSnapshot{profiles, profileState}` single hydration contract emitted on every `runprofiles:changed`, Workspace/Project views (reusing the tree-view toggle, single source of truth), view-scoped `● N running · M total` counters, and a 5-min-windowed workspace-accent "just-ran" highlight. New app bindings `AdoptRunProfile`/`UnadoptRunProfile`/`GetRunProfilesSnapshot`. Earlier: **Phase 1 (workspace-owned detection + identity) shipped via #123** — repo-scoped `ProjectRunProfileManager`, owning-workspace identity + workspace-scoped IDs, per-workspace store with v1→v2 migration, owner-routed save/pin/delete, plus detector hardening (language markers beat infra; infra split Docker/Terraform; dot-dirs skipped). Remaining Run Profiles UI: **P4** create/edit form (#18) — **P3** header `[▶ Profile ▾]` selector shipped via PR #129.

Earlier: **#112 Phase 1 (Python LSP environment auto-wiring) shipped via PR #121** — pyright now resolves imports/types in a standard `src`-layout uv/venv project with zero per-project config. New pure `internal/lsp/pythonenv` interpreter/venv detector; the client answers pyright's `workspace/configuration` pull (was replying `-32601` to all server requests — the root cause) and advertises the capability + `didChangeConfiguration`; a Manager-owned, dialect-agnostic `WorkspaceConfigProvider` forwards `pythonPath`/`venvPath`/`analysis.extraPaths`; raw server errors are replaced by a typed setup status + non-blocking `LSPSetupCard`. Earlier shipped: **editor theme system + diagnostic tooltip (#113/#114, PR #117)** with #119 picker focus polish, **terminal PTY-exhaustion actionable error (#116)**, **file-tree / tab-bar scrollbar fixes (#118)**. Milestone 3 (Workspace Management) complete; file-tree virtualization shipped (#37/#38, PR #111). The #17 Run Profiles Execution Engine epic (#59-64) is complete; remaining Run Profiles work is the UI layer. Lazy-loading (#37 Phase 2) deferred to its own spec.

1. **Git integration follow-ups (Milestone 7 shipped via PR #162)** — deepen the just-shipped feature. Highest value: **#163** hunk-level staging in the diff viewer (backend patch + `git apply --cached`); then **#167** intent-to-add (`git add -N`) so new files diff, **#166** richer branch/VCS menu, **#169** editable diff, **#164** 3-way merge UI, and **#165** replacing the golem CLI shell-out with the go-llm library for the AI commit message (go-llm PR #262 is merged).
2. **LSP managed provisioning follow-ups** (#112 Phase 2 shipped via PR #150) — **#151:** Phase 3 provisioning for `gopls`, `tsserver`, and `rust-analyzer` (the Python path is done). **#152:** polish — `configSource "override"` is never emitted so Reset-to-auto is dead UI; `RetryProvision` re-keys to the workspace root rather than the project root for nested monorepos; musllinux node wheels.
3. **File-tree lazy-loading follow-ups** (#37 Phase 2 shipped via PR #147) — **#148:** lazy watcher reconcile; **#149:** nested `.gitignore` handling.
4. **Run execution identity Phase 2** (#146; follow-up to #103) — re-key single-profile output/tabs/history by `runInstanceId`: per-run retained tabs, same-profile parallelism, persisted run history, and an internal execution-plan abstraction (`executionNode`) enabling retry/resume/parallel-group later. All five #103 acceptance criteria are already met by Phase 1; this is a capability upgrade, not a fix.
5. **#142: Workspace-colored open-file tabs** — surfaced while reviewing #117: open editor tabs should always carry their owning workspace's accent (tab/font) regardless of the active workspace, so files are instantly attributable; future stretch is filtering open tabs to the active workspace. Bundle the **button-in-button DOM fix** in the editor tab bar (close `<button>` nested inside the tab `<button role="tab">` → React hydration warning) since it touches the same component.
6. **#143: File-level infra accent in the tree** — surfaced during #123 testing: infra files (`Dockerfile`, `docker-compose.y*ml`, `.dockerignore`, `*.tf`/`*.tfvars`) should render with the Docker (purple) / Terraform (amber) accent even when shown inside another workspace's tree, so deployment/infra files are spottable regardless of the active workspace. File-level decoration layered on the existing per-workspace tinting.

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

### #47: Terminal - Shell Integration (Error Markers & Command Separators) ✅
- [x] OSC 133 shell integration injected via embedded, versioned zsh/bash wrapper scripts (zsh `ZDOTDIR`, bash `--rcfile`), chaining the user's real rc; fail-open to a plain shell on any setup failure
- [x] `precmd`/`preexec` hooks emit `133;A|C|D;<exit>`; zsh hooks prepended (capture `$?` before prompt tooling), bash is DEBUG-trap-safe and preserves exit status
- [x] Red gutter marker on failed commands, neutral on success, via xterm `registerMarker`/`registerDecoration` driven by an OSC 133 state machine (executed-gate, decorate-once, marker pruning on scrollback dispose)
- [x] Faint command separators between blocks; zsh + bash only, unsupported shells silently plain
- [x] Atomic wrapper-file writes (temp+rename) for concurrent-creation safety; PTY-gated emission test + pure-logic unit tests

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

### #18 / #71 Phase 1: Workspace-Owned Detection & Identity ✅ (PR #123)
Backend prerequisite for the Run Profiles UI — profiles now carry an owning workspace.
- [x] Repo-scoped `ProjectRunProfileManager`: eager multi-root detection across all workspaces → one combined list
- [x] `WorkspaceID`/`WorkspaceName`/`WorkspaceRelDir` on RunProfile; workspace-scoped deterministic detected IDs (no cross-workspace collisions; unpin invariant preserved)
- [x] Per-workspace `.firn/run-profiles.json` with v1→v2 migration (ownership stamp, ID scope, intra-file compound-step rewrite, repo-root-relative `workingDir` rebase)
- [x] Owner-routed save/pin/delete/variant; explicit owner preserved (`project` vs `root:go`); cross-workspace duplicate IDs rejected
- [x] Load resilience: atomic build-then-swap, degrade-on-corrupt-store, non-fatal migration persist, surfaced warnings
- [x] Workspace detector fixes: language markers beat infra; infra split → Docker (purple) / Terraform (amber); dot-directories skipped (no phantom `.worktrees` workspaces); duplicate workspace names disambiguated; file-explorer tree hides dot-folders (dot-files stay)

### #71: Run Profiles - Activated State, Section Reorganization, and Selection Persistence (P2) ✅ CLOSED (PR #125 panel + PR #127 follow-ups)
- [x] Activated profile working set (adopt/unadopt; persisted per workspace)
- [x] Reorganize sections into Working Set / Pinned / RECENT / Detected (four-section cascade via pure `groupProfiles`)
- [x] RECENT section: a just-run profile floats above Detected unless already saved/pinned
- [x] Persist activation in `.firn/run-profiles.json` v3 (definitions + adoption) and run recency in the `.firn/run-recency.json` sidecar (split in #127), both atomic temp+rename writes
- [x] Header counter with running/total counts (view-scoped)
- [x] Workspace/Project view filter & grouping (reuses tree-view toggle, single source of truth)
- [x] Workspace-accent just-ran highlight (5-min window) to distinguish the just-ran profile
- [x] **P2 review follow-ups (PR #127):** nil-`executor` guard in `StartRunProfile`; recency moved to a synchronous sidecar (no per-run profiles-file rewrite, no debounce timer); legacy-recency migration on load; `Store.PruneState` drops stale recency-only state on load while preserving adopted entries

### #18: Run Profiles - UI Integration
- [x] Profile selector dropdown in header toolbar (`[▶ Profile ▾]`) + Cmd+R run target (PR #129)
- [x] Play/stop/restart controls in run profile cards
- [x] Running status indicators and status badges
- [x] Output panel with streaming logs
- [x] Clickable file:line:col output links with historical working-dir stability
- [x] Compound execution view with stage indicators
- [x] Environment variant selector (`[env: dev ▾]`)
- [x] Edit profile form — create/edit/customize/delete single profiles (PR #132); card/form UI polish (PR #133); `Store.Save`/`Delete` persist-failure rollback (PR #134)
- [x] Profiles grouped by workspace with accent colors (Project View, PR #125)
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

## Milestone 7: Git Integration (COMPLETE — PR #162)

### #26: Git - Status Display ✅
- [x] Show current branch in status bar (and an always-visible header pill)
- [x] Color-code modified/added/deleted/untracked files in explorer (`--git-*` tokens)
- [x] Refresh on file system changes

### #27: Git - Basic Operations ✅
- [x] Stage/unstage files (per-file and section select-all), commit with message
- [x] Pull/push, Publish for no-upstream, branch switching (portaled switcher)
- [x] Diff viewer (read-only side-by-side, next/prev nav, live editor-buffer diff)
- [x] Gutter change bars with peek popup: word-level inline diff + revert-to-HEAD
- [x] Actionable messaging for a `core.bare=true` repo (not "not a git repository")

Follow-ups: #163 hunk staging, #164 3-way merge, #165 go-llm library, #166 branch
menu, #167 intent-to-add, #169 editable diff.

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
Zero-config language support, in two layers.

**Phase 1 — project environment auto-wiring: SHIPPED via PR #121.** Pyright now resolves third-party (venv site-packages), first-party (`src` via `extraPaths`), and version-gated stdlib (`datetime.UTC`) imports in a standard `src`-layout uv/venv project with no per-project Firn config. New pure (no command execution) `internal/lsp/pythonenv` detector (interpreter precedence: in-root `VIRTUAL_ENV` → `.venv` → `venv` → pyenv stat-check → system; out-of-root `VIRTUAL_ENV` ignored). The client gained a server→client request handler that answers pyright's `workspace/configuration` pull (root cause: it was replying `-32601` to **all** server requests), advertises the `workspace.configuration` capability, and sends `didChangeConfiguration`. A Manager-owned, language-generic `WorkspaceConfigProvider` (dialect-agnostic across `python`/`pyright`/`basedpyright`, object + leaf sections) forwards `pythonPath`/`venvPath`/`analysis.extraPaths`. Raw server error strings replaced by typed `ServerStatus` setup fields (`setupState`: ready|missing_server|missing_interpreter|misconfigured_env|config_degraded|retryable, + action/detailCode) rendered as a non-blocking `LSPSetupCard` above the editor; `useLSPEvents` suppresses the raw Toast when typed status is present.

**Phase 2 — managed server provisioning: OPEN.** Provision the server **binary** itself: download a pinned version (`basedpyright` standalone, no Node dependency) into an app cache (`~/.firn/servers/<lang>/<version>/`) when none is found locally/on PATH; offline/failure → actionable install/retry UI (`download_available`/`offline` states reserved in Phase 1). Lazy (active workspace only); never mutates the user's global env/PATH. The config-forwarding plumbing already generalizes (Python only wired today; gopls/tsserver/rust-analyzer plug into the same provider seam). Smaller Phase 1 follow-ups: command-backed uv/poetry env discovery outside the project root; interactive interpreter picker / "Doctor" panel; enrich the polled `GetLSPStatus` path with the typed setup fields (event path already does).

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

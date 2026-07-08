<p align="center">
  <img src="docs/screenshots/firn-ide.png" alt="Firn IDE - Light Core, Deep Focus" width="800">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-in%20development-blue" alt="Status">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.23+-00ADD8?logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Wails-2-DF0000?logo=wails&logoColor=white" alt="Wails">
</p>

---

## Why Firn?

Modern monorepos contain frontend (React/TypeScript), backend services (Python, Go), and infrastructure code. Traditional IDEs either:

- **Load everything at once** — consuming 4-8GB+ RAM with all language servers running
- **Require separate windows** — losing context when switching between frontend and backend

**Firn takes a different approach:** One repo, multiple focused workspaces.

Each workspace has independent layout state, scoped language servers (only the active workspace runs LSP), and workspace-specific Run Profiles. Switching workspaces is instant—like changing perspectives, not opening a new app.

## Install

**Quick install** (macOS and Linux) — downloads the latest release and installs it:

```bash
curl -fsSL https://raw.githubusercontent.com/kstruzzieri/firn-ide/develop/install.sh | sh
```

Put the assignment on the `sh` side of the pipe so the script actually receives it — pin a version with `FIRN_VERSION`, or preview without installing with `FIRN_DRY_RUN`:

```bash
# preview the resolved download URL and target dir without installing
curl -fsSL https://raw.githubusercontent.com/kstruzzieri/firn-ide/develop/install.sh | FIRN_DRY_RUN=1 sh

# pin a specific release instead of the latest
curl -fsSL https://raw.githubusercontent.com/kstruzzieri/firn-ide/develop/install.sh | FIRN_VERSION=v0.10.0 sh
```

Windows users: use the manual zip below.

Prefer to do it by hand? Download the latest build for your platform from the [Releases page](https://github.com/kstruzzieri/firn-ide/releases/latest).

> **Preview builds are unsigned**, so macOS and Windows warn on first launch. The per-platform steps below get you past it.

### macOS (11 Big Sur or later)

1. Download `Firn-macos-arm64.zip` (Apple Silicon) or `Firn-macos-amd64.zip` (Intel).
2. Unzip and move `Firn.app` to `/Applications`.
3. First launch is blocked by Gatekeeper. Either right-click `Firn.app` → **Open** → **Open**, or clear the quarantine flag:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Firn.app
   ```

### Linux (x86_64)

1. Download `Firn-linux-amd64.tar.gz`.
2. Extract and run:

   ```bash
   tar -xzf Firn-linux-amd64.tar.gz
   chmod +x firn
   ./firn
   ```

3. Requires WebKit2GTK 4.1 — e.g. on Debian/Ubuntu: `sudo apt install libwebkit2gtk-4.1-0`.

### Windows 10/11 (x64)

1. Download `Firn-windows-amd64.zip` and extract `firn.exe`.
2. First launch may show a SmartScreen warning → **More info** → **Run anyway**.
3. Requires the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Windows 11; auto-installed or downloadable on Windows 10).

Prefer to build from source? See [Development](#development).

## Key Design Decisions

### Wails over Electron

Firn uses [Wails](https://wails.io) (Go backend + system WebView) instead of Electron:

| Aspect | Electron | Wails |
|--------|----------|-------|
| Binary size | ~150MB+ | ~15MB |
| RAM baseline | ~300MB+ | ~50-100MB |
| Startup | 2-5 seconds | <1 second |
| Bundled runtime | Chromium + Node.js | System WebView |

The trade-off: Fewer npm packages that rely on Node.js APIs work out-of-the-box. Worth it for a lightweight, fast IDE.

### Future AI Integration

The roadmap includes a built-in AI assistant panel with:
- Context-aware code assistance (current file, selection, workspace)
- Multiple provider support (Claude, OpenAI, local Ollama)
- Diff preview before applying suggested changes
- Multi-panel broadcast mode for comparing AI responses

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Wails Runtime                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐              ┌─────────────────────────┐  │
│  │   Go Backend    │◄────────────►│    React Frontend       │  │
│  │                 │   bindings   │                         │  │
│  │  • File System  │              │  • CodeMirror 6 Editor  │  │
│  │  • FS Watcher   │              │  • Zustand State        │  │
│  │  • Run Profiles │              │  • Run Profile Cards    │  │
│  │  • PTY Terminal │              │  • Panel System         │  │
│  │  • Workspace    │              │  • Run Output Views     │  │
│  │  • LSP Client   │              │  • LSP Editor UX        │  │
│  │  • ripgrep      │              │  • Search UI            │  │
│  └─────────────────┘              └─────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

| Component | Technology |
|-----------|------------|
| Backend | Go 1.23+ (layered package structure) |
| Frontend | React 19 + Vite + TypeScript |
| State | Zustand |
| Editor | CodeMirror 6 |
| File Watching | fsnotify with debounce |
| Language Intelligence | LSP per active workspace |
| Search | ripgrep workspace search + CodeMirror in-file search |

### Performance Targets

- **Cold start:** < 2 seconds
- **Idle CPU:** near 0% (event-driven, no polling)
- **Core RAM:** ~200-450MB (without language servers)
- **Workspace switch:** Instant (0ms perceived delay)

## Current Implementation

### Completed

**Backend (Go)**
- [x] Layered package structure (domain, application, infrastructure, interfaces)
- [x] `ReadDirectory` — recursive directory listing with file metadata
- [x] `ReadFile` — content reading with automatic encoding detection (UTF-8, UTF-16, Latin-1)
- [x] `WriteFile` — content writing with encoding preservation
- [x] File system watcher — real-time external change detection with debounced events
- [x] Workspace store — open folder, persistence, recent projects
- [x] LSP client foundation — JSON-RPC framing, stdio transport, lifecycle, crash recovery, diagnostics/status events
- [x] Search backend — ripgrep JSON parsing, cancellation, typed errors, and result caps

**Run Profiles (Go + React)**
- [x] Auto-detection from package.json, go.mod, Makefile, pyproject.toml, docker-compose
- [x] Process executor with lifecycle management (start, stop, restart, SIGTERM grace period)
- [x] Real-time output streaming with line assembly and FIFO truncation
- [x] Pin/unpin profiles (promote detected to saved, demote back)
- [x] Run history tracking (last 50 runs per profile with pass/fail/duration)
- [x] Waveform activity visualization (output rate per 500ms interval)
- [x] Status badges (RUNNING, PASSED, FAILED, READY, STOPPING, STOPPED)
- [x] Auto-expand cards for active states, auto-collapse on completion
- [x] Purpose-built expanded panels per state (activity graph, output preview, stats, error detail, SIGTERM progress)
- [x] Predicted completion ETA with median-based estimation and running card sort
- [x] Failed-state attention pulse animation
- [x] Reactive re-detection on config file changes via file watcher
- [x] Workspace-owned detection and identity — each profile owns a workspace, with workspace-scoped IDs and a per-workspace `.firn/run-profiles.json`
- [x] Four-section working set (Working Set / Pinned / Recent / Detected) with per-workspace adoption and Workspace/Project views
- [x] Header profile selector with a single `Cmd+R` run target, shared with the panel
- [x] Create / edit / customize / delete profile form (Start-from picker, inline env vars, working-dir folder picker, env variants)
- [x] Hidden-profile section to unhide, and header **+** to create a profile

**Frontend (React/TypeScript)**
- [x] CodeMirror 6 editor with Firn Glacier theme
- [x] Syntax highlighting (JS, TS, Python, Go, CSS, HTML, JSON, Markdown)
- [x] Tab-based editing with modified indicators
- [x] JetBrains-style autosave (debounced idle + focus loss)
- [x] Per-file undo/redo history preserved across tab switches
- [x] File explorer with tree navigation — virtualized rows with lazy per-directory loading on expand
- [x] Workspace accent color system (7 theme variants)
- [x] Panel layout system with drag-to-resize and collapse/expand
- [x] Icon system with currentColor SVGs
- [x] Status bar (cursor position, language, git branch)
- [x] Toast notification system

**Language Intelligence**
- [x] Frontend document sync (`didOpen`, debounced `didChange`, `didSave`, `didClose`)
- [x] TypeScript/JavaScript LSP vertical slice through `typescript-language-server --stdio`
- [x] Diagnostics underlines, gutter markers, Problems panel, and status-bar counts
- [x] Completion source with trigger characters, detail/docs, and snippet support
- [x] Hover tooltips and go-to-definition (`F12`, Cmd/Ctrl-click)
- [x] Shared registry entries for Go (`gopls`) and Python (`pyright-langserver`)
- [x] Managed server provisioning — pinned `basedpyright` downloaded into `~/.firn` with interpreter wiring and an offline/retry setup card (active workspace only; never mutates global env/PATH)

**Search**
- [x] Workspace-wide ripgrep search with regex, case, and whole-word options
- [x] Results grouped by file with highlighted matches and keyboard navigation
- [x] Cmd+Shift+F opens workspace search
- [x] Click result to open the file at the match location
- [x] In-file find/replace through CodeMirror search (`Cmd+F`)

**Terminal Integration**
- [x] PTY backend — shell sessions with bidirectional I/O and ANSI support
- [x] xterm.js frontend — themed terminal with Firn Glacier colors
- [x] Multiple terminal sessions — create, switch, close, rename, drag-to-reorder
- [x] Graceful process termination — SIGHUP via PTY close with SIGKILL fallback
- [x] Shell integration — OSC 133 command separators and exit-status error markers (zsh/bash)

**Run Output Panel**
- [x] Per-profile output display with tab selection
- [x] Multiple view modes (merged, lanes, diff, timeline)
- [x] Independent per-stream lane scrolling (stdout/stderr) with a resizable split
- [x] Auto-scroll with toggle
- [x] Output folding for repeated patterns
- [x] Compound run profiles — sequential multi-step execution with per-step output and aggregate status
- [x] First-class run execution identity — output, lifecycle, and status routed by execution-instance id

**Version Control (Git)**
- [x] Working-tree status in the file tree (modified/added/deleted/untracked colors) and current branch in the status bar
- [x] Branch switcher shared between an always-visible header pill and the status bar
- [x] Diff viewer — read-only side-by-side, next/prev change navigation, resizable columns, and a live diff against the open editor buffer
- [x] Commit panel — per-file and section include checkboxes, stage/commit, pull/push (Publish when there is no upstream), workspace-scoped
- [x] Gutter change bars with a peek popup — unified word-level inline diff and one-click revert-to-HEAD

### Planned

- [ ] Git — hunk-level staging, intent-to-add for new files, richer branch menu, 3-way merge UI (#163-#169)
- [ ] Managed provisioning Phase 3 — `gopls`, `tsserver`, `rust-analyzer` (Python shipped)
- [ ] Run execution identity Phase 2 — per-run retained tabs, same-profile parallelism, persisted history
- [ ] AI Chat Panel

## Project Structure

```
firn-ide/
├── main.go                     # Application entry
├── app.go                      # Wails bindings
├── internal/
│   ├── filesystem/             # File read/write/watch
│   ├── lsp/                    # LSP client, registry, transports, URI handling
│   ├── runprofile/             # Run profile detection, execution, management
│   ├── search/                 # ripgrep search runner and parser
│   ├── terminal/               # PTY session management
│   ├── watcher/                # FS event watcher
│   ├── workspace/              # Workspace persistence
│   └── process/                # Process management
├── frontend/
│   ├── src/
│   │   ├── components/         # React components
│   │   │   ├── Editor/         # CodeMirror 6 editor
│   │   │   ├── FileExplorer/   # File tree navigation
│   │   │   ├── RunProfiles/    # Run profile cards and panels
│   │   │   ├── RunOutput/      # Output display (merged, lanes, diff, timeline)
│   │   │   ├── Search/         # Workspace-wide search
│   │   │   ├── Terminal/       # xterm.js terminal
│   │   │   └── layout/         # Panel system, sidebar, header
│   │   ├── stores/             # Zustand state management
│   │   ├── hooks/              # Custom React hooks
│   │   ├── utils/              # Shared utilities
│   │   └── types/              # TypeScript type definitions
│   └── wailsjs/                # Generated Go bindings
└── docs/
    ├── roadmap.md              # Consolidated roadmap with all issues
    ├── design-specification.md # Full UI/UX specification
    └── architecture.md         # System architecture guide
```

## Development

### Prerequisites

- Go 1.23+
- Node.js 18+
- Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

### Commands

```bash
# Live development with hot reload
wails dev

# Production build
wails build

# Run frontend tests
cd frontend && npm test

# Run Go tests
go test ./...
```

### Generated Wails Bindings

`frontend/wailsjs/**` is generated by Wails and is tracked because the frontend imports it directly. Commit those files only when a Go-facing API or exported model JSON shape changes, preferably after running `wails generate module`.

Do not commit mode-only churn in generated bindings. If `git diff --summary frontend/wailsjs` shows only `100644 => 100755`, clear it with `chmod 644 frontend/wailsjs/go/main/App.d.ts frontend/wailsjs/go/main/App.js frontend/wailsjs/go/models.ts frontend/wailsjs/runtime/*`. If your local filesystem keeps flipping executable bits, use `git config core.filemode false` locally.

`wails generate` / `wails build` also re-emits trailing whitespace on blank lines inside `models.ts` (and the exec-bit above) every run, so a regen with no real API change shows a spurious whitespace diff. The committed copies are the prettier-cleaned versions — the `lint-staged` pre-commit hook strips that whitespace automatically. If you regenerated without any Go-facing API/model change, discard the noise with `git restore frontend/wailsjs` rather than committing it.

## Design Documentation

The [Design Specification](docs/design-specification.md) contains the complete UI/UX blueprint:

- Visual identity and theme tokens
- Workspace model and multi-workspace editing
- Run Profiles system
- AI Chat Panel design
- Keyboard shortcuts

See the [Roadmap](docs/roadmap.md) for implementation progress and all tracked issues.

## Current Priorities

1. Git integration (Milestone 7: #26 status display, #27 basic operations) — the only unstarted milestone and the highest-value remaining gap.
2. LSP follow-ups — managed provisioning Phase 3 (#151: gopls/tsserver/rust-analyzer) and Phase 2 polish (#152).
3. File-tree follow-ups — lazy watcher reconcile (#148) and nested `.gitignore` handling (#149).
4. Run execution identity Phase 2 (#146) — per-run retained tabs, same-profile parallelism, persisted run history.

## Contributing

This project follows a ticket-based workflow:

1. Issues tracked via GitHub Issues
2. Feature branches created from `develop`
3. Test-driven development required
4. PRs merged to `develop` after review
5. `main` reserved for releases

## License

MIT

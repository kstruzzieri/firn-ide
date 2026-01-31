# Flux IDE - Lightweight Multi-Workspace IDE — Feature Overview & Phased Implementation Plan (v1)

## Product intent
A JetBrains-feeling (UI/UX) IDE for macOS + Linux that stays fast on very large monorepos by using **focused workspaces** (Frontend (React/TypeScript) / Python / Go) and making **Run Profiles** + **Git** the primary “all-in-one” workflow surface. Early versions prioritize UX, workflow orchestration, and responsiveness over deep, bespoke refactoring engines.

---

## High-level feature overview

### 1) Workspace model (core differentiator)
**One repo → multiple focused workspaces** that each have:
- A **workspace root** (e.g., `frontend/`, `backend/python/`, `backend/go/`)
- Independent **layout state** (panes, tabs, split positions)
- Independent **Run Profiles** set (build/lint/test/deploy)
- Independent **language services scope** (LSP servers started only for the active workspace)

**UX goals**
- “Switch workspace” is instant and feels like changing a perspective, not opening a new app.
- Each workspace feels purpose-built (Frontend shows Preview; Backend shows Docker/Logs; Go shows Service tooling).

### 2) JetBrains-like shell (UX first)
- Dockable/resizeable tool windows (Project, Search, Git, Problems, Run, Terminal, Preview)
- Keyboard-first navigation:
  - “Search Everywhere” (files, symbols, actions, run profiles)
  - Go to file / Go to symbol
  - JetBrains-ish keymap preset (not high priority)
- Stable focus + predictable shortcuts
- Right-click context menus
- Functional terminal
- Intuitive design
- Agent Client Protocol (ACP) chat window

### 3) Run Profiles (build/lint/test/deploy) as first-class
Run Profiles are lightweight “run configs”:
- Command (single or pipeline), working directory, env vars, env files
- Pre-tasks (optional) and dependencies (optional)
- Output console with clickable `file:line:col` parsing
- Profiles are **workspace-scoped** by default; repo-level shared profiles allowed

**Auto-detect profiles**
- Frontend: `frontend/package.json` → `npm run dev/build/lint/test/typecheck`
- Backend Docker: `docker compose` files → up/down/logs/exec/build
- Python: `pyproject.toml` + uv → `uv sync`, `uv run …`, tests/lint/format/typecheck
- Go: `go.mod` → `go test`, `go build`, `go run`, `golangci-lint` if present

### 4) Git (daily-driver)
- Enhance over JetBrains implementation
- Status, stage/unstage, commit/amend
- Diff viewer (side-by-side + inline; stage hunks/lines)
- Branch switch/create, pull/rebase
- History (file + branch)
- Merge conflict UI and blame

### 5) Preview & visualization (React/Vite)
- Dev server control from Run Profiles
- Preview routes/presets (e.g., `/`, `/dev`, `/components`)
- Default: **open in external browser** (lightest)
- Optional: embed **system webview** (macOS WKWebView; Linux WebKitGTK) if it stays lean

### 6) Language intelligence (per-workspace)
- Tree-sitter for syntax, folding, basic outline (cheap, always-on)
- LSP per workspace for diagnostics/nav/rename/format/code actions:
  - TS: typescript-language-server (or tsserver via wrapper)
  - Python: pyright (or pylsp)
  - Go: gopls
- Problems pane + editor diagnostics

### Non-goals for v1
- JetBrains-grade, bespoke refactoring/inspections across all stacks
- Marketplace-scale plugin system
- Fully integrated container/remote dev environment (can be added later)

---

## Constraints & budgets (for very large monorepos)

### Performance budgets (suggested)
- Cold start (no workspace indexing): **< 2–4s** on typical dev machine
- Idle CPU: **near 0%** (no polling loops)
- Core app RAM (no language servers): **~200–450MB**
- With a single active workspace + its language server(s):
  - Frontend (TS): often **~1–3GB** depending on TS project size
  - Python: **~0.6–1.8GB**
  - Go: **~0.6–1.8GB**
**Key premise**: only one workspace’s language servers run at a time.

### Default ignore/watch exclusions
`node_modules`, `dist`, `build`, `.venv`, `.tox`, `__pycache__`, `vendor`, `.git`, cache dirs, generated artifacts.

---

## Phased implementation strategy

### Phase 0 — Product definition & architecture (1–2 weeks)
**Deliverables**
- **Tech Stack Setup:** Initialize Wails project (Go `main.go` + frontend `vite.config.ts`).
- Workspace spec:
  - How roots are discovered/defined
  - Where workspace config is stored (e.g., `.ide/workspaces/*.json`)
- Run Profiles spec:
  - Schema and storage (workspace-local + repo-shared)
  - Output parsing rules
- Performance strategy:
  - File watching model + ignore rules
  - Caching boundaries per workspace
- UI style guide:
  - Darcula-like palette, spacing, typography, icon style, keyboard behavior

**Exit criteria**
- Clear v1 scope and acceptance tests for “feels IDE-like”.

---

### Phase 1 — UI shell + editor + docking (4–8 weeks)
**Build**
- Main window layout: left Project, center Editor, right Git, bottom Tools
- Docking system: move/resize tool windows; persist layout per workspace
- Editor integration (native widget) + tabs + splits
- Search:
  - Go to file
  - Full-text search (ripgrep recommended)
- Terminal pane (pty)
- Settings + keymap preset
- Theming (dark mode baseline)

**Exit criteria**
- Open repo → navigate → edit → search → run terminal commands comfortably.

---

### Phase 2 — Workspace switcher + focused roots (4–8 weeks)
**Build**
- Workspace switcher (keyboard-first)
- Create/manage workspaces:
  - Name, root dir, optional tags (Frontend/Python/Go)
- Layout + open tabs persisted per workspace
- Watch scope constrained to workspace root (plus explicit include paths if needed)

**Exit criteria**
- Switching Frontend/Python/Go workspaces is quick and changes the whole “context” (tree, profiles, panes) cleanly.

---

### Phase 3 — Run Profiles + task orchestration (4–8 weeks)
**Build**
- Run Profiles UI:
  - list, create/edit, run/stop/restart, logs
  - group by workspace
- Auto-detection:
  - npm scripts in `frontend/`
  - docker compose in backend
  - uv + pyproject in python root
  - go.mod in go root
- Output console:
  - file:line parsing → click to open file
  - persistent logs per profile run
- Backend mode UX:
  - Toggle “Docker vs Local” for backend workspace (switches primary profile set)
  - Hybrid option: infra in Docker, app local (optional later)

**Exit criteria**
- You can build/lint/test/run/deploy (via your commands) from inside the IDE.

---

### Phase 4 — Git v1 (4–8 weeks)
**Build**
- Git status (shell out to git)
- Diff viewer + staging controls (file/hunk/line)
- Commit UI (amend, sign later)
- Branch switch/create + simple fetch/pull/rebase actions
- History view (per-file, per-branch)

**Exit criteria**
- Daily Git workflow can be done without leaving the IDE.

---

### Phase 5 — Language intelligence v1 (6–12 weeks)
**Build**
- Tree-sitter for syntax + folding + lightweight outline (always-on)
- LSP client framework + per-workspace server configuration
- Problems pane + diagnostics in editor
- Go-to definition/references, rename, symbols, hover
- Format-on-save (workspace configurable)

**Exit criteria**
- Each workspace has “IDE-level” navigation and diagnostics without cross-language bloat.

---

### Phase 6 — Preview & visualization (3–8 weeks)
**Build**
- Frontend workspace adds Preview tool:
  - Start Vite profile → “Open preview” button
  - Route presets + quick open
- Default external browser integration
- Optional embedded system webview (only if it stays lean)

**Exit criteria**
- Tight FE loop: edit → hot reload → preview quickly with minimal overhead.

---

### Phase 7 — Debugging + premium polish (8–16+ weeks)
**Build**
- DAP integration:
  - Python debugpy
  - Go delve DAP
  - Node/Chrome DAP (frontend)
- “Search Everywhere” unified:
  - files + symbols + actions + run profiles + git branches
- Conflict resolution UI
- Monorepo niceties:
  - workspace presets discovery
  - smarter task dependency hints (optional)
- Optional: lightweight plugin hooks (internal first, no marketplace)

**Exit criteria**
- Comfortable as primary IDE for your workflows.

---

## Implementation guidelines (to stay lightweight)
- **Architecture:** Wails (Go) + React/Vite. Uses the system webview (WebKit/WebView2) to keep the binary small (~15MB) and RAM usage low, avoiding the Electron bloat.
- **Backend:** Go handles heavy lifting (LSP orchestration, Git operations, file watching).
- **Frontend:** Standard Web technologies (React) for the UI shell and Preview pane.
- Keep language servers out-of-process; scope them to workspace root.
- Avoid polling: use FS events + debounce.
- Cache aggressively, but per-workspace; clear caches predictably.
- Don’t build a new build system—make “Run Profiles” excellent.

---

## Suggested initial workspace presets (for your repo)
- Frontend workspace: root `./frontend`
- Python workspace: root `./backend/python`
- Go workspace: root `./backend/go`
- Backend (Docker) profiles: compose up/down/logs/exec
- Backend (Local) profiles: uv sync/run/test/lint + go test/run/build/lint

(Adjust roots to match your actual directory names.)

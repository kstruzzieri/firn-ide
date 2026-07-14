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
| Milestone 7: Git Integration | **COMPLETE** | #26-27 shipped (PR #162); #163 hunk-level staging shipped (PR #173, hardened #174/#176); #167 intent-to-add shipped (PR #177); #169 editable diff shipped (PR #181); follow-ups #164-166 |
| Performance | **IN PROGRESS** | #38 complete; #37 virtualization (#111) + lazy directory loading Phase 2 (#147) shipped; follow-ups #148/#149; #39 open |
| Editor & LSP DX | **COMPLETE** | #113/#114 theme + #119 picker a11y; #112 provisioning shipped via PRs #121/#150/#178, final fixes merged in PR #183, packaged native closure gate passed, and #112 closed as completed |
| Dependency Upgrades | **COMPLETE** | #40 |
| Code Quality | **IN PROGRESS** | #42 closed; #41 remains an incremental extraction constraint, not a standalone refactor project |
| Accessibility | **IN PROGRESS** | #43 open; tree roving focus, `aria-busy`, and several live regions already shipped, so the remaining scope requires an audit |
| Future Features | Not started | #44-46 |
| Bug Fixes | **COMPLETE** | #33 and #34 closed |

---

## Current Repository Review and Prioritized Roadmap

> **Authoritative snapshot:** 2026-07-13 (America/New_York), `develop` at `7728dcc`. This section supersedes the archived delivery narrative below for current prioritization.

### Repository health

- `develop` is clean and synchronized with `origin/develop`; GitHub has **14 open issues and 2 open pull requests** (#191 workspace-colored tabs, #192 nested `.gitignore`). Issue #112 is closed as completed, and its final fix/evidence PR #183 is merged.
- `v0.11.0` is live from `main` at `4707c59`. The release workflow, Build, Tests, and Lint passed; macOS amd64/arm64, Linux amd64, Windows amd64, and `SHA256SUMS` are published.
- No planned stabilization sprint follows the release. Cut `v0.11.1` only for observed regressions; otherwise proceed directly with the three Wave 1 tracks below.
- The CodeMirror language bundle is still eager: `codemirror-languages` is **382.35 kB / 143.21 kB gzip**, providing a measurable baseline for #39.
- `frontend/src/stores/ideStore.ts` is now **1,787 lines**, but Git, LSP, and search already have dedicated stores. Do not run #41 as a big-bang refactor; extract only the domain touched by later feature work.
- Release documentation and install examples now target `v0.11.0`.
- Release hardening aligns backend CI with Go 1.23 and pins every workflow Wails install to the module's v2.11.0. Cross-platform PR verification remains a future release-engineering improvement.
- The frontend suite passes but some non-silent runs emit React `act(...)` console warnings. File a focused test-hygiene ticket so warnings cannot hide real regressions.

### Post-release reset

Start one ticket in each Wave 1 track; the tracks are independent and can use parallel worktrees:

1. **#34 — closed via PR #190:** all 111 production buttons carry explicit literal types, enforced by an AST regression test; the track moves to the #43 accessibility audit.
2. **#149 — nested `.gitignore`:** fix repository-tree correctness first, then move the track to #39 dynamic language loading.
3. **#142 — workspace-colored tabs:** narrow to owning-workspace accents, then move the track to #143 infrastructure file accents.

### Parallel development plan

#### Wave 1 — foundations

| Track | Tickets | Execution rule |
|-------|---------|----------------|
| Quality and accessibility | #43 audited remainder (#34 closed) | Land before adding more keyboard-driven menus. #34 shipped in PR #190; an AST regression test now requires an explicit literal type on every production button. |
| Filesystem and performance | #149, then #39; benchmark #148 only if needed | Correctness before bundle optimization. Do not implement #148 unless profiling proves startup time or descriptor pressure. |
| Workspace visual identity | #142, then #143 | Keep #142 to the remaining owning-workspace accent scope; the nested-button fix is already shipped. |

#### Wave 2 — product tracks

Begin after the #43 accessibility baseline lands. Treat #41 as opportunistic extraction inside the feature that needs it, not as a prerequisite project:

| Track | Tickets | Dependencies and sequencing |
|-------|---------|-----------------------------|
| Command UX | #44, then #45 and #46 in parallel | #44 should introduce a shared command/action registry reused by context menus, breadcrumbs, shortcuts, and later VCS actions. |
| Run engine | #146 | Extract only the run state needed by each phase; split persistence, per-run tabs, same-profile parallelism, and execution plans into independently reviewable changes. |
| Git conflict UX | #164 | Can run alongside #44/#146. Treat it as data-loss-sensitive work with real-repository conflict fixtures and manual smoke tests. |

#### Wave 3 — Git expansion and conditional work

- **#166:** split into a safe/read-only phase (remote/local/tag model, tracking metadata, search, keyboard navigation) and a destructive phase (merge/rebase/rename/delete). Land destructive operations only after #164 establishes conflict recovery.
- **#41:** no standalone refactor. Preserve public selectors/actions and extract a domain only when #44, #146, or another feature directly benefits.
- **#148:** implement only when a benchmark demonstrates a real bottleneck; otherwise leave deferred.
- **#165:** blocked on an upstream API decision. `go-llm` exposes `provider.Router`, but convenient provider assembly remains under `internal/providerbootstrap`, which Firn cannot import. Export a supported bootstrap API upstream first; keep agentflow proof-artifact UI out of this ticket.

### Ticket priority, model, and reasoning assignment

Model guidance follows OpenAI's current [GPT-5.6 model guide](https://developers.openai.com/api/docs/guides/latest-model), [reasoning-effort guidance](https://learn.chatgpt.com/docs/models#pick-a-reasoning-effort), and [granular UI guidance](https://learn.chatgpt.com/use-cases/make-granular-ui-changes#pick-your-model): use `gpt-5.6-sol` for frontier/cross-cutting work, `gpt-5.6-terra` for cost-balanced work, and `gpt-5.3-codex-spark` for fast localized UI iteration. Use the lowest reasoning level that reliably covers the risk.

| Priority | Ticket | Recommended disposition | Model | Reasoning |
|----------|--------|-------------------------|-------|-----------|
| Closed | #42 Hardcoded macOS paths | Closed as completed on 2026-07-11; retain release smoke coverage. | `gpt-5.6-terra` | Light |
| Closed | #112 LSP zero-config | Packaged native closure gate passed on 2026-07-12; final fixes merged in PR #183 and the issue is closed as completed. | `gpt-5.6-sol` | High |
| Closed | #34 Button types | Closed via PR #190 on 2026-07-13; explicit literal types on all production buttons plus an AST regression guard. | `gpt-5.3-codex-spark` | Light |
| P0 | #149 Nested `.gitignore` | Implement Git-compatible nested precedence and negation semantics with fixtures. | `gpt-5.6-sol` | High |
| P0 | #142 Workspace-colored tabs | Implement owning-workspace accents only; the nested-button fix is already shipped. | `gpt-5.3-codex-spark` | Medium |
| P1 | #43 WCAG AA | Audit and re-scope now that #34 has landed; test keyboard, contrast, and screen-reader behavior. | `gpt-5.6-sol` | High |
| P1 | #39 Dynamic languages | Follow #149; lazy-import and reconfigure CodeMirror languages with a bundle-size regression budget. | `gpt-5.6-terra` | Medium |
| P1 | #143 Infra file accents | Follow #142 using the existing workspace-region resolution. | `gpt-5.3-codex-spark` | Light |
| P2 | #44 Command Palette | Build the shared command registry first, then fuzzy-search UI and shortcuts. | `gpt-5.6-terra` | High |
| P2 | #146 Run identity Phase 2 | Extract only the run state each phase needs; split the capability upgrade into small review gates. | `gpt-5.6-sol` | Extra High |
| P2 | #164 Three-way merge UI | Require real conflicts, recovery tests, and manual verification before merge. | `gpt-5.6-sol` | Extra High |
| P2 | #166 Rich VCS menu | Separate safe/read-only behavior from destructive branch operations. | `gpt-5.6-sol` | Extra High |
| P3 | #45 Context menus | Reuse #44 commands; file-explorer and editor-tab surfaces can then proceed in parallel. | `gpt-5.6-terra` | Medium |
| P3 | #46 Breadcrumbs | Build on shared navigation commands and the lazy tree-loading contract. | `gpt-5.6-terra` | Medium |
| Incremental | #41 Zustand slices | Extract only domains required by active feature work; do not schedule a standalone rewrite. | `gpt-5.6-sol` | High |
| Gated | #148 Lazy watcher registration | Benchmark first; implementation has meaningful lifecycle/race risk. | `gpt-5.6-sol` | Extra High |
| Blocked | #165 `go-llm` integration | Export a supported upstream provider-bootstrap API before changing Firn. | `gpt-5.6-sol` | High |

### #112 manual smoke pass and closure gate

The automated coverage is already strong; this smoke pass verifies the user-visible seams that unit tests cannot fully prove. Run it against the current `develop` build using a disposable Firn home so the test does not touch real Firn settings or managed-server caches.

#### 2026-07-12 packaged native rerun: PASS — #112 closure gate satisfied

The packaged macOS arm64 app was exercised from disposable root `/private/tmp/firn-112-gate.qiqBFG` with user-installed language servers excluded from the launch `PATH`.

| Check | Result | Evidence |
|-------|--------|----------|
| Clean-cache lazy provisioning | **Pass** | Python `1.39.9`, gopls `v0.22.0`, TypeScript `5.3.0`, and rust-analyzer `2026-07-06` appeared under the disposable Firn cache only after their files were opened, one family at a time. The rerun exposed a missing frontend `.rs` mapping; a failing regression was added before the one-line fix, after which the packaged Rust path provisioned and reached ready. |
| Python environment wiring | **Pass** | `structlog`, `src/smoke_pkg`, and `datetime.UTC` resolved with the detected Python 3.11.14 `.venv`. The Problems panel contained only the deliberate `Literal[42]`-to-`str` diagnostic; no import diagnostic or raw setup toast appeared. |
| Interpreter override/reset | **Pass** | The native picker selected `/private/tmp/firn-112-gate.qiqBFG/manual-venv/bin/python3`, the setup card identified the manual interpreter, imports remained resolved, and **Reset to auto** restored the project `.venv` and cleared the persisted override. |
| Offline and same-session Retry | **Pass** | A second empty Firn cache and isolated empty installer cache ran behind a deliberately unavailable process-scoped proxy. Firn stayed usable and rendered `Could not download the language server (offline)` with **Retry**. Bringing the proxy online and clicking Retry in the same app session installed basedpyright and restored the single deliberate diagnostic. |
| Scope and host hygiene | **Pass** | Managed artifacts remained under the disposable Firn homes; the host language-server paths and global `PATH` were unchanged. Wi-Fi and all smoke processes were restored/stopped after the run. |

All close criteria below are satisfied. The fix/evidence PR #183 merged at `b0445c9`, and #112 is closed as completed.

#### 2026-07-12 defect-fix rerun: AUTOMATED PASS; native gate still pending (historical)

The fix was exercised on macOS arm64 with disposable root `/private/tmp/firn-112-smoke.I3boO5`. The temporary real-server Go harness was removed after the run. These fixes later merged in PR #183 and are included in the completed closure state above.

| Check | Result | Evidence |
|-------|--------|----------|
| TDD regressions | **Pass** | The initial focused run failed in the intended four places: whole-section and leaf-section configuration still returned `[src]`, while override mode lost detected metadata in both provider and emitted status. Review then exposed stale missing-interpreter diagnostics and unvalidated persisted overrides; focused regressions failed with `misconfigured_env` and an accepted deleted interpreter before their fixes. Reset-to-auto now returns to ordinary detection. |
| LSP and repository Go verification | **Pass** | `go test ./internal/lsp/... -count=1`: **214 tests passed** across 3 packages. `go test ./... -count=1`: **655 tests passed** across 12 packages. `go vet ./...`: no issues. |
| Real basedpyright 1.39.9, detected environment | **Pass** | A Python **3.11.14** `.venv` contained a normal `six==1.17.0` site-packages install; the workspace also contained `src/smoke_pkg`, `datetime.UTC`, and one deliberate line-8 assignment error. Basedpyright requested `python`, `basedpyright.analysis`, and `basedpyright`; its only diagnostic was `Literal[42]` not assignable to `str`. No site-packages, `src`, or stdlib import diagnostic appeared. |
| Real basedpyright 1.39.9, manual override | **Pass** | Repeating the same stdio session setup with the manual override pointed at the fixture `.venv/bin/python` retained detected venv and rooted `extraPaths`; the unit regression also covers preservation of detected Python-version metadata. The same three configuration sections were requested and the deliberate line-8 type error remained the only diagnostic. |
| Explicit project configuration semantics | **Pass** | The detector remains unchanged: existing `pyrightconfig.json` or `[tool.pyright] extraPaths` declarations suppress Firn's `src` injection. Only detector-delivered relative paths are rooted at the LSP configuration boundary; already-absolute paths remain absolute. Existing detector/config-provider coverage passed in the complete suite. |
| Packaged build | **Pass** | Wails 2.11.0 production build completed and produced `build/bin/Firn.app/Contents/MacOS/firn`. Generated-binding content remained unchanged. |
| Native lazy-family and Offline-to-Retry gate | **Not observed** | The packaged app launched with fresh home `/private/tmp/firn-112-native.HWdWfR`; `.firn/servers` was absent before launch. macOS returned `osascript is not allowed assistive access` and displayed the Accessibility permission dialog over Firn. Screen capture worked, but interaction was blocked, so no claim is made for one-family-at-a-time provisioning or same-session Offline-to-Retry recovery. |

At this interim checkpoint, required follow-up items 1–3 below were complete and item 4 remained the closure blocker. The later packaged native rerun passed item 4, PR #183 merged, and #112 closed as completed.

#### 2026-07-11 execution result: FAILED (historical; superseded by closure pass)

Smoke root: `/private/tmp/firn-lsp-smoke.XCPypG` on macOS arm64, using a fresh packaged `develop` build and disposable homes/caches. Temporary harness files were removed after the run; only this evidence remains in the repository.

| Check | Result | Evidence |
|-------|--------|----------|
| Packaged build | **Pass** | `wails build` completed and produced `build/bin/Firn.app/Contents/MacOS/firn`. |
| Fresh real managed installs | **Pass** | Pinned basedpyright `1.39.9`, gopls `v0.22.0`, typescript-language-server `5.3.0`, and rust-analyzer `2026-07-06` downloaded, verified/extracted, committed to a fresh cache, resolved from `launch.json`, and each stayed alive over stdio during a launch probe. |
| Python 3.11 interpreter + site-packages | **Pass** | Firn detected the fixture `.venv/bin/python`; a normally installed site-packages module resolved. `datetime.UTC` produced no compatibility diagnostic. Editable installs that rely on executable `.pth` import hooks are not a valid static-analysis fixture, so the final pass used a normal wheel install. |
| Python `src` layout | **Fail — product blocker** | The detector returned `extraPaths: ["src"]`; basedpyright requested `python`, `basedpyright.analysis`, and `basedpyright` configuration and received that value, but still published `Import "smoke_pkg" could not be resolved`. A smoke-only absolute value (`<projectRoot>/src`) immediately cleared the import error while retaining the deliberate type-error diagnostic. Production must resolve injected paths against the project root before returning LSP configuration. |
| Manual interpreter override | **Fail — product blocker** | Selecting the same valid `.venv` interpreter changed `ConfigSource` to `override`, but `PythonEnv` replaced the detected environment with an interpreter-only object. `VenvDir`, `ExtraPaths`, and `PythonVersion` were lost (`extraPaths=[]`), so override mode can regress the same imports it is intended to repair. Overlay the override path/source onto detected metadata instead of returning early with a partial environment. |
| Offline/retry plumbing | **Automated pass; native manual check pending** | Six focused Go tests passed for offline classification, retry root routing, and override plumbing; all 18 `LSPSetupCard` tests passed, including Retry invocation and error handling. A real native offline toggle/retry was not observed. |
| Native setup-card/lazy-family UI | **Not observed** | The isolated Firn process launched, but macOS withheld both the Accessibility tree and screen capture from the automation host. No visual claim is made. Rerun this portion after granting the host Accessibility and Screen Recording permissions, or perform it manually. |

Historical #112 follow-up checklist (now complete), in execution order:

1. Convert detector-generated relative extra paths to project-root-resolved absolute paths at the LSP configuration boundary; retain explicit project config semantics.
2. Make interpreter overrides enrich/overlay the detected environment so venv, `src`, and Python-version metadata survive.
3. Add regressions for absolute `workspace/configuration` values and override metadata retention, plus a real basedpyright integration smoke that proves site-packages, `src` imports, Python 3.11 stdlib, and a deliberate diagnostic together.
4. Rerun the full packaged native pass, including lazy one-family-at-a-time provisioning and an offline-to-Retry recovery in the same app session. Close #112 only when every row above passes.

#### 1. Prepare a clean launch environment

Build the current `develop` revision normally, then launch the packaged binary with a disposable home and a minimal tool shim. Building first avoids making the Go/npm build caches part of the smoke environment. The shim keeps the Go toolchain available for managed `gopls` installation while excluding user-installed `gopls`, `typescript-language-server`, `rust-analyzer`, and Python language servers from `PATH`.

```bash
wails build
SMOKE_HOME="$(mktemp -d)"
SMOKE_BIN="$SMOKE_HOME/bin"
mkdir -p "$SMOKE_BIN"
ln -s "$(command -v go)" "$SMOKE_BIN/go"
env HOME="$SMOKE_HOME" \
  PATH="$SMOKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
  build/bin/Firn.app/Contents/MacOS/firn
```

The final path is the macOS build. Use `build/bin/firn` for Linux; on Windows, launch `build/bin/firn.exe` under a disposable user profile with the equivalent restricted `PATH`. Before opening a file, confirm `$SMOKE_HOME/.firn/servers` is absent or empty. If a platform needs another runtime tool, add only that executable to `SMOKE_BIN`; do not add an entire directory containing language-server binaries.

#### 2. Use a four-workspace smoke repository

Prepare a disposable repository with:

- Python: `pyproject.toml`, Python 3.11+ `.venv`, `src/smoke_pkg/__init__.py`, and `src/main.py`; install one third-party package such as `structlog` into the venv.
- Go: `go.mod` and `main.go`.
- TypeScript: `package.json`, `tsconfig.json`, and `src/index.ts`.
- Rust: `Cargo.toml` and `src/main.rs`.

In `src/main.py`, import all three cases from #112:

```python
import structlog
from datetime import UTC
from smoke_pkg import VALUE
```

The file must be clean without `pyrightconfig.json` or Firn-specific configuration.

#### 3. Verify lazy managed provisioning

1. Open only the Python workspace and `src/main.py`.
2. Confirm the setup card reports provisioning without a raw error toast, then clears or reports ready.
3. Confirm only the Python family appears under `$SMOKE_HOME/.firn/servers`; Go, TypeScript, and Rust must not provision before their workspaces become active.
4. Open one file in each remaining workspace, one family at a time. Confirm each transitions through managed provisioning to ready and creates only its own pinned cache directory.
5. Confirm `command -v basedpyright-langserver`, `command -v gopls`, `command -v typescript-language-server`, and `command -v rust-analyzer` remain unchanged outside the smoke process. Firn must not mutate the global `PATH` or install into a global tool directory.

#### 4. Verify Python environment wiring

- `structlog` resolves from `.venv` site-packages.
- `smoke_pkg` resolves through the detected `src` layout.
- `datetime.UTC` resolves under the detected Python 3.11+ interpreter.
- Add a deliberate type error and confirm a diagnostic appears; remove it and confirm the diagnostic clears.
- If a project `pyrightconfig.json` or `[tool.pyright]` is added, confirm Firn honors it rather than overriding it.

#### 5. Verify actionable failure and retry

1. Use a second fresh smoke home, disconnect networking, and open a supported file that requires provisioning.
2. Confirm Firn remains usable and shows an actionable non-blocking Offline/Failed card with **Retry**, not a bare server-not-found error or blocking dialog.
3. Reconnect networking and click **Retry** without changing projects.
4. Confirm provisioning completes and language features become active.

#### 6. Verify interpreter override polish

- Exercise **Select interpreter** with a valid alternate Python interpreter.
- Confirm the setup UI identifies the manual override.
- Click **Reset to auto** and confirm Firn returns to the detected project interpreter.
- In a nested monorepo Python project, trigger **Retry** and confirm the server starts at the nested project root, not the repository root.

#### 7. Closure criteria (all satisfied; #112 closed)

The criteria used to close #112 were recorded in the final issue evidence:

- [x] Clean-cache managed provisioning succeeds without a system/project server.
- [x] Python third-party, first-party `src`, and Python-version imports resolve with zero Firn config.
- [x] Missing network/server produces a non-blocking actionable card and Retry recovers.
- [x] Provisioning is lazy by active workspace and writes only under the Firn-managed cache.
- [x] Python, Go, TypeScript, and Rust each reach a usable ready state.
- [x] Interpreter override, Reset to auto, and nested-project Retry behave correctly.
- [x] No raw setup error toast, global install, or global `PATH` mutation occurs.

One primary-platform manual pass is sufficient for closure when the cross-platform catalog/provisioner tests and release build matrix remain green. Repeat the smoke on another OS only if the primary pass exposes platform-specific behavior.

---

## Delivery History (Archived)

> The narrative below preserves implementation context from earlier roadmap snapshots. Its references to "open" or "remaining" work are historical; the authoritative backlog and priorities are in the section above.

Current status: **Milestone 7 (Git Integration) is complete and merged (PR #162, develop `eb43370`) — every planned milestone is now shipped.** Working-tree status in the file tree and status bar; a read-only side-by-side diff viewer with next/prev navigation, resizable columns, and a live editor-buffer diff; JetBrains-style commit panel with per-file include checkboxes, stage/commit/pull/push (Publish when there is no upstream), and workspace scoping via the ownership model; a portaled branch switcher shared between the header pill and the status bar; and gutter change bars with a peek popup showing a unified word-level inline diff and one-click revert-to-HEAD. The LSP hover was also reworked to highlight signatures with the file's real language parser (Go and all languages) and render doc links as clickable. **#163** hunk-level staging shipped (PR #173, hardened via review PR #174/#176) and **#167** intent-to-add (`git add -N`, track-without-staging on untracked rows so new files diff and hunk-stage) shipped via PR #177; on the LSP side **#151** Phase 3 managed provisioning for `gopls`, `tsserver`, and `rust-analyzer` shipped via PR #178 (Python landed in #150). Open Git follow-ups: **#164** 3-way merge UI, **#165** go-llm library integration (replace the golem shell-out), **#166** richer branch/VCS menu, **#169** editable diff. Other open follow-ups: #152 (LSP provisioning polish), #148/#149 (lazy-load watcher + nested gitignore), #146 (run-identity Phase 2), #142 (workspace-colored tabs), #168 (Structure view from document symbols).

Earlier: **Milestone 4 (Run Profiles) closed — #103 run execution identity merged via PR #144.** The overloaded `profileId` string (which carried saved-config, compound-aggregate, compound-step, process-key, and event-routing meanings) is replaced by a first-class `RunIdentity{runInstanceId, profileId, parentRunInstanceId?, stepIdx}` embedded in every run event. The executor keys processes/compounds by a per-`Executor` monotonic `runInstanceId` and tracks `activeByProfile` (retiring the old `processAliases`); the synthetic `compound:<base64>:<idx>` step keys and their reserved-namespace validation are deleted; the frontend stores route output by explicit fields with a `runInstanceId`-based stale-drop/rotate rule (no namespace parsing). Documented Stop/Restart/Status semantics: an idle/unknown id is an idempotent no-op, terminal status is retained only for top-level runs. Phase 1 only — **Phase 2** (single-profile output/tabs/history re-keyed to `runInstanceId`, per-run retained tabs, same-profile parallelism, persisted run history) is a separate follow-up ticket. With the #18/#71 UI epic and LANES (#107/#137) already shipped, **Milestone 4 is complete**.

Earlier: **Milestone 2 closed — #47 Terminal shell integration (OSC 133 error markers + command separators) shipped**: embedded zsh/bash wrapper scripts inject `precmd`/`preexec` hooks (fail-open to a plain shell), an xterm OSC 133 state machine renders red/neutral gutter markers + block separators, atomic wrapper writes for concurrent-creation safety, with PTY-gated emission tests. Also **Milestone 4 #18 Run Profiles UI complete — P4 create/edit form shipped via PR #132**, with a UI/UX polish follow-up (PR #133) and a store persist-failure rollback fix (PR #134). This closes the #18/#71 Run Profiles UI epic. The form is a panel-takeover create / edit / **customize** / delete surface for single profiles: a "Start from" detected-command picker, name + command, working directory (native folder picker, relativized to the repo root), inline `KEY=value` env rows with a duplicate-key guard, an env file, and round-tripped env variants. It is the first consumer of `SaveRunProfile` / `DeleteRunProfile` / `ValidateRunProfile`, which now **emit `runprofiles:changed` on success** so the list refreshes with backend-normalized fields (no optimistic store mutation). **Copy-on-write identity:** editing a detected profile reuses its id so the detected twin is suppressed via `combineUnitLocked` — no duplicate. PR #133 retuned the card color scheme to the workspace-accent palette (a deep-navy `--surface-base` card surface matching the bottom output panel, accent-tinted hover / selected / failed / running states, a filled Cmd+R-target dot + full-card highlight, click-anywhere-to-target) and fixed the header run/stop button rendering as a blank, off-center square (the icon components had no intrinsic size). PR #134 makes `Store.Save` / `Store.Delete` roll back their in-memory mutation when the disk write fails, so memory and disk can't diverge (the emit path made that observable). Remaining Run Profiles work: **#103** (compound execution identity hardening) — the LANES output work (#107 via PR #138, #137 via PR #139) is now shipped.

Earlier: **Milestone 4 #71 P2 closed — review follow-ups + recency sidecar shipped via PR #127** (on top of the P2 panel, PR #125). #127 closes the three open P2 review follow-ups: a nil-`executor` guard in `StartRunProfile` (mirrors `StopRunProfile`); **run recency split into the `.firn/run-recency.json` sidecar**, separate from `run-profiles.json` (now profile definitions + adoption only), so stamping a run writes the tiny sidecar *synchronously* and never rewrites profile definitions — fixing per-run write amplification at the root with no debounce timer (and therefore no orphaned-write race, no lost-on-SIGKILL window, and write errors surfaced to the caller); legacy v3 files that embedded recency migrate into the sidecar on load; and `Store.PruneState` drops stale recency-only `profileState` entries on load (saved+detected IDs valid) while preserving `adopted` entries through branch churn. Also a repo-hygiene commit: a `trimws` git clean filter + `.gitattributes` kills the perpetual trailing-whitespace churn Wails emits into `wailsjs/go/*.ts` on every build.

The **P2 panel (PR #125)** is a four-section working set (Working Set / Pinned / RECENT / Detected) driven by a pure `groupProfiles` selector, with per-workspace adoption persisted in `.firn/run-profiles.json` **v3** and run recency in the `.firn/run-recency.json` sidecar, a `RunProfilesSnapshot{profiles, profileState}` single hydration contract emitted on every `runprofiles:changed`, Workspace/Project views (reusing the tree-view toggle, single source of truth), view-scoped `● N running · M total` counters, and a 5-min-windowed workspace-accent "just-ran" highlight. New app bindings `AdoptRunProfile`/`UnadoptRunProfile`/`GetRunProfilesSnapshot`. Earlier: **Phase 1 (workspace-owned detection + identity) shipped via #123** — repo-scoped `ProjectRunProfileManager`, owning-workspace identity + workspace-scoped IDs, per-workspace store with v1→v2 migration, owner-routed save/pin/delete, plus detector hardening (language markers beat infra; infra split Docker/Terraform; dot-dirs skipped). Remaining Run Profiles UI: **P4** create/edit form (#18) — **P3** header `[▶ Profile ▾]` selector shipped via PR #129.

Earlier: **#112 Phase 1 (Python LSP environment auto-wiring) shipped via PR #121** — pyright now resolves imports/types in a standard `src`-layout uv/venv project with zero per-project config. New pure `internal/lsp/pythonenv` interpreter/venv detector; the client answers pyright's `workspace/configuration` pull (was replying `-32601` to all server requests — the root cause) and advertises the capability + `didChangeConfiguration`; a Manager-owned, dialect-agnostic `WorkspaceConfigProvider` forwards `pythonPath`/`venvPath`/`analysis.extraPaths`; raw server errors are replaced by a typed setup status + non-blocking `LSPSetupCard`. Earlier shipped: **editor theme system + diagnostic tooltip (#113/#114, PR #117)** with #119 picker focus polish, **terminal PTY-exhaustion actionable error (#116)**, **file-tree / tab-bar scrollbar fixes (#118)**. Milestone 3 (Workspace Management) complete; file-tree virtualization shipped (#37/#38, PR #111). The #17 Run Profiles Execution Engine epic (#59-64) is complete; remaining Run Profiles work is the UI layer. Lazy-loading (#37 Phase 2) deferred to its own spec.

1. **Git integration follow-ups (Milestone 7 shipped via PR #162)** — deepen the just-shipped feature. **#163** hunk-level staging (PR #173, hardened #174/#176) and **#167** intent-to-add (PR #177) shipped. Next highest value: **#166** richer branch/VCS menu, **#169** editable diff (edit the working-tree side in place), **#164** 3-way merge UI, and **#165** replacing the golem CLI shell-out with the go-llm library for the AI commit message (go-llm PR #262 is merged).
2. **LSP managed provisioning follow-ups** (#112 Phase 2 shipped via PR #150) — **#151 Phase 3 provisioning for `gopls`, `tsserver`, and `rust-analyzer` shipped via PR #178**; remaining **#152:** polish — `configSource "override"` is never emitted so Reset-to-auto is dead UI; `RetryProvision` re-keys to the workspace root rather than the project root for nested monorepos; musllinux node wheels.
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
- [x] Resizable stdout/stderr columns (PR #138)
- [x] STDERR header glyph color (PR #138)
- [x] Sticky header bleed-through and independent lane scrolling (PR #138, refined by #137/PR #139)

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
- [x] Hunk-level staging in the diff viewer (#163, PR #173; hardened PR #174/#176)
- [x] Intent-to-add (`git add -N`) track-without-staging for new files (#167, PR #177)

Follow-ups: #164 3-way merge, #165 go-llm library, #166 branch menu,
#169 editable diff.

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

### #112: LSP - auto-provision language servers + wire project environment (COMPLETE; CLOSED)
Zero-config language support, in two layers. Provisioning implementation and review follow-ups are shipped, the 2026-07-12 packaged native closure gate passed, final fixes merged in PR #183, and #112 is closed as completed. See the [recorded smoke evidence and closure gate](#112-manual-smoke-pass-and-closure-gate).

**Phase 1 — project environment auto-wiring: SHIPPED via PR #121.** Pyright now resolves third-party (venv site-packages), first-party (`src` via `extraPaths`), and version-gated stdlib (`datetime.UTC`) imports in a standard `src`-layout uv/venv project with no per-project Firn config. New pure (no command execution) `internal/lsp/pythonenv` detector (interpreter precedence: in-root `VIRTUAL_ENV` → `.venv` → `venv` → pyenv stat-check → system; out-of-root `VIRTUAL_ENV` ignored). The client gained a server→client request handler that answers pyright's `workspace/configuration` pull (root cause: it was replying `-32601` to **all** server requests), advertises the `workspace.configuration` capability, and sends `didChangeConfiguration`. A Manager-owned, language-generic `WorkspaceConfigProvider` (dialect-agnostic across `python`/`pyright`/`basedpyright`, object + leaf sections) forwards `pythonPath`/`venvPath`/`analysis.extraPaths`. Raw server error strings replaced by typed `ServerStatus` setup fields (`setupState`: ready|missing_server|missing_interpreter|misconfigured_env|config_degraded|retryable, + action/detailCode) rendered as a non-blocking `LSPSetupCard` above the editor; `useLSPEvents` suppresses the raw Toast when typed status is present.

**Phase 2 — managed Python server provisioning: SHIPPED via PR #150.** Missing Python servers provision a pinned `basedpyright` toolchain under `~/.firn/servers`, with checksum verification, atomic installation, command-backed uv/poetry interpreter discovery, a Doctor-backed interpreter picker, and actionable offline/retry states. Provisioning is lazy to the active workspace and never mutates global PATH or project dependencies.

**Phase 3 — managed Go/TypeScript/Rust provisioning: SHIPPED via #151 / PR #178.** The family-generic provisioner now covers `gopls`, `typescript-language-server`, and `rust-analyzer` with pinned artifacts/toolchain installs, shared cache resolution, and family-aware failure guidance.

**Review polish: SHIPPED via #152; final override fixes merged in PR #183.** Manual interpreter overrides surface so **Reset to auto** is reachable; Retry preserves the nested project root; musllinux Node wheels cover Alpine's manual fallback. Override handling preserves rooted `extraPaths`, Python-version metadata, and confidence while dropping stale venv identity and superseded missing-interpreter diagnostics when necessary; reset returns to ordinary detection. Real basedpyright 1.39.9 retained only the deliberate diagnostic before and after override.

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
Re-scope against the current architecture: Git, LSP, and search already have dedicated stores. Do not schedule a standalone 1,787-line decomposition. Preserve the existing selector/action API and extract only the workspace, tree, editor, terminal, UI, or run domain directly touched by active feature work such as #44 or #146.

### #42: Fix Hardcoded macOS Paths ✅ CLOSED
Closed as completed on 2026-07-11. Production paths use `os.UserHomeDir`, `filepath`, platform-specific implementations, and cross-platform release builds rather than hard-coded macOS locations.

---

## Accessibility

### #43: Accessibility Improvements (WCAG AA)
Audit and re-scope before implementation. Already shipped: WAI-ARIA file-tree navigation with an active descendant, roving/single-tab-stop behavior, file-tree `aria-busy`, toast/search/LSP live regions, and several accessible tab/listbox patterns. Remaining evidence-driven work should cover contrast, skip-to-content, full keyboard traversal, focus restoration, dialog/menu semantics, and screen-reader verification.

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

### #33: Window Dragging Not Working ✅ CLOSED
Fixed via Wails macOS titlebar configuration and `--wails-draggable: drag` on the header.

### #34: Add Button Type Attributes ✅ CLOSED
Closed via PR #190 on 2026-07-13. All production buttons declare explicit literal `type` attributes, and a TypeScript AST regression test enforces valid literal values while guarding against a vacuous directory scan.

---

## Infrastructure (COMPLETE)

### #28: Testing - Setup Jest + React Testing Library ✅
### #29: Testing - Setup Go Tests ✅
### #30: CI/CD - GitHub Actions ✅
### #31: Code Quality - ESLint + Prettier ✅
### #32: Documentation - Architecture Guide ✅

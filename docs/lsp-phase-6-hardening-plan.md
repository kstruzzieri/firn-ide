# Phase 6: LSP Hardening and Immediate Follow-ons

> For agentic workers: implement this plan task by task. After every task, run the listed verification, then perform a code review and an adversarial review. Fix all findings, then repeat review until no findings remain.

**Goal:** Finish Milestone 5 LSP work so it is reliable across Firn's workspace model, not just the TypeScript happy path.

**Ticket Scope:** Milestone 5 Phase 6 covers Go/Python follow-ons, performance tuning, workspace-switching edge cases, structured failure reporting, external file/autosave interactions, and cross-platform path/binary hardening.

**Non-goals for this ticket:** Find references, rename symbol, code actions, quick fixes, format document/range, semantic highlighting, and workspace trust UI. These should be separate tickets after Phase 6.

**Production data rule:** Do not add fake diagnostics, fake completions, placeholder hover text, fallback language-server output, or silently successful no-ops where the user needs an actionable error. All editor intelligence must come from the current document state and real LSP servers. If a server or capability is unavailable, surface a specific status/error.

**Current Branch:** `codex/milestone-5-phase-6-hardening`

**Base:** `develop` at PR #83 merge `46758a49b5cf7722c2133b2a37a1f464608de203`

---

## Current Status

- [x] Local `develop` synced to `origin/develop` after PR #83 merge.
- [x] Stale local `feature/completion-hover-definition` branch deleted.
- [x] Phase 6 branch created.
- [x] Tracker updated through Phase 5 merge.
- [x] Task 1 implementation started before this plan was written: Go/Python registry mapping plus workspace restart guard.
- [x] Task 1 code review and adversarial review completed; test coverage gap was fixed and re-verified.
- [x] Task 2 workspace switching and LSP lifecycle hardening completed; code review and adversarial review passed.
- [x] Task 3 performance tuning for completion/hover async flow completed; code review and adversarial review passed.
- [x] Task 4 external file/autosave/document version hardening completed; code review and adversarial review passed.
- [x] Task 5 structured logging and failure clarity completed; code review and adversarial review passed.
- [x] Task 6 cross-platform path and binary matrix completed; code review and adversarial review passed.

Unrelated local changes must remain untouched unless the user explicitly scopes them into Phase 6:

- `.claude/settings.local.json`
- `.remember/`
- `frontend/wailsjs/runtime/*` mode-only changes
- Any Terminal changes not made by this Phase 6 task

---

## Task Boundaries

Each task must end with:

- Automated verification passing for the touched area.
- Code review focused on correctness, maintainability, errors, tests, and security.
- Adversarial review focused on race conditions, stale workspace state, missing binaries, unsupported capabilities, cancellation, path normalization, and performance regressions.
- Fix/re-review loop until no issues remain.
- Progress update in `.claude/tasks/todo.md` or this plan.

Do not batch multiple tasks past a review gate.

---

## Task 1: Go and Python LSP Enablement

**Status:** Complete; code review and adversarial review passed.

**Purpose:** Make Firn start real language servers for Go and Python files using the existing workspace-scoped LSP manager.

**Files:**

| File | Responsibility |
|------|----------------|
| `internal/lsp/registry.go` | Map Go/Python extensions and resolve `gopls` / `pyright-langserver` commands |
| `internal/lsp/manager_test.go` | Backend registry and workspace guard tests |
| `frontend/src/utils/lspLanguageId.ts` | Frontend languageId/family mapping |
| `frontend/src/__tests__/utils/lspLanguageId.test.ts` | Frontend mapping tests |

**Acceptance criteria:**

- `.go` maps to languageId `go`, family `go`.
- `.py`, `.pyw`, and `.pyi` map to languageId `python`, family `python`.
- Go server resolves from `gopls` on PATH and uses the workspace root as cwd.
- Python server prefers workspace-local `node_modules/.bin/pyright-langserver`, then PATH, and uses `--stdio`.
- Missing `gopls` and missing `pyright-langserver` produce specific actionable errors.
- No fake diagnostics/completions/hover output is added.

**Verification:**

- `go test ./internal/lsp`
- `go test ./...`
- `cd frontend && npm test -- --runTestsByPath src/__tests__/utils/lspLanguageId.test.ts src/__tests__/hooks/useLSPDocumentSync.test.ts`
- `cd frontend && npm test -- --watch=false`
- `cd frontend && ./node_modules/.bin/eslint --max-warnings=0 src/utils/lspLanguageId.ts src/__tests__/utils/lspLanguageId.test.ts`
- `cd frontend && ./node_modules/.bin/prettier --check src/utils/lspLanguageId.ts src/__tests__/utils/lspLanguageId.test.ts`

**Code review checklist:**

- Confirm command lookup is cross-platform and does not mask missing binaries.
- Confirm Python local-bin preference mirrors the TypeScript local-bin pattern.
- Confirm registry and frontend language maps stay in sync.
- Confirm tests cover unsupported files after Go/Python become supported.

**Adversarial review checklist:**

- Open `.go` or `.py` without the server installed: user gets one actionable error, no fake success.
- Open `.go` and `.py` in the same workspace: distinct server families do not collide.
- Open uppercase extensions: backend map is case-insensitive; decide whether frontend needs case-insensitive coverage.
- Use a workspace path with spaces: local `node_modules/.bin` lookup still works.

---

## Task 2: Workspace Switching and LSP Lifecycle Hardening

**Purpose:** Prove workspace switches fully tear down old LSP state and do not resurrect stale servers or leak diagnostics/documents.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `app.go` | Workspace root switching and shutdown timeout behavior |
| `internal/lsp/manager.go` | Shutdown/restart guards, open document cleanup, stale diagnostics filtering |
| `internal/lsp/manager_test.go` | Backend lifecycle and restart tests |
| `frontend/src/hooks/useLSPDocumentSync.ts` | Close/reopen tracked docs on workspace changes |
| `frontend/src/hooks/useLSPEvents.ts` | Drop stale diagnostics/status/error events |
| `frontend/src/__tests__/hooks/useLSPDocumentSync.test.ts` | Frontend workspace-switch tests |
| `frontend/src/__tests__/hooks/useLSPEvents.test.ts` | Stale event tests |

**Acceptance criteria:**

- Switching workspace closes tracked documents from the old workspace before new workspace docs are opened.
- Old workspace diagnostics/statuses disappear immediately on switch.
- Crash recovery does not restart an old workspace server after switch.
- Crash recovery still works for the new workspace after switch.
- App close shuts down LSP servers within the close deadline.
- No pending debounced `didChange` is dropped before `didClose`.

**Verification:**

- `go test ./internal/lsp`
- `go test ./...`
- `cd frontend && npm test -- --runTestsByPath src/__tests__/hooks/useLSPDocumentSync.test.ts src/__tests__/hooks/useLSPEvents.test.ts`

**Code review checklist:**

- Review lock ordering and goroutine behavior in manager shutdown/restart paths.
- Verify no data race around `workspaceRoot`, `stopped`, `servers`, or `openDocs`.
- Verify frontend subscriptions do not double-close or reopen documents during restore.

**Adversarial review checklist:**

- Switch workspace while a crash backoff sleep is pending.
- Switch workspace while `didOpen` is still in flight.
- Switch workspace while a debounced edit is pending.
- Receive late diagnostics from old workspace after new workspace is active.
- Close app while a server is initializing or shutting down.

---

## Task 3: Performance Tuning for LSP Event Flow

**Status:** Complete; code review and adversarial review passed for the completion/hover async hardening slice.

**Purpose:** Keep LSP responsive without excessive React renders, Wails calls, or server requests.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `frontend/src/stores/lspStore.ts` | Diagnostics/status storage and selectors |
| `frontend/src/components/Terminal/Terminal.tsx` | Problems panel rendering |
| `frontend/src/components/Editor/CodeMirrorEditor.tsx` | LSP compartment reconfiguration |
| `frontend/src/components/Editor/codemirror/completion.ts` | Completion request behavior |
| `frontend/src/components/Editor/codemirror/hover.ts` | Hover request behavior |
| `frontend/src/utils/lspDocumentSync.ts` | Debounce/flush behavior |

**Acceptance criteria:**

- Diagnostics updates do not reconfigure completion/hover compartments.
- Problems panel handles many diagnostics without expensive repeated URI/path conversions where avoidable.
- Completion and hover requests are cancelled or ignored when stale.
- Document sync sends full-content changes only when needed and coalesces edits correctly.
- Performance changes do not weaken correctness or hide server errors.

**Verification:**

- Add or update focused unit tests for stale completion/hover responses if code changes are needed.
- `cd frontend && npm test -- --runTestsByPath` for touched tests.
- `cd frontend && npm test -- --watch=false`
- Manual smoke, when practical: open a workspace with multiple TS/Go/Python files and verify editor interaction remains responsive.

**Code review checklist:**

- Check selectors and subscriptions for unnecessary full-store reactivity.
- Check that memoization does not create stale UI.
- Check that throttling/debounce behavior does not drop required saves or closes.

**Adversarial review checklist:**

- Rapid typing while completion requests are in flight.
- Hover over symbol, switch file before response returns.
- Large diagnostics payload from server.
- Repeated workspace switches with cached trees and restored tabs.

---

## Task 4: External File, Autosave, and Document Version Hardening

**Status:** Complete; code review and adversarial review passed.

**Purpose:** Ensure LSP document state remains correct when files are autosaved, externally modified, restored, or closed.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `frontend/src/hooks/useAutosave.ts` | Autosave trigger behavior |
| `frontend/src/App.tsx` | File watcher reload behavior |
| `frontend/src/hooks/useLSPDocumentSync.ts` | didChange/didSave/didClose sequencing |
| `frontend/src/utils/lspDocumentSync.ts` | Version and pending-content tracking |
| `internal/lsp/manager.go` | Version-based stale diagnostic filtering |

**Acceptance criteria:**

- External reload of an unmodified open file updates LSP content.
- Autosave sends `didChange` before `didSave`.
- Closing a file flushes pending content before `didClose`.
- Reopening a file after close gets a fresh `didOpen`.
- Version numbers are monotonic per document path during a session.

**Verification:**

- `cd frontend && npm test -- --runTestsByPath src/__tests__/utils/lspDocumentSync.test.ts src/__tests__/hooks/useLSPDocumentSync.test.ts src/__tests__/App.test.tsx`
- `go test ./internal/lsp`

**Code review checklist:**

- Check save/change ordering.
- Check pending timers are always cleared.
- Check failed `didOpen` does not leave tracked stale documents.

**Adversarial review checklist:**

- Save during pending `didOpen`.
- External file event arrives during local unsaved edit.
- Close during pending debounced change.
- Server crash/reconnect while local content is unsaved.

---

## Task 5: Structured Logging and User-Facing Failure Clarity

**Status:** Complete; code review and adversarial review passed.

**Purpose:** Make LSP startup/shutdown/request failures diagnosable without exposing noisy internals or hiding root causes.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `internal/lsp/manager.go` | Startup/shutdown/request status events |
| `internal/lsp/client.go` | Request timeout/cancellation logging |
| `internal/lsp/transport_stdio.go` | Stderr capture and process exit detail |
| `frontend/src/hooks/useLSPEvents.ts` | Toast/status behavior |
| `frontend/src/stores/lspStore.ts` | Status model |

**Acceptance criteria:**

- Startup failures include server family, workspace, command, and actionable install guidance.
- Initialization failures include bounded stderr.
- Request failures are logged with method/family/workspace but do not spam user toasts.
- Crash exhaustion emits a clear terminal error.
- StatusBar/Problems state does not imply LSP is ready when server startup failed.

**Verification:**

- Backend tests for missing binaries and init stderr behavior.
- Frontend tests for toast deduplication and stale workspace filtering.
- Manual smoke with missing `gopls` or `pyright-langserver` when practical.

**Code review checklist:**

- Confirm logs are structured enough to debug but do not leak document content.
- Confirm user-facing errors are actionable.
- Confirm repeated transient errors are deduplicated.

**Adversarial review checklist:**

- Server writes very large stderr.
- Server exits before initialize response.
- Request times out after workspace switch.
- Repeated crash loop across two language families.

---

## Task 6: Cross-Platform Path and Binary Matrix

**Status:** Complete; code review and adversarial review passed.

**Purpose:** Validate behavior on macOS/Linux/Windows path forms before Phase 6 closes.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `internal/lsp/uri.go` | File URI conversion |
| `internal/lsp/uri_test.go` | URI/path matrix |
| `internal/lsp/registry.go` | Binary lookup |
| `frontend/src/utils/lspUri.ts` | Frontend URI conversion |
| `frontend/src/__tests__/utils/lspUri.test.ts` | Frontend URI/path matrix |

**Acceptance criteria:**

- Spaces, `#`, `%`, and Unicode paths round-trip correctly.
- Windows drive-letter paths canonicalize consistently.
- Workspace-local node binaries resolve on Windows using `.cmd`.
- Diagnostics URI keys match editor URI keys for all supported platforms.

**Verification:**

- `go test ./internal/lsp`
- `cd frontend && npm test -- --runTestsByPath src/__tests__/utils/lspUri.test.ts src/__tests__/hooks/useLSPDocumentSync.test.ts`

**Code review checklist:**

- Check canonicalization between backend and frontend.
- Check path comparison code does not rely on lossy string operations.

**Adversarial review checklist:**

- Path with encoded slash-like characters.
- Windows lower-case drive in URI vs upper-case local path.
- UNC-like path behavior if supported by existing utilities.

---

## Final Phase 6 Exit Gate

Do not mark Phase 6 complete until:

- [ ] Every task above is complete.
- [ ] Each task has passed code review and adversarial review after fixes.
- [ ] `go test ./...` passes.
- [ ] `cd frontend && npm test -- --watch=false` passes.
- [ ] Touched frontend files pass direct ESLint and Prettier checks.
- [ ] Any remaining full-lint warnings are documented as pre-existing or fixed.
- [ ] Manual smoke notes exist for TypeScript plus at least one Go or Python path.
- [ ] `.claude/tasks/todo.md` is updated with Phase 6 results and follow-on tickets.

---

## Review Log

Use this section after each task.

### Task 1 Review

- Implementation: complete.
- Verification: `go test ./internal/lsp`, `go test ./...`, targeted frontend tests, full frontend tests, direct ESLint/Prettier on touched frontend files.
- Code review: completed. Finding: missing tests for actionable `gopls` and `pyright-langserver` not-found errors.
- Adversarial review: completed. Finding: frontend case-insensitive extension behavior was implicit but not covered for Go/Python.
- Fix/re-review: completed. Added missing-server tests and uppercase `.GO` / `.PY` mapping coverage; all Task 1 checks pass.

### Task 2 Review

- Implementation: complete.
- Verification: `go test ./internal/lsp`, `go test -race ./internal/lsp`, `go test ./...`, targeted frontend LSP sync/events tests, full frontend test suite, direct ESLint/Prettier on touched frontend files, `git diff --check`.
- Code review: completed. No open findings after formatting fix.
- Adversarial review: completed. Covered delayed server initialization during workspace switch, stale backend diagnostics after workspace switch, stale frontend reconnect events, pending `didChange` flush before workspace switch close, and race-enabled backend lifecycle tests.
- Fix/re-review: completed. Formatted updated frontend test; all Task 2 checks pass.

### Task 3 Review

- Implementation: complete for completion/hover async performance hardening without touching unrelated Terminal or store files.
- Verification: targeted completion/hover tests, full frontend test suite, production frontend build, direct ESLint/Prettier on touched completion/hover files, `git diff --check`.
- Code review: completed. Finding: stale hover document guard initially lacked direct test coverage.
- Adversarial review: completed. Finding: hover test initially used a loose plain-object cast instead of the generated Wails `lsp.Hover` model shape.
- Fix/re-review: completed. Added direct stale-hover tests for flush-time and in-flight document changes, switched test data to `lsp.Hover.createFrom(...)`, and re-ran verification; all Task 3 checks pass.

### Task 4 Review

- Implementation: complete.
- Verification: targeted document-sync/App tests, full frontend test suite, production frontend build, direct ESLint/Prettier on touched Task 4 files, `git diff --check`.
- Code review: completed. Finding: close/reopen of the same path could send a fresh `didOpen` before the old async `didClose` reached the server.
- Adversarial review: completed. Finding: a flush waiting on slow `didOpen` could lose edits made while it was awaiting the open.
- Fix/re-review: completed. Added per-path close barriers, tracked successful opens before sending change/save/close, re-read pending content after `didOpen`, preserved newer pending content during explicit flushes, and added tests for external reload, save/close ordering, failed `didOpen`, close/reopen ordering, and slow-open edit coalescing.

### Task 5 Review

- Implementation: complete.
- Verification: `go test ./internal/lsp`, `go test -race ./internal/lsp`, `go test ./...`, targeted frontend LSP event/store tests, full frontend test suite, production frontend build, direct ESLint/Prettier on touched frontend files, `git diff --check`.
- Code review: completed. Finding: missing-binary startup status had install guidance but did not carry the expected command as structured status data.
- Adversarial review: completed. Finding: bounded stderr writes reported the truncated byte count, and stderr capture lacked explicit synchronization for read/write overlap.
- Fix/re-review: completed. Added `command` to LSP status payloads and frontend status type, added command hints for config-resolution failures, included bounded stderr in initialize status and returned errors, added request-failure logs with method/family/workspace only, fixed and synchronized the bounded stderr buffer, and added backend/frontend tests.

### Task 6 Review

- Implementation: complete.
- Verification: `go test ./internal/lsp`, `go test ./...`, targeted frontend URI/document-sync tests, full frontend test suite, production frontend build, direct ESLint/Prettier on touched frontend files, `git diff --check`.
- Code review: completed. Finding: frontend URI encoding used `URL.pathname`, which left literal `%` unescaped in file names.
- Adversarial review: completed. Finding: backend `URIToFile` double-unescaped `url.Parse().Path`, causing valid literal `%` file names to fail, and frontend diagnostics keys did not canonicalize uppercase Windows drive URI forms to the editor key.
- Fix/re-review: completed. Backend now unescapes `EscapedPath()`, frontend path-to-URI now percent-encodes path segments explicitly, canonicalization normalizes file URI scheme/localhost/drive case through the shared path helpers, and tests cover spaces, `#`, `%`, Unicode, Windows drive case, and workspace-local `.cmd` binary suffix behavior.

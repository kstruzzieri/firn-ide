# Firn IDE LSP Implementation Strategy

**Date:** 2026-03-26 (updated 2026-03-28)
**Scope:** Epic #74, tickets #19, #73, #20, #21, #22
**Goal:** Turn Firn from a syntax-colored editor into an IDE with real language intelligence, starting with a production-ready TypeScript vertical slice and a language-agnostic backend that can immediately support Go and Python follow-ons.

## Non-Negotiable Guardrails

- No hard-coded, fallback, stub, mock, or fake diagnostics/completions/hover content.
- All language data must come from real LSP servers or from the current editor/document state.
- If a server, binary, capability, or workspace root cannot be resolved, surface a real error/message in the UI. Do not silently pretend the feature worked.
- After each phase: code review, fix findings, code review again, repeat until no issues remain.

## Ticket Review

> **Status (2026-03-27):** All gaps below have been resolved in the tickets. This section is retained as historical rationale for the ticket reshaping decisions.

### What the current tickets get right

- The roadmap separates protocol foundation (#19) from UI surfaces (#21 and #22).
- The TypeScript vertical slice (#20) is the right first integration because it validates the whole stack end-to-end.
- Diagnostics and autocomplete are the minimum feature set needed before Firn can credibly feel like an IDE.
- Frontend document sync (#73) is correctly separated as its own ticket given the complexity of Firn's existing editor lifecycle (autosave, workspace restore, file watcher).

### Gaps identified and resolved

1. **`tsserver` vs `typescript-language-server`** — Resolved: all tickets now specify `typescript-language-server --stdio`.

2. **LSP scope contradiction** — Resolved: workspace-scoped lifetime is the locked policy (see Scope Decision below and epic #74).

3. **#19 missing lifecycle work** — Resolved: #19 now includes `didClose`, version tracking/passthrough, capability negotiation, crash recovery, request timeouts/cancellation, URI normalization, app-level shutdown, and required tests.

4. **Hover/definition UX ownership gap** — Resolved: #20 owns backend request plumbing; #22 (renamed "Completion, Hover & Definition UX") owns frontend rendering (tooltips, F12, Cmd+Click).

5. **`ideStore` diagnostic state migration** — Resolved: #21 now explicitly requires removing `setDiagnostics`/`errorCount`/`warningCount` from `ideStore` and replacing them with `lspStore`-derived selectors.

6. **Workspace root resolution** — Resolved: backend-internal resolution (consistent with `LoadRunProfiles`), not frontend-passed. Specified in #19 and #20.

7. **Document version ownership** — Resolved: frontend is source of truth for version numbers, backend passes through, backend uses them to drop stale responses. Specified in #19.

8. **CodeMirror autocompletion integration** — Resolved: #22 explicitly requires coordinating with the existing `autocompletion()` extension to avoid double-completion popups.

9. **TCP transport** — Deferred: stdio only for now; transport interface makes TCP trivial to add later. Specified in #19.

10. **LSP type definitions** — Resolved: single `types.go` file for Firn's subset of the LSP spec. Specified in #19.

## Recommended Scope Decision

Use this policy unless product direction changes:

- LSP lifetime is workspace-scoped, not global to the entire repository.
- Within the active workspace, language servers are started on demand when a matching file is opened.
- When the last open document for a language in the active workspace is closed, that server shuts down.
- Switching active workspaces shuts down old workspace servers and rehydrates document state for the new workspace.

This resolves the docs conflict while still honoring the memory-efficiency requirement.

## Ticket Structure (Final)

The epic (#74) decomposes into five tickets with a clean dependency chain:

| Order | Ticket | Title | Depends on |
|-------|--------|-------|------------|
| 1 | #19 | Client Foundation — JSON-RPC, stdio transport, lifecycle, URI, versions, app shutdown | — |
| 2 | #73 | Frontend Document Sync — editor open/change/save/close wired to backend | #19 |
| 3 | #20 | TypeScript Integration — detect, launch, diagnostics/hover/definition plumbing | #19, #73 |
| 4 | #21 | Diagnostics UX & Problems Panel — editor underlines, problems list, ideStore migration | #19, #73, #20 |
| 5 | #22 | Completion, Hover & Definition UX — completion source, hover tooltips, F12/Cmd+Click | #19, #73, #20 |

Follow-on tickets (create after TypeScript is stable):
- `#TBD` Go integration via `gopls`
- `#TBD` Python integration via `pyright`

## Current Codebase Readiness

### Existing strengths we should reuse

- `app.go` already exposes backend services to the frontend cleanly through Wails bindings.
- The frontend editor is already CodeMirror 6-based and has theme support for tooltips, completion popups, and lint markers.
- The status bar already has diagnostics counters.
- The terminal panel already has a `Problems` tab, but its content is still a placeholder.
- Autosave, file watching, and workspace persistence already exist, which gives us the right hooks for `didSave`, external file reload, and workspace rehydration.

### Missing implementation surface today

- No `internal/lsp` package exists.
- No LSP process lifecycle, transport, or protocol handling exists.
- No frontend LSP state or event subscription exists.
- No problems list or diagnostic navigation exists.
- No CodeMirror completion source is wired to real backend requests.
- No hover or definition behavior exists.

## Target Architecture

### Backend

Create a new `internal/lsp/` package with language-agnostic core components:

- `manager.go`
  Owns workspace-scoped server instances, document reference counts, startup/shutdown, and routing.
- `client.go`
  Handles initialize/shutdown, request/notification APIs, capability storage, and diagnostics callbacks.
- `transport.go`
  Common interface for JSON-RPC message IO.
- `transport_stdio.go`
  Process-backed stdio transport for real language servers.
- `types.go`
  Firn's subset of LSP request/response/notification structs. Single file, not a full protocol binding.
- `registry.go`
  Maps language/workspace context to server command, arguments, root resolution, and transport.
- `uri.go`
  Cross-platform file path <-> `file://` URI conversions.

### App/Wails boundary

Expose explicit methods in `app.go` for the frontend:

- `LSPDidOpen(path, language, content)` — workspace root resolved internally by the manager
- `LSPDidChange(path, version, contentChanges)`
- `LSPDidSave(path)`
- `LSPDidClose(path)`
- `LSPHover(path, line, character)`
- `LSPDefinition(path, line, character)`
- `LSPComplete(path, line, character, triggerCharacter?)`
- `GetLSPStatus()` or language/workspace-specific status lookup

Emit backend events for push notifications:

- `lsp:diagnostics`
- `lsp:status`
- `lsp:error`

### Frontend

Add a focused LSP state layer instead of stuffing large, high-churn protocol state directly into existing editor state:

- `frontend/src/types/lsp.ts`
- `frontend/src/stores/lspStore.ts`
- `frontend/src/hooks/useLSPDocumentSync.ts`
- `frontend/src/hooks/useLSPDiagnostics.ts`
- `frontend/src/hooks/useLSPCompletions.ts`
- `frontend/src/hooks/useLSPNavigation.ts`

Keep only the aggregate counts needed by existing UI in `ideStore` if that reduces churn in current components.

## Phase Plan

## Phase 0: Contract and doc alignment

**Objective:** Remove ambiguity before code starts.

**Decisions to lock:**

- Workspace-scoped vs repository-global LSP lifetime
- `typescript-language-server` vs raw `tsserver` (recommend `typescript-language-server`)
- Method/event naming between frontend and backend
- Document sync strategy based on server-advertised capabilities
- Expected error UX when a server binary is missing

**Deliverables:**

- Update roadmap/task notes so ticket wording matches the actual implementation path
- Freeze the frontend/backend LSP contract in this plan

**Review gate:**

- Architecture review on lifecycle policy and TypeScript server choice

## Phase 1: Backend LSP foundation (`#19`)

**Objective:** Land a reusable LSP core in Go without UI coupling.

**Backend work:**

- Build JSON-RPC framing and request correlation
- Implement stdio transport behind a transport interface (TCP deferred — interface makes it trivial to add later)
- Implement initialize, initialized, shutdown, exit
- Store server capabilities after initialize
- Track open documents per workspace/language with version numbers (frontend is source of truth for versions, backend passes through and uses them to drop stale responses)
- Implement graceful shutdown when open-document count reaches zero
- Implement app-level LSP shutdown in `beforeClose` (same pattern as `executor.StopAll`)
- Restart cleanly after process crash with exponential backoff (e.g., 1s → 2s → 4s, cap at 30s, max 5 retries before surfacing a persistent error to the user)
- Normalize file URIs across macOS, Linux, and Windows
- Resolve workspace root internally from active workspace context (consistent with `LoadRunProfiles`)
- Add request timeout and cancellation plumbing for hover/completion/definition

**Required tests:**

- JSON-RPC framing/parsing (content-length header, partial reads, multiple messages)
- Request/response correlation and timeout behavior
- stdio transport lifecycle (start, communicate, graceful shutdown, crash)
- URI/path normalization on Unix and Windows path formats
- Server restart after unexpected process exit (including backoff behavior and max-retry cap)
- Document open/close reference counting and server teardown at zero
- Concurrent multi-file scenarios (open 3+ files, edit two simultaneously, close one — verify ref counting and diagnostics stay correct per-file)

**Acceptance criteria:**

- A TypeScript or JavaScript document can be opened and synced through the manager without UI code
- Diagnostics notifications can be received and routed back to `app.go`
- Closing the last matching document tears down the server
- App close gracefully shuts down all running LSP servers
- All required tests pass

**Suggested owners:**

- `backend-developer` / `golang-pro`
- `architect-reviewer` for lifecycle review

**Review gate:**

- Code review focused on race conditions, shutdown safety, and cross-platform path behavior

## Phase 2: Frontend document sync (`#73`)

**Objective:** Make the editor speak LSP reliably.

**Frontend work:**

- Track per-file document version numbers
- Send `didOpen` when a file first becomes an editor document
- Send debounced `didChange` for active edits (default 150ms; tunable later if needed)
- Send `didSave` after successful autosave/manual save
- Send `didClose` when a tab closes or a workspace switch unloads the document
- Re-open persisted editor tabs during workspace restore
- Handle external file reloads from the watcher without duplicating or corrupting document versions

**Key integration points in current code:**

- `frontend/src/components/Editor/CodeMirrorEditor.tsx`
- `frontend/src/components/Editor/Editor.tsx`
- `frontend/src/hooks/useAutosave.ts`
- `frontend/src/hooks/useWorkspacePersistence.ts`
- `frontend/src/hooks/useFileWatcher.ts`

**Acceptance criteria:**

- Opening, editing, saving, and closing a TS/TSX file produces the correct backend lifecycle calls
- Workspace switching fully unloads old documents and loads the new workspace state cleanly
- Debouncing prevents excessive backend churn without dropping final document state

**Suggested owners:**

- `react-specialist` / `typescript-pro`

**Review gate:**

- Code review focused on stale closures, event duplication, and save/change ordering

## Phase 3: TypeScript vertical slice (`#20`)

**Objective:** Make TypeScript the first real IDE experience.

**Implementation decisions:**

- Detect TypeScript/JavaScript projects by nearest `tsconfig.json`, `jsconfig.json`, or `package.json`
- Resolve server binaries in this order:
  1. workspace-local install (`node_modules/.bin/typescript-language-server`)
  2. system `PATH`
- If the project has a local TypeScript install but no local `typescript-language-server`, fall back to system PATH for the server while still using the local `tsserver` lib (the language server's `--tsserver-path` flag handles this)
- Launch `typescript-language-server --stdio`
- Treat `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs` as the same server family
- Map file extensions to correct LSP `languageId` strings in `registry.go`: `.ts` → `typescript`, `.tsx` → `typescriptreact`, `.js` → `javascript`, `.jsx` → `javascriptreact`, `.mts`/`.cts` → `typescript`, `.mjs`/`.cjs` → `javascript`

**Feature delivery in this phase:**

- `publishDiagnostics`
- hover
- go-to-definition
- completion request path ready, even if full UI lands in phase 5

**Acceptance criteria:**

- TS diagnostics appear for syntax/type errors in open files
- hover returns symbol information for valid positions
- definition jumps across files inside the workspace
- missing server binaries show an actionable user-facing error

**Suggested owners:**

- `backend-developer` for discovery/startup
- `typescript-pro` for TS-specific behavior validation

**Review gate:**

- Code review focused on root resolution, binary lookup, and server crash/error reporting

## Phase 4: Diagnostics UX (`#21`)

**Objective:** Replace placeholder diagnostics UI with actual IDE behavior.

**Frontend work:**

- Convert LSP diagnostics into CodeMirror lint diagnostics
- Underline errors/warnings in the editor
- Render gutter markers
- Replace the `Problems` placeholder with a real list grouped by file
- Show severity, message, line, and column
- Clicking a problem opens the file and moves the cursor to the diagnostic range
- Keep status bar counts derived from the real diagnostic store

**Backend/frontend contract details:**

- Diagnostics are pushed by server notification, not polled
- `lspStore` owns the canonical diagnostic map (file → diagnostics[]). Aggregate counts are derived selectors.
- **Remove `setDiagnostics`, `errorCount`, and `warningCount` from `ideStore`.** Replace `useErrorCount` and `useWarningCount` with equivalents from `lspStore`. Migrate all consumers (StatusBar, Terminal).

**Acceptance criteria:**

- A TS error appears in-editor, in the problems list, and in the status bar
- Fixing the error clears all three surfaces
- Navigation from problems list to file location works for same-file and cross-file diagnostics

**Suggested owners:**

- `frontend-developer`
- `ui-designer` for list UX polish

**Review gate:**

- Code review focused on stale diagnostics cleanup, rendering performance, and navigation correctness

## Phase 5: Completion, hover UI, and definition navigation (`#22`)

**Objective:** Deliver the interactive features that make Firn feel like an IDE during editing.

**Frontend work — Completion:**

- Add a real CodeMirror completion source backed by `LSPComplete`
- Map LSP completion kinds to icons/styles
- Show completion documentation/details in the popup
- Support insert text and snippet insertion — for v1, support `$0` (final cursor position) and `${n:placeholder}` tabstops via CodeMirror's snippet API; full nested snippet grammar is a follow-on
- Keep `Tab` and `Enter` behavior aligned with current editor expectations
- **Coordinate with the existing `autocompletion()` extension** in `extensions.ts` — the LSP source should replace or integrate with the default CodeMirror autocomplete to avoid double-completion popups

**Frontend work — Hover:**

- Render hover tooltips backed by `LSPHover` requests
- Tooltip appears on mouse hover over valid symbol positions
- Tooltip disappears correctly on mouse leave and cursor movement
- Render markdown content from hover responses when available

**Frontend work — Definition navigation:**

- `F12` keybinding for go-to-definition
- `Cmd+Click` (macOS) / `Ctrl+Click` (Linux/Windows) for go-to-definition
- Definition navigation opens unopened target files through the existing `ideStore.openFile` flow
- Cross-file definition jumps position the cursor at the target location

**Important details:**

- Respect trigger characters and explicit invocation
- Do not block typing on slow completion responses
- Drop stale completion results when document versions advance
- Hover and definition *request plumbing* (backend) is in #20; this phase is the frontend rendering and interaction layer

**Acceptance criteria:**

- Completion triggers during typing and via explicit invocation
- Snippet and plain-text insertion both work
- Hover is stable and disappears correctly
- Definition opens the target file and positions the cursor correctly

**Suggested owners:**

- `react-specialist`
- `frontend-developer`

**Review gate:**

- Code review focused on editor-event correctness, popup behavior, and stale-response handling

## Phase 6: Hardening and immediate follow-ons

**Objective:** Finish Milestone 5 in a way that scales to Firn's actual product promise.

**Hardening tasks:**

- Add structured logs for LSP startup/shutdown/request failures
- Verify server teardown on workspace switch and app close
- Validate cross-platform binary lookup and URI handling
- Exercise external file changes and autosave interactions

**Immediate follow-on tickets to create after TS is stable:**

- Go integration via `gopls`
- Python integration via `pyright`
- Find references
- Rename symbol
- Quick fix / code actions
- Format document/range

TypeScript-only delivery is a milestone win, but not the end-state for Firn's multi-workspace value proposition.

## Parallel Execution Plan

Once Phase 0 is locked, these tracks can run in parallel with disjoint write scopes:

### Track A: Backend LSP core (#19)

- Scope: `internal/lsp/`, `app.go`, backend tests (stdio only, TCP deferred)
- Owner: `backend-developer`, `golang-pro`
- Blocks: all other tracks consume its contract

### Track B: Frontend document lifecycle (#73)

- Scope: `frontend/src/hooks/useLSPDocumentSync.ts`, `frontend/src/types/lsp.ts`, editor wiring
- Owner: `react-specialist`, `typescript-pro`
- Depends on: finalized App contract from Track A

### Track C: Diagnostics surfaces (#21)

- Scope: `frontend/src/stores/lspStore.ts`, `frontend/src/components/Terminal/Terminal.tsx`, `frontend/src/components/StatusBar/StatusBar.tsx`, editor lint integration, **`ideStore` diagnostic state removal**
- Owner: `frontend-developer`, `ui-designer`
- Depends on: diagnostics event shape from Track A, document lifecycle from Track B

### Track D: Completion, hover, and definition navigation (#22)

- Scope: completion source, hover tooltip, F12/Cmd+Click definition commands, **CodeMirror autocompletion integration**
- Owner: `react-specialist`, `typescript-pro`
- Depends on: request APIs from Track A, editor lifecycle from Track B

### Track E: Review loop

- Scope: code review after each phase, then fix cycle until clean
- Owner: `code-reviewer`, `debugger`, `performance-engineer`, `accessibility-tester`

## Verification Matrix

Every phase should be verified with automated tests plus manual smoke coverage.

### Backend tests

- JSON-RPC framing/parsing (content-length header, partial reads, multiple messages in one read)
- Request/response correlation and timeout behavior
- stdio transport lifecycle (start, communicate, graceful shutdown, crash detection)
- URI/path normalization on Unix and Windows path formats
- Server restart after unexpected process exit (including backoff and max-retry behavior)
- Document open/close reference counting and server teardown at zero
- Concurrent multi-file editing (open 3+ files, edit two simultaneously, close one — verify ref counting and per-file diagnostics correctness)

### Frontend tests

- document open/change/save/close sequencing
- debounced change flushes the latest document state
- diagnostics store updates and clears correctly
- problems list navigation opens the right file and position
- completion source drops stale responses

### Manual smoke tests

- Open a TS workspace and a TS file
- Introduce a type error and verify editor underline, gutter marker, status count, and problems list entry
- Fix the error and verify cleanup
- Hover a known symbol and verify tooltip content
- Trigger completion and insert a result
- Go to definition across files
- Close the last TS file and verify the server stops
- Reopen the file and verify the server restarts
- Switch workspaces and verify old diagnostics disappear and new workspace state initializes cleanly
- Run with the TS language server missing and verify the app shows a real error instead of failing silently

## File-Level Implementation Map

### New backend files

- `internal/lsp/manager.go`
- `internal/lsp/client.go`
- `internal/lsp/transport.go`
- `internal/lsp/transport_stdio.go`
- `internal/lsp/registry.go`
- `internal/lsp/types.go` (Firn's subset of LSP types — single file)
- `internal/lsp/uri.go`

### Likely backend edits

- `app.go`
- `main.go` only if app construction/bootstrap changes require it

### New frontend files

- `frontend/src/types/lsp.ts`
- `frontend/src/stores/lspStore.ts`
- `frontend/src/hooks/useLSPDocumentSync.ts`
- `frontend/src/hooks/useLSPDiagnostics.ts`
- `frontend/src/hooks/useLSPCompletions.ts`
- `frontend/src/hooks/useLSPNavigation.ts`
- `frontend/src/components/Problems/` if the problems panel deserves its own component

### Likely frontend edits

- `frontend/src/App.tsx`
- `frontend/src/components/Editor/CodeMirrorEditor.tsx`
- `frontend/src/components/Editor/Editor.tsx`
- `frontend/src/components/Editor/codemirror/extensions.ts`
- `frontend/src/components/Terminal/Terminal.tsx`
- `frontend/src/components/StatusBar/StatusBar.tsx`
- `frontend/src/hooks/useAutosave.ts`
- `frontend/src/hooks/useWorkspacePersistence.ts`
- `frontend/src/hooks/useFileWatcher.ts`

## Recommended Start Order

1. Lock the LSP lifetime policy and update ticket wording.
2. Build the backend LSP manager and transport layer.
3. Wire editor document lifecycle events to the backend.
4. Deliver the TypeScript vertical slice with real diagnostics.
5. Replace the problems placeholder and hook status counts.
6. Add completion, hover, and definition UX.
7. Harden, review, and then immediately queue Go/Python integrations.

## Bottom Line

> **Updated 2026-03-28:** All identified gaps have been resolved in the tickets and this document. The milestone is implementation-ready.

The critical fixes that were applied:

- ✅ All tickets use `typescript-language-server`, not raw `tsserver`
- ✅ Workspace-scoped lifetime locked as the policy
- ✅ #19 expanded with `didClose`, version tracking, capability handling, crash recovery, URI normalization, app shutdown, and required tests
- ✅ #73 spun out for frontend document sync (correct given autosave/watcher/restore complexity)
- ✅ #22 expanded to own hover tooltips and definition navigation UX (not just completion)
- ✅ #21 explicitly migrates diagnostic state from `ideStore` to `lspStore`
- ✅ Workspace root resolution is backend-internal across all tickets
- ✅ TCP transport deferred; transport interface makes it trivial to add later
- ✅ CodeMirror autocompletion integration explicitly addressed in #22
- ✅ Phase numbering aligned to ticket numbers (#19 → #73 → #20 → #21 → #22)
- ✅ Crash recovery specifies exponential backoff strategy and max-retry cap
- ✅ `didChange` debounce default pinned at 150ms
- ✅ `languageId` mapping specified per file extension in `registry.go`
- ✅ Binary resolution clarified: workspace-local `node_modules/.bin/`, system PATH fallback, `--tsserver-path` for mixed installs
- ✅ Snippet support scoped for v1: `$0` and `${n:placeholder}` tabstops, full grammar deferred
- ✅ Concurrent multi-file test scenarios added to both Phase 1 tests and verification matrix

If Firn follows this sequence, Milestone 5 will produce a real IDE foundation instead of a one-off autocomplete patch.

# Firn IDE - Lessons Learned

## Phase 1: LSP Foundation (2026-03-28)

### 1. Self-introduced bug from fix cycle: stopping flag set before shutdownServer

**What happened:** During code review, a reviewer flagged a DidClose/ShutdownAll race. The fix set `entry.stopping = true` inside DidClose before calling `shutdownServer`. But `shutdownServer` treats `stopping == true` as "another goroutine is already handling this" and returns early. Result: the server was never actually shut down when the last document closed.

**Why it was missed:** The fix was tested only by verifying compilation and race-detector pass, not by writing a test that exercises the zero-doc teardown path end-to-end. The existing tests bypassed `Manager.DidClose` by directly manipulating `entry.openDocs`, so the regression was invisible.

**Lesson:** When fixing a race condition, write a test for the exact scenario BEFORE applying the fix. Don't rely on existing tests that bypass the layer you're fixing. Flag ownership semantics matter — if a function checks a flag to decide whether to act, the caller must not set that flag before calling it.

### 2. openDocs used as version map instead of reference counter

**What happened:** `openDocs` was typed as `map[string]int` where the int was the document version. The plan called it "reference counting" but the implementation stored versions, not counts. Opening the same file in two panes collapsed into one map entry. The first DidClose deleted it, potentially shutting down the server while the second pane was still active.

**Why it was missed:** The plan said "Track open documents per workspace/language with version numbers" which conflated two concerns: tracking which documents are open (ref counting) and tracking what version each document is at (for stale response filtering). The implementation followed the plan's wording literally without separating the two concerns.

**Lesson:** When the spec says "track documents with versions," separate the concerns: ref counting (how many consumers have this document open) is distinct from version tracking (what version of the content has been sent to the server). A single map field can't serve both purposes. Design the data structure around the operations that will use it (open/close for ref counting, didChange for version, diagnostics filtering for version comparison).

### 3. Tests bypassed the layer under test

**What happened:** Manager integration tests manually constructed `entry.openDocs[uri] = 1` and called `entry.client.DidClose(uri)` directly, instead of going through `Manager.DidOpen()` and `Manager.DidClose()`. This meant the reference counting, version tracking, and zero-doc shutdown logic in the Manager layer was never exercised by any test.

**Why it was missed:** The initial test setup used `startServer` directly (bypassing `ensureServer`) because the mock server needed special env vars. This made it natural to also bypass `DidOpen`/`DidClose` and manipulate the internals directly. Each shortcut felt small, but they cascaded into a test suite that validated the Client layer while leaving the Manager layer untested.

**Lesson:** Tests should exercise the public API of the layer under test. If test setup constraints force you to bypass an API (e.g., using `startServer` directly), still call the public methods for the operations you're testing. Extract test helpers (like `startMockManager`) that handle setup complexity without leaking it into test assertions.

### 4. Stale diagnostics forwarded without version filtering

**What happened:** The client advertised `publishDiagnostics.versionSupport: true`, telling the server to include version numbers in diagnostics. But `handleNotification` forwarded every diagnostics notification unchanged without comparing the diagnostics version against the tracked document version. Stale diagnostics would overwrite current ones in the frontend.

**Why it was missed:** Phase 1 focused on "can diagnostics be received and routed" without considering the temporal ordering problem. The version tracking was implemented in `openDocs` for `didChange` but was never wired to the notification handler. The two concerns (document sync and notification handling) were implemented independently without connecting them.

**Lesson:** When advertising a capability (versionSupport), implement the corresponding filtering in the same pass. Capabilities create contracts — if you tell the server you support versioned diagnostics, the backend must honor versions.

### 5. LSP workspace update coupled to run-profile success

**What happened:** `LoadRunProfiles` called `SetLSPWorkspaceRoot` only after `loadRunProfilesLocked` succeeded. If profile loading failed during a workspace switch, the LSP manager stayed pointed at the old workspace, routing all subsequent LSP requests to the wrong project context.

**Why it was missed:** The LSP workspace sync was added late (during code review) and was inserted at the end of `LoadRunProfiles` after the profile loading, following the existing code flow. The error-early-return at line 288 was already present, so the LSP sync was unreachable on failure.

**Lesson:** When coupling two subsystems (profiles and LSP) to a shared workspace state change, ask: "which of these MUST succeed for the other to proceed?" The LSP workspace root should always follow the user's workspace switch intent, regardless of whether profile detection succeeds. Independent subsystems should not gate each other's state transitions.

### 6. types.go bloated with dead constants and write-only struct trees

**What happened:** `types.go` defined all 25 `CompletionItemKind` constants, both `InsertTextFormat` constants, and 8 nested `ClientCapabilities` structs. None of the constants were referenced in production code — the backend passes them through as integers. The 8 capabilities structs existed solely to construct one static JSON object in `Initialize()` that never changes at runtime.

**Why it was missed:** The implementation followed a "define Firn's subset of LSP types" approach and defaulted to completeness — defining every enum value in a type felt like "the right thing to do" for a protocol implementation. The distinction between "types the backend needs to read/write" (struct fields) and "constants the frontend needs to interpret" (enum values for icon mapping) wasn't recognized during design. Similarly, the capabilities blob was modeled as typed Go structs because "everything should be typed" — without asking whether Go code ever reads those types back.

**Lesson:** Ask "who consumes this?" for every type and constant. If the Go backend just passes an integer through to the frontend as JSON, don't define 25 named constants in Go — the frontend will define its own TypeScript enums. If a value is write-once and never read back by Go code, a `json.RawMessage` literal is simpler and more honest than a type tree. Define types for what you deserialize and inspect, not for what you just marshal and forward.

### 7. Two parallel maps in registry with identical keys

**What happened:** `registry.go` had `extensionToLanguageID` and `extensionToFamily` as separate `map[string]string` variables with identical key sets. Adding a new extension required updating both maps — a maintenance hazard where they could drift.

**Why it was missed:** The two lookups (`LanguageIDForExtension` and `FamilyForExtension`) were implemented as separate methods, and the natural Go pattern was one map per method. The shared key set wasn't recognized as a code smell during implementation.

**Lesson:** When two maps share identical keys, merge them into one map with a struct value. One map, one lookup, no drift risk.

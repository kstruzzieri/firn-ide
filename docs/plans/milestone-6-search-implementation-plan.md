# Milestone 6: Search Implementation Plan

> For agentic workers: implement this plan task by task. After every task, run the listed verification, then perform a code review and an adversarial review. Fix all findings, then repeat review until no findings remain.

**Goal:** Deliver reliable workspace search and in-file find/replace for Firn IDE without inventing search data, blocking the UI, or weakening the existing editor/workspace model.

**Ticket scope:**

- [#23 Search - ripgrep Integration](https://github.com/kstruzzieri/firn-ide/issues/23): call `rg`, parse structured results, respect `.gitignore`, and support regex, case sensitivity, and whole word.
- [#24 Search - UI Panel](https://github.com/kstruzzieri/firn-ide/issues/24): search input/options, results grouped by file with context, click result to open at location, and `Cmd+Shift+F`.
- [#25 Search - Find in File](https://github.com/kstruzzieri/firn-ide/issues/25): `Cmd+F`, match highlighting, match navigation, replace, replace all, and regex support.

**Baseline:**

- `develop` is synced to `origin/develop` at PR #85 merge `682462be7a38edf8f7a752f0ca02b2e12a98ea49`.
- PR #84 terminal close-all behavior is included at merge `df883e536742f43bbc610563f23ff7fa1bf4c535`.
- `.claude/tasks/todo.md` already records PR #84, PR #85, and the Milestone 6 Search focus.
- `@codemirror/search` is already installed, and the editor already includes CodeMirror search keymaps/theme selectors.
- The sidebar has a Search activity button, but `App.tsx` still always renders `FileExplorer` in the left panel.
- `navigateToEditorLocation()` already centralizes "open file, then jump to line/column" behavior.

**Production data rule:** Do not add hard-coded, fallback, stub, placeholder, mock, or fake search results in production code. Search output must come from the current workspace files through `rg` or the current editor document through CodeMirror. If data is unavailable, surface a specific empty, missing-tool, invalid-regex, canceled, or failure state.

**Non-goals for Milestone 6:**

- Full Search Everywhere modal with files, symbols, actions, and profiles.
- LSP symbols, find usages, rename, references, or semantic search.
- Project-wide replace. Only file-local replace is in #25.
- Git-aware changed-file search and commit search.
- Indexing daemon, polling, or background crawlers. Use on-demand `rg`.

---

## Architecture Direction

### Backend Search Service

Create a focused `internal/search` package rather than burying process execution in `app.go`.

| File | Responsibility |
|------|----------------|
| `internal/search/types.go` | Request, option, response, result, match, range, and error/status types |
| `internal/search/runner.go` | Build and execute `rg` commands through `exec.CommandContext` with no shell |
| `internal/search/parser.go` | Parse `rg --json` events into normalized file-grouped results |
| `internal/search/manager.go` | Track active searches, cancel stale requests, enforce timeouts and result limits |
| `internal/search/*_test.go` | Parser, argument mapping, missing binary, cancelation, `.gitignore`, Unicode, and large-result tests |
| `app.go` | Wails bindings such as `SearchWorkspace` and `CancelSearch` |

Use `rg --json` as the primary contract. Exit code `1` means no matches, not a hard error. Exit code `2` or malformed JSON is a real error. Missing `rg` must produce an actionable message.

### Frontend Search State

Keep search state separate from `ideStore` unless a field is truly shared with the whole IDE.

| File | Responsibility |
|------|----------------|
| `frontend/src/types/search.ts` | Frontend request/result/status types mirroring generated Wails models |
| `frontend/src/stores/searchStore.ts` | Query, options, loading/error state, active request id, results, expansion state |
| `frontend/src/hooks/useWorkspaceSearch.ts` | Debounced calls to Wails, stale result dropping, workspace-switch cancelation |
| `frontend/src/utils/searchRanges.ts` | Convert `rg` byte offsets from JSON into JS string offsets and editor columns |
| `frontend/src/components/Search/` | Search panel component, styles, and public export |

Result navigation must reuse `navigateToEditorLocation()` so binary-file handling, file opening, and editor navigation remain consistent with Problems and LSP definition navigation.

### UX Constraints

- Search panel is a left-panel tool view, not a modal and not a marketing-style surface.
- Controls should be compact: input, icon buttons/toggles for regex/case/whole word, and file-grouped results.
- Empty states must be honest: no recent/frequent fake data for Milestone 6.
- Long paths, long lines, and huge result sets must not resize the panel unpredictably.
- `Cmd+Shift+F` opens project/workspace search. `Cmd+F` opens in-file search.
- Header "Search Everywhere" must not claim full Search Everywhere behavior unless that feature is implemented. For this milestone, it may open the Search panel or stay scoped behind a future ticket.

---

## Parallelization Strategy

Run workers in parallel only where file ownership is disjoint and review gates can still serialize task completion:

- `backend-developer` plus `golang-pro`: Task 1 backend `internal/search` package and Wails bindings.
- `frontend-developer` plus `typescript-pro`: Task 2 frontend search state/client after the backend model contract is stable.
- `ui-designer` plus `react-specialist`: Task 3 Search panel once Task 2 exposes stable store/hook APIs.
- `react-specialist` plus `typescript-pro`: Task 4 in-file CodeMirror search can start after shortcut ownership is agreed, because it is mostly independent of backend search.
- `code-reviewer`, `architect-reviewer`, `performance-engineer`, and `accessibility-tester`: run the review gates after each task.

Do not merge multiple task outputs past a gate. If parallel workers overlap in `App.tsx`, `useKeyboardShortcuts.ts`, or shared CSS tokens, resolve those changes before marking either task complete.

---

## Task 1: #23 Backend ripgrep Integration

**Status:** Not started.

**Purpose:** Add a production backend search service that invokes `rg` safely, respects ignore rules, parses structured results, and exposes Wails bindings.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `internal/search/types.go` | Define `SearchRequest`, `SearchOptions`, `SearchResponse`, `FileResult`, `LineMatch`, `MatchRange`, and typed status/error values |
| `internal/search/runner.go` | Convert options into `rg` args and run with `exec.CommandContext` |
| `internal/search/parser.go` | Parse `begin`, `match`, `context`, `end`, and `summary` JSON events |
| `internal/search/manager.go` | Request id tracking, cancelation, timeout, and bounded result collection |
| `internal/search/*_test.go` | Unit and integration-style tests using temporary workspaces and PATH-controlled command helpers for edge cases |
| `app.go` | Add `SearchWorkspace(request)` and `CancelSearch(requestID)` bindings |
| `frontend/wailsjs/go/main/App.*` / `frontend/wailsjs/go/models.ts` | Regenerate Wails bindings after Go API changes |

**Implementation notes:**

- Use `exec.LookPath("rg")`; do not shell out through `sh -c`, `zsh -c`, or string-concatenated commands.
- Default to `rg` behavior that respects `.gitignore`, `.ignore`, and hidden-file defaults.
- Use `--json`, `--line-number`, `--column`, `--color=never`, and explicit `--regexp`.
- Map options with arguments, not string templates:
  - regex off: `--fixed-strings`
  - case sensitive on/off: `--case-sensitive` or `--ignore-case`
  - whole word: `--word-regexp`
  - include/exclude globs, if added: repeated `--glob` args
- Treat exit code `1` as a successful empty response.
- Enforce a named result cap and timeout. Return `truncated: true` when the cap is hit.
- Preserve `rg` byte offsets in backend output and convert them on the frontend before rendering highlights or editor columns.
- Validate that the requested root is non-empty, absolute, exists, and is a directory.

**Acceptance criteria:**

- Searching a workspace returns file-grouped matches with path, relative path, line number, matched line text, and match ranges.
- `.gitignore` is respected by default.
- Regex, literal search, case sensitivity, and whole-word search are all covered by tests.
- Missing `rg` returns an actionable error state; it is not treated as "no results".
- Invalid regex returns an actionable error state; it is not swallowed.
- Binary files and unreadable files do not crash the search flow.
- Large result sets are bounded and marked truncated.
- Search commands are cancelable and do not leak processes on repeated requests.

**Verification:**

- `go test ./internal/search`
- `go test ./...`
- Regenerate Wails bindings if the Go API changed.
- `git diff --check`

**Code review checklist:**

- Confirm no shell invocation, no command string interpolation, and no path/query injection surface.
- Confirm request validation rejects empty or non-directory roots with clear errors.
- Confirm exit code handling distinguishes no matches from real failures.
- Confirm structured parser tests cover match, context, summary, malformed JSON, and no-match flows.
- Confirm exported types are stable enough for frontend use and do not expose unnecessary backend internals.
- Confirm no fake search results or fallback file data are introduced.

**Adversarial review checklist:**

- Workspace path contains spaces, quotes, Unicode, and `#`.
- Query contains regex metacharacters, invalid regex, backslashes, quotes, newlines, and extremely long input.
- Search is canceled while `rg` is producing output.
- `.gitignore` excludes a file that would otherwise match.
- A single file has thousands of matches and trips the result cap.
- Match ranges involve emoji or other multibyte characters.
- `rg` is missing from PATH.
- Windows path separators and drive letters do not break relative-path grouping.

---

## Task 2: #24 Frontend Search Client and State

**Status:** Not started.

**Purpose:** Add typed frontend search state and request orchestration so the UI can debounce input, cancel stale work, show truthful status, and safely render backend results.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `frontend/src/types/search.ts` | Frontend-facing request, option, result, and status types |
| `frontend/src/stores/searchStore.ts` | Query/options/results/loading/error/truncated state and actions |
| `frontend/src/hooks/useWorkspaceSearch.ts` | Debounced search execution, request id generation, cancelation, stale result dropping |
| `frontend/src/utils/searchRanges.ts` | Byte-offset to JS-string-offset conversion and highlighted segment generation |
| `frontend/src/__tests__/stores/searchStore.test.ts` | Store state transitions |
| `frontend/src/__tests__/hooks/useWorkspaceSearch.test.ts` | Debounce, cancelation, stale results, workspace switch behavior |
| `frontend/src/__tests__/utils/searchRanges.test.ts` | Unicode and byte-offset conversion coverage |

**Acceptance criteria:**

- Empty query does not call the backend and clears transient errors.
- No workspace selected produces a user-facing "open a workspace to search" state.
- Debounced input triggers at most one active backend request per latest query.
- Starting a new request cancels or marks stale the previous request.
- Late results from an old workspace or old query are ignored.
- Regex/case/whole-word options map directly to backend request fields.
- Missing `rg`, invalid regex, canceled search, no matches, and truncated results are distinct states.
- Match ranges render correctly for ASCII, accented characters, and emoji.

**Verification:**

- `cd frontend && npm test -- --watch=false --runTestsByPath src/__tests__/stores/searchStore.test.ts src/__tests__/hooks/useWorkspaceSearch.test.ts src/__tests__/utils/searchRanges.test.ts`
- `cd frontend && npm test -- --watch=false`
- `cd frontend && npm run build`
- `cd frontend && npm run format:check -- src/types/search.ts src/stores/searchStore.ts src/hooks/useWorkspaceSearch.ts src/utils/searchRanges.ts`
- `git diff --check`

**Code review checklist:**

- Confirm search state is not mixed into `ideStore` unless it needs global IDE behavior.
- Confirm request ids are generated dynamically and are not hard-coded.
- Confirm errors are preserved for display and not replaced by generic success states.
- Confirm selectors avoid unnecessary re-renders as results grow.
- Confirm all async branches clear loading state correctly.

**Adversarial review checklist:**

- Type quickly enough to produce overlapping promises.
- Switch workspace while a search is in flight.
- Toggle regex/case/whole-word while a search is in flight.
- Receive an old "no results" response after a newer response with matches.
- Render a line with multiple matches, overlapping-looking regex ranges, and emoji.
- Backend returns `truncated: true` with partial data.

---

## Task 3: #24 Search UI Panel and Navigation

**Status:** Not started.

**Purpose:** Make the Search activity view usable: input, options, file-grouped results, honest states, keyboard entry point, and click-to-open navigation.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `frontend/src/components/Search/SearchPanel.tsx` | Search panel UI and result rendering |
| `frontend/src/components/Search/SearchPanel.module.css` | Compact, stable panel styling |
| `frontend/src/components/Search/index.ts` | Public component export |
| `frontend/src/App.tsx` | Route left-panel content based on active sidebar view |
| `frontend/src/components/Header/Header.tsx` | Wire header search button to the scoped Search panel or leave full Search Everywhere for a future ticket |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | Add `Cmd+Shift+F` / `Ctrl+Shift+F` project search shortcut |
| `frontend/src/__tests__/components/Search/SearchPanel.test.tsx` | UI states, options, grouped results, navigation |
| `frontend/src/__tests__/hooks/useKeyboardShortcuts.test.ts` | Search shortcut behavior |
| `frontend/src/__tests__/App.test.tsx` | Left-panel routing smoke coverage |

**Acceptance criteria:**

- Clicking the Search sidebar icon opens the Search panel in the left tool area.
- `Cmd+Shift+F` opens the Search panel, expands the left panel if needed, and focuses the search input.
- Search input supports regex, case-sensitive, and whole-word toggles.
- Results are grouped by file with relative path, match count, line number, context line, and highlighted match spans.
- Clicking a result calls `navigateToEditorLocation(path, line, column)` and opens the file at the match.
- Loading, no workspace, empty query, no matches, missing `rg`, invalid regex, failure, and truncated states are visually distinct and accessible.
- Long lines and paths wrap or truncate without breaking the panel layout.
- The UI does not display fake recent searches or placeholder results.

**Verification:**

- `cd frontend && npm test -- --watch=false --runTestsByPath src/__tests__/components/Search/SearchPanel.test.tsx src/__tests__/hooks/useKeyboardShortcuts.test.ts src/__tests__/App.test.tsx src/__tests__/Sidebar.test.tsx src/__tests__/Header.test.tsx`
- `cd frontend && npm test -- --watch=false`
- `cd frontend && npm run build`
- `cd frontend && npm run lint`
- `cd frontend && npm run format:check -- src/components/Search/SearchPanel.tsx src/components/Search/SearchPanel.module.css src/components/Search/index.ts src/App.tsx src/hooks/useKeyboardShortcuts.ts`
- Manual smoke: open a workspace, press `Cmd+Shift+F`, search known text, toggle options, click a result, and verify editor navigation.
- `git diff --check`

**Code review checklist:**

- Confirm the panel follows existing Firn visual density and does not introduce nested card-heavy UI.
- Confirm keyboard shortcut ownership does not conflict with in-file `Cmd+F`.
- Confirm result click reuses shared navigation utilities.
- Confirm the panel has labels, roles, focus behavior, and keyboard-accessible result rows.
- Confirm result rendering handles empty strings and long content without layout shifts.
- Confirm no hard-coded sample paths, counts, or fake results exist in production code.

**Adversarial review checklist:**

- Search while the left panel is collapsed.
- Search with no workspace open.
- Search a path with very deep directories and long filenames.
- Click a result for a binary file or a file deleted after results were produced.
- Switch workspace after results are visible, then click an old result.
- Use keyboard-only navigation through input, toggles, groups, and results.
- Full repo produces enough results to trigger truncation.

---

## Task 4: #25 Find in File and Replace

**Status:** Not started.

**Purpose:** Ensure CodeMirror's in-file search behavior is explicit, styled, tested, and does not conflict with project search.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `frontend/src/components/Editor/codemirror/extensions.ts` | Search panel/keymap configuration and shortcut ownership |
| `frontend/src/components/Editor/codemirror/theme.ts` | Search panel and match highlight styling |
| `frontend/src/components/Editor/CodeMirrorEditor.tsx` | Any integration needed for search panel lifecycle |
| `frontend/src/components/Editor/Editor.tsx` | No-file behavior if `Cmd+F` has no active editor |
| `frontend/src/__tests__/components/Editor/CodeMirrorEditor.test.tsx` | In-file search integration behavior where practical |
| `frontend/src/__tests__/components/Editor/codemirror/search.test.ts` | Search command/keymap utility coverage if a wrapper module is introduced |

**Implementation notes:**

- Prefer CodeMirror's `@codemirror/search` commands for document search, match highlighting, navigation, replace, replace all, and regex.
- Add a small local wrapper only if the existing keymap cannot express the required shortcut behavior clearly.
- `Cmd+F` / `Ctrl+F` must target in-file search when an editor is focused.
- `Cmd+Shift+F` / `Ctrl+Shift+F` must target project search, not file-local replace.
- File-local replace should operate on the active editor document and flow through normal `onContentChange`, autosave, and modified-tab behavior.

**Acceptance criteria:**

- `Cmd+F` opens an in-editor search bar for the active file and focuses the query field.
- All matches are highlighted using the Firn Glacier search styling.
- Next/previous match navigation works from the search panel and keyboard.
- Replace and Replace All work for literal and regex searches.
- Invalid regex is shown by the search UI and does not corrupt document content.
- Replacements update editor content through normal change handling and mark the file modified.
- `Cmd+Shift+F` opens project search from the editor without invoking file-local replace.

**Verification:**

- `cd frontend && npm test -- --watch=false --runTestsByPath src/__tests__/components/Editor/CodeMirrorEditor.test.tsx src/__tests__/components/Editor/codemirror/search.test.ts src/__tests__/hooks/useKeyboardShortcuts.test.ts`
- `cd frontend && npm test -- --watch=false`
- `cd frontend && npm run build`
- `cd frontend && npm run lint`
- `cd frontend && npm run format:check -- src/components/Editor/codemirror/extensions.ts src/components/Editor/codemirror/theme.ts src/components/Editor/CodeMirrorEditor.tsx`
- Manual smoke: open a file, press `Cmd+F`, navigate matches, replace one match, replace all matches, toggle regex, then verify modified state and autosave behavior.
- `git diff --check`

**Code review checklist:**

- Confirm CodeMirror search commands are used instead of reimplementing matching logic by hand.
- Confirm shortcut behavior is platform-aware through existing `formatShortcut` / platform utility patterns where display is involved.
- Confirm find/replace changes use the editor's normal content-change pipeline.
- Confirm search styling does not make diagnostics, selection, completion, hover, or definition UI unreadable.
- Confirm tests do not rely on fake production results.

**Adversarial review checklist:**

- Search and replace in an unsaved modified file.
- Replace all with zero matches.
- Invalid regex, lookarounds, escaped slashes, backreferences, and replacement `$` text.
- Large file with thousands of matches.
- File with CRLF or mixed line endings.
- File with emoji and combining characters.
- Open search, switch tabs, then return to the original file.

---

## Task 5: Milestone 6 Final Integration and Documentation

**Status:** Not started.

**Purpose:** Close the milestone only after backend search, Search panel, and in-file find/replace work together and the tracker reflects reality.

**Files likely involved:**

| File | Responsibility |
|------|----------------|
| `.claude/tasks/todo.md` | Mark completed Search tasks and record review outcomes |
| `docs/roadmap.md` | Update Milestone 6 status and checkboxes if implementation is complete |
| `docs/design-specification.md` | Update only if the implemented shortcut or scope behavior intentionally differs from the spec |
| `CHANGELOG.md` | Add user-facing Search entry if the project is maintaining release notes for the milestone |

**Acceptance criteria:**

- #23, #24, and #25 implementation tasks are complete.
- Each task has passed code review and adversarial review after fixes.
- Search behavior is documented in the roadmap/tracker without overstating unimplemented Search Everywhere features.
- Manual smoke notes cover at least one successful search, one empty search, one invalid regex, one truncated or large-result case, and one find/replace flow.

**Verification:**

- `go test ./...`
- `cd frontend && npm test -- --watch=false`
- `cd frontend && npm run build`
- `cd frontend && npm run lint`
- `cd frontend && npm run format:check`
- `git diff --check`
- Optional when available: Wails app smoke test on macOS with a real workspace containing TypeScript, Go, Python, ignored files, and Unicode filenames.

**Code review checklist:**

- Confirm all Search issues' requirements are satisfied or explicitly deferred with a follow-up ticket.
- Confirm no new global shortcuts conflict with existing navigation, LSP, terminal, or run-profile shortcuts.
- Confirm docs and tracker match implemented behavior.
- Confirm generated Wails files match Go bindings.
- Confirm no unrelated cleanup or refactor slipped into the milestone.

**Adversarial review checklist:**

- Workspace switch while search and editor find panels are active.
- Repeated Search panel open/close cycles.
- Missing `rg` on a clean machine.
- Huge monorepo search with truncation.
- Hidden/ignored files expectations.
- Deleted file after search result but before click.
- Accessibility pass for keyboard-only search and screen-reader labels.

---

## Final Milestone Exit Gate

Do not mark Milestone 6 complete until:

- [ ] Task 1 backend ripgrep integration is complete.
- [ ] Task 2 frontend search state/client is complete.
- [ ] Task 3 Search panel UI/navigation is complete.
- [ ] Task 4 find in file/replace is complete.
- [ ] Task 5 final docs/tracker closeout is complete.
- [ ] Each task has passed code review and adversarial review after fixes.
- [ ] `go test ./...` passes.
- [ ] `cd frontend && npm test -- --watch=false` passes.
- [ ] `cd frontend && npm run build` passes.
- [ ] Touched frontend files pass direct ESLint and Prettier checks.
- [ ] Full lint warnings are either fixed or documented as pre-existing.
- [ ] Manual smoke notes exist for workspace search, invalid regex/missing `rg`, result navigation, and in-file replace.

---

## Review Log

Use this section after each task.

### Task 1 Review

- Implementation:
- Verification:
- Code review:
- Adversarial review:
- Fix/re-review:

### Task 2 Review

- Implementation:
- Verification:
- Code review:
- Adversarial review:
- Fix/re-review:

### Task 3 Review

- Implementation:
- Verification:
- Code review:
- Adversarial review:
- Fix/re-review:

### Task 4 Review

- Implementation:
- Verification:
- Code review:
- Adversarial review:
- Fix/re-review:

### Task 5 Review

- Implementation:
- Verification:
- Code review:
- Adversarial review:
- Fix/re-review:

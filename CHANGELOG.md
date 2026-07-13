# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.11.0] - 2026-07-12

Stabilization release for the managed language-server, Structure view, Git,
terminal, and installation work completed since v0.10.0.

### Language Intelligence

- Managed provisioning now covers pinned, checksum-verified Python, Go,
  TypeScript/JavaScript, and Rust language servers without modifying the
  user's project or global PATH (#112, #151).
- Python analysis now wires detected project environments and rooted import
  paths correctly, preserves project metadata across interpreter overrides,
  rejects stale overrides, and restores automatic detection on reset (#112).
- Provisioning retry, nested-project roots, Alpine/musl Node fallbacks, Rust
  document sync, and actionable offline recovery were hardened and verified in
  the packaged native closure pass for #112.
- A Structure view exposes document symbols for the active file with refresh,
  filtering, keyboard navigation, and click-to-reveal (#168).

### Git

- Stage or unstage individual hunks from the editor gutter and diff views, with
  zero-context patches so nearby edits remain independent (#163).
- Intent-to-add support makes untracked files diffable and hunk-stageable
  without staging their contents (#167).
- The working-tree side of unstaged diffs is editable in place, with save
  ordering and hunk anchors hardened against stale refreshes and accidental
  cross-hunk edits (#169).

### Terminal

- Terminal sessions now start only on explicit request, open in the loaded
  workspace root, and recover the prompt reliably after command completion
  instead of leaving xterm input wedged.

### Installation

- Added a macOS/Linux install script with latest-release resolution, explicit
  version pinning, dry-run output, SHA-256 verification, and platform-aware
  installation targets.

## [0.10.0] - 2026-07-08

Milestone 7: Git integration. Firn now surfaces working-tree status, diffs,
staging, commit, and branch operations directly in the workspace, and the LSP
hover was reworked to highlight and link like a full editor.

### Git
- Working-tree status in the file tree (modified / added / deleted / untracked
  colors via `--git-*` tokens) and the current branch in the status bar (#26).
- Branch switcher shared between an always-visible header pill and the status
  bar, portaled to `document.body` so it is never clipped by panel stacking.
- Diff viewer: read-only side-by-side view with next/previous change navigation
  (`F7` / `Shift+F7`), resizable columns, Open File, and a live diff against the
  open editor buffer that refreshes as you type.
- Commit panel: per-file and section include checkboxes, collapse chevrons,
  filename colors by git state, stage/commit, pull/push with Publish when there
  is no upstream, a commit receipt, and workspace-scoped ownership.
- Gutter change bars with a peek popup showing a unified word-level inline diff
  (unchanged text plain, removals struck red, additions green) and one-click
  revert-to-HEAD; the popup dismisses on an editor click, an edit, or a revert.
- A `core.bare=true` repository now shows an actionable message instead of
  "not a git repository" (#27).

### Editor
- LSP hover signatures are highlighted with the file's real language parser, so
  Go and every other supported language colorize instead of falling back to a
  flat single color; documentation references render as clickable links that
  open externally.
- The hover tooltip shrink-wraps to its content and collapses padded blank
  lines, removing the empty space around short hovers.

## [0.9.0] - 2026-07-01

First public preview. Firn is a lightweight, workspace-focused IDE for macOS,
Linux, and Windows built with Wails (Go + React/Vite), using the system webview
for a small (~15MB) binary. This release consolidates the editor, workspace,
run-profile, terminal, language-server, and search work completed to date.

Requires macOS 11 (Big Sur) or later, a Linux distribution with WebKit2GTK 4.1,
or Windows 10/11 (WebView2).

### Editor
- CodeMirror 6 editor with multi-tab editing and per-tab state.
- Per-file undo history and view state (cursor, scroll) preserved across tab
  switches; external file reloads reconcile without clobbering history (#153).
- Syntax theme system: multiple palettes with live switching, a Python syntax
  overlay, and a status-bar theme picker (#113, #114, #117, #119).
- In-file find and replace (#25).

### Workspaces
- One repository can host multiple focused workspaces (e.g. `frontend/`,
  `backend/go/`), each with independent layout, run profiles, and language
  services scope.
- Workspace identity and accent colors; Workspace and Project file-tree views
  with per-region tinting (#53, #54).
- Session persistence of layout, open files, expanded paths, and active
  workspace across restarts and project switches.

### File Explorer
- Virtualized file tree for large repositories (#37, #111).
- Lazy directory loading: directory contents are read on expand, decoupling I/O
  cost from tree size, with surgical watcher reconciliation (#37, #147).

### Run Profiles
- First-class run configurations with auto-detection from `package.json`,
  `go.mod`, `pyproject.toml`, `Makefile`, and `docker-compose`.
- Workspace-owned detection and identity; per-workspace `.firn` persistence.
- Process execution with full lifecycle management (start, stop, restart,
  SIGTERM grace period) and compound (multi-step) execution (#63).
- Formalized run execution identity for parallel and compound runs (#103).
- Working-set panel with adoption, pinning, and run-recency; header run-target
  selector with `Cmd/Ctrl+R`; create/edit form with workspace assignment
  (#18, #71, #132).
- Run output views: merged, per-stream lanes (independent scroll), diff, and
  timeline; predicted-completion ETA and status badges (#107, #137).

### Terminal
- xterm.js terminal backed by a PTY, with OSC 133 shell integration for command
  markers and exit-status separators (zsh and bash) (#47).

### Language Servers
- Language server integration with per-project root resolution
  (#20, #75, #76).
- Python environment auto-wiring (interpreter, venv, extra paths) with zero
  per-project config (#112).
- Managed language-server provisioning with pinned, checksum-verified downloads
  and an interpreter picker (#112).

### Search
- Project-wide search powered by ripgrep with grouped results (#23).

### Fixed
- File tree no longer shows the wrong project's contents after switching
  projects (cross-workspace `treeSnapshot` contamination) (#156).
- Active workspace tab underline no longer strikes through the tab name on the
  first render after toggling to Workspace view (#157).
- Run-profile cards expand on click even before their first run, exposing Edit /
  Pin / Hide; a user profile's workspace can be reassigned from the edit form;
  command and output text wraps instead of truncating (#158).

### Infrastructure
- Wails v2 (Go 1.23+ backend, React 19 + TypeScript + Vite frontend).
- CI for tests, linting, and cross-platform builds; Husky pre-commit and
  pre-push hooks; golangci-lint v2.11.4; frontend and backend coverage.
- macOS dev-build fix for the UniformTypeIdentifiers framework (#145).

[Unreleased]: https://github.com/kstruzzieri/firn-ide/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/kstruzzieri/firn-ide/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/kstruzzieri/firn-ide/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/kstruzzieri/firn-ide/releases/tag/v0.9.0

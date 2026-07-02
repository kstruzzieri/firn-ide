# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-07-01

First public preview. Firn is a lightweight, workspace-focused IDE for macOS,
Linux, and Windows built with Wails (Go + React/Vite), using the system webview
for a small (~15MB) binary. This release consolidates the editor, workspace,
run-profile, terminal, language-server, and search work completed to date.

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

[Unreleased]: https://github.com/kstruzzieri/firn-ide/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/kstruzzieri/firn-ide/releases/tag/v0.9.0

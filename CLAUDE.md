# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Firn IDE is a lightweight, workspace-focused IDE for macOS, Linux, and Windows built with Wails (Go + React/Vite).

**Architecture**: Wails framework using system webview for a lightweight binary (~15MB), avoiding Electron bloat.

## Project Structure

```
firn-ide/
├── main.go                     # Application entry point
├── app.go                      # Wails bindings
├── internal/
│   ├── filesystem/             # File read/write/watch
│   ├── runprofile/             # Run profile detection, execution, management
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
│   │   │   ├── Terminal/       # xterm.js terminal
│   │   │   └── layout/         # Panel system, sidebar, header
│   │   ├── stores/             # Zustand state management
│   │   ├── hooks/              # Custom React hooks
│   │   ├── utils/              # Shared utilities
│   │   └── types/              # TypeScript type definitions
│   └── wailsjs/                # Generated Go bindings
├── docs/
│   ├── roadmap.md              # Consolidated roadmap with all issues
│   ├── design-specification.md # Full UI/UX specification
│   └── architecture.md         # System architecture guide
└── .claude/                    # Claude Code configuration
    ├── settings.json           # Shared project settings
    ├── agents/                 # 12 project-specific agents
    └── commands/               # Workflow automation commands
```

## Tech Stack

- **Framework**: Wails (Go backend + React frontend via system WebView)
- **Frontend**: React 19 + Vite + TypeScript
- **Backend**: Go 1.23+
- **State**: Zustand
- **Editor**: CodeMirror 6
- **Terminal**: xterm.js + PTY
- **Testing**: Jest + ts-jest (frontend), Go test (backend)
- **File Watching**: fsnotify with debounce (no polling)

## Key Architecture Concepts

### Workspace Model
One repository can contain multiple focused workspaces (e.g., `frontend/`, `backend/python/`, `backend/go/`), each with:
- Independent layout state (panes, tabs, splits)
- Independent Run Profiles (build/lint/test/deploy commands)
- Independent language services scope (only active workspace runs LSP servers)

### Run Profiles
Lightweight run configurations as first-class citizens:
- Commands with working directory, env vars, env files
- Auto-detection from package.json, pyproject.toml, go.mod, Makefile, docker-compose
- Process executor with lifecycle management (start, stop, restart, SIGTERM grace period)
- Real-time output streaming with line assembly
- Status badges (RUNNING, PASSED, FAILED, READY, STOPPING, STOPPED)
- Auto-expand for active states, click-to-expand for completed
- Purpose-built expanded panels per state (output preview, stats, error detail, stop progress)
- Predicted completion ETA with median-based estimation
- Pin/unpin profiles, hide/unhide, profile browser

### Performance Budgets
- Cold start: < 2-4 seconds
- Idle CPU: near 0% (no polling)
- Core RAM: ~200-450MB (without language servers)
- Only one workspace's language servers run at a time

## Development Principles
- Reference .claude/workflow.md regarding workflow orchestration

From `commands/code-review.md`:
- No hard-coded, fallback, stub, or placeholder data - all values must be dynamically derived
- Review/fix cycle continues until no issues found
- All code must be production-ready

From `commands/create-plan.md`:
- Create detailed implementation strategies for parallel agent execution
- Perform code review after each phase
- Proper error/message handling when data is unavailable

## Agents

Project-specific agents in `.claude/agents/`:
- `frontend-developer` - React/TypeScript UI
- `backend-developer` - Go backend
- `ui-designer` - Interface design
- `typescript-pro` - TypeScript expertise
- `golang-pro` - Go expertise
- `react-specialist` - React patterns
- `code-reviewer` - Code quality
- `debugger` - Issue diagnosis
- `performance-engineer` - Optimization
- `architect-reviewer` - Architecture
- `accessibility-tester` - WCAG compliance
- `dx-optimizer` - Developer experience

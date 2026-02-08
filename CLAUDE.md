# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arc IDE is a lightweight, workspace-focused IDE for macOS, Linux, and Windows built with Wails (Go + React/Vite).

**Architecture**: Wails framework using system webview for a lightweight binary (~15MB), avoiding Electron bloat.

## Project Structure

```
arc-ide/
├── main.go                  # Application entry point
├── app.go                   # Wails application logic
├── wails.json               # Wails configuration
├── frontend/                # React + Vite frontend (TypeScript)
├── docs/                    # Design documentation
│   ├── roadmap.md               # Consolidated roadmap with all issues
│   ├── design-specification.md  # Technical specification
│   └── architecture.md          # System architecture guide
└── .claude/                 # Claude Code configuration
    ├── settings.json            # Shared project settings
    ├── agents/                  # 12 project-specific agents
    └── commands/                # Workflow automation commands
```

## Intended Tech Stack (When Implementation Begins)

- **Framework**: Wails (Go backend + React frontend)
- **Frontend**: React + Vite (TypeScript)
- **Backend**: Go
- **Language Servers**: typescript-language-server, pyright, gopls
- **Search**: ripgrep for full-text search
- **File Watching**: FS events with debounce (no polling)

## Key Architecture Concepts

### Workspace Model
One repository can contain multiple focused workspaces (e.g., `frontend/`, `backend/python/`, `backend/go/`), each with:
- Independent layout state (panes, tabs, splits)
- Independent Run Profiles (build/lint/test/deploy commands)
- Independent language services scope (only active workspace runs LSP servers)

### Run Profiles
Lightweight run configurations as first-class citizens:
- Commands with working directory, env vars, env files
- Auto-detection from package.json, pyproject.toml, go.mod, docker-compose files
- Output console with clickable `file:line:col` parsing

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

# Flux IDE

A lightweight, workspace-focused IDE for macOS and Linux that stays fast on large monorepos.

![Status](https://img.shields.io/badge/status-in%20development-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

## The Problem

Modern monorepos contain frontend (React/TypeScript), backend services (Python, Go), and infrastructure code. Traditional IDEs either load everything at once (consuming 4-8GB+ RAM) or require separate windows for each language.

## The Solution

**One repo, multiple focused workspaces.** Each workspace has:
- Independent layout state and open files
- Scoped language servers (only the active workspace runs LSP)
- Workspace-specific Run Profiles for build/lint/test/deploy

Switching workspaces is instant—like changing perspectives, not opening a new app.

## Current Features

- **CodeMirror 6 Editor** with custom Deep Ocean theme
- **Syntax highlighting** for JavaScript, TypeScript, Python, Go, CSS, HTML, JSON, Markdown
- **Tab-based editing** with modified file indicators
- **File explorer** panel with workspace navigation
- **Integrated terminal** panel (UI scaffold)
- **Run profiles** panel for build/test/deploy commands (UI scaffold)
- **Status bar** with cursor position, language detection, git branch display
- **Workspace accent colors** - 7 theme variants for visual workspace differentiation

## Architecture

Built with [Wails](https://wails.io) (Go + React/Vite) using system webview for a ~15MB binary, avoiding Electron bloat.

| Component | Technology |
|-----------|------------|
| Backend | Go 1.21+ |
| Frontend | React 18 + Vite (TypeScript) |
| State | Zustand |
| Editor | CodeMirror 6 |
| Syntax | Tree-sitter (planned) |
| Language Intelligence | LSP per workspace (planned) |
| Search | ripgrep (planned) |

### Performance Targets
- Cold start: < 2-4 seconds
- Idle CPU: near 0% (no polling)
- Core RAM: ~200-450MB (without language servers)

## Development

### Prerequisites
- Go 1.21+
- Node.js 18+
- Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

### Commands
```bash
# Live development with hot reload
wails dev

# Production build
wails build

# Run frontend only (for UI development)
cd frontend && npm run dev
```

## Project Status

### Completed
- [x] Wails application scaffold
- [x] React component architecture
- [x] CodeMirror 6 integration with Deep Ocean theme
- [x] Zustand state management
- [x] CSS design system with tokens
- [x] Layout system (header, sidebar, panels, status bar)
- [x] Workspace accent color theming

### In Progress
- [ ] File system integration (Go backend)
- [ ] LSP client implementation
- [ ] Terminal emulation
- [ ] Run profile execution

### Planned
- [ ] Git integration
- [ ] Search with ripgrep
- [ ] Workspace persistence
- [ ] Settings/preferences
- [ ] Plugin system

## Contributing

This project follows a ticket-based workflow:
1. All work is tracked via GitHub Issues
2. Feature branches are created from `develop`
3. Test-driven development (TDD) is required
4. PRs are merged to `develop` after review
5. `main` branch is reserved for releases

## License

MIT

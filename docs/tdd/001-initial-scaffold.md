# Issue #1: Initial Application Scaffold

## Issue Summary

Set up the foundational Wails application with React frontend, establishing the core architecture and UI components for the IDE.

## Acceptance Criteria

- [x] Wails v2 project initialized
- [x] React + TypeScript + Vite frontend
- [x] CodeMirror 6 editor integration
- [x] Deep Ocean theme implementation
- [x] Zustand state management
- [x] Core layout components (Header, Sidebar, Editor, Terminal, StatusBar)
- [x] CSS design system with tokens

## Test Strategy

For the initial scaffold, testing was deferred to Issue #3 (Jest setup) since no test infrastructure existed yet. The scaffold was verified through:

1. **Build verification** - `wails build` succeeds
2. **Runtime verification** - Application launches without errors
3. **Visual verification** - UI renders correctly with all components
4. **State verification** - Zustand store initializes properly

## Implementation Notes

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Wails v2 over Electron | ~15MB binary vs ~150MB+, native webview, Go backend |
| CodeMirror 6 over Monaco | Lighter weight, better mobile support, modular architecture |
| Zustand over Redux | Simpler API, less boilerplate, TypeScript-first |
| CSS Modules + Tokens | Scoped styles, design system consistency, no runtime overhead |

### Key Components

- **IDEShell** - Main layout container with resizable panels
- **Header** - Window controls, search, navigation
- **Sidebar** - Activity bar with panel switching
- **Editor** - CodeMirror integration with tabs
- **Terminal** - Placeholder for PTY integration
- **StatusBar** - Cursor position, diagnostics, git branch

### Theme System

Deep Ocean theme implemented via CSS custom properties in `tokens.css`, allowing:
- Consistent colors across all components
- Easy theme switching (future)
- Workspace accent color variants

## Verification

Build and runtime verified manually. Automated tests added in Issue #3.

## Related

- PR #34 (merged)
- Depends on: None
- Blocks: #2, #3, #4, #5, #6, #7

# Firn IDE Architecture

This document describes the system architecture of Firn IDE for contributors and maintainers.

## Component Overview

Firn IDE uses a hybrid architecture: a **Go backend** for system operations and a **React frontend** for the user interface, connected via the Wails framework.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Firn IDE Application                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     React Frontend (Vite)                       │ │
│  │                                                                  │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │ │
│  │  │  Header  │  │ Sidebar  │  │  Editor  │  │ Terminal │       │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │ │
│  │        │             │             │             │              │ │
│  │        └─────────────┴──────┬──────┴─────────────┘              │ │
│  │                             │                                    │ │
│  │                    ┌────────▼────────┐                          │ │
│  │                    │  Zustand Store  │                          │ │
│  │                    │   (ideStore)    │                          │ │
│  │                    └────────┬────────┘                          │ │
│  └─────────────────────────────┼────────────────────────────────────┘ │
│                                │                                      │
│  ┌─────────────────────────────▼────────────────────────────────────┐ │
│  │                    Wails Runtime Bridge                          │ │
│  │              (JavaScript ↔ Go function calls)                    │ │
│  └─────────────────────────────┬────────────────────────────────────┘ │
│                                │                                      │
│  ┌─────────────────────────────▼────────────────────────────────────┐ │
│  │                       Go Backend                                 │ │
│  │                                                                  │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │ │
│  │  │     App      │  │  FileSystem  │  │ProcessManager│          │ │
│  │  │  (app.go)    │  │ (interfaces) │  │ (interfaces) │          │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Frontend Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `IDEShell` | `components/layout/` | Main layout container with panels |
| `Header` | `components/Header/` | Logo, workspace/recent-project selector, search trigger |
| `Sidebar` | `components/Sidebar/` | Navigation icons (Explorer, Search, Git, Run) |
| `FileExplorer` | `components/FileExplorer/` | File tree navigation |
| `Editor` | `components/Editor/` | CodeMirror 6 code editor |
| `SearchPanel` | `components/Search/` | Workspace-wide ripgrep search UI |
| `Terminal` | `components/Terminal/` | Integrated terminal panel |
| `RunProfiles` | `components/RunProfiles/` | Build/run configurations |
| `RunOutput` | `components/RunOutput/` | Streaming run output views |
| `StatusBar` | `components/StatusBar/` | Git branch, cursor position, diagnostics |

### Backend Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `App` | `app.go` | Main application struct, Wails lifecycle and bindings |
| `filesystem` | `internal/filesystem/` | Directory reads, file reads/writes, metadata, encodings |
| `watcher` | `internal/watcher/` | fsnotify-based file watching with debounce |
| `workspace` | `internal/workspace/` | Workspace state persistence and recent projects |
| `runprofile` | `internal/runprofile/` | Profile detection, persistence, execution, output streaming |
| `terminal` | `internal/terminal/` | PTY session management |
| `lsp` | `internal/lsp/` | LSP client, stdio transport, registry, URI handling |
| `search` | `internal/search/` | ripgrep runner, JSON parser, cancellation, typed results |

## Data Flow

Data flows through the application in a unidirectional pattern:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   User      │     │   React     │     │   Wails     │     │     Go      │
│  Action     │────▶│  Component  │────▶│  Runtime    │────▶│   Backend   │
└─────────────┘     └──────┬──────┘     └─────────────┘     └──────┬──────┘
                          │                                        │
                          │                                        │
                   ┌──────▼──────┐                                │
                   │   Zustand   │◀────────────────────────────────┘
                   │    Store    │         (async response)
                   └──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │  UI Update  │
                   │ (re-render) │
                   └─────────────┘
```

### Example: Opening a File

1. User clicks a file in `FileExplorer`
2. Component calls `useIDEStore().openFile(fileData)`
3. Zustand store updates `openFiles` and `activeFileId`
4. `Editor` component re-renders with new file
5. `ensureEditorFileOpen` reads file content from Go via Wails when needed

### Example: Workspace Search

1. User presses Cmd+Shift+F or opens the Search sidebar
2. `useWorkspaceSearch` debounces query/options from `searchStore`
3. React calls `SearchWorkspace` through Wails
4. Go runs `rg --json` with explicit arguments and cancellation
5. Parsed file/match results are stored in `searchStore`
6. `SearchPanel` renders grouped results and opens matches through the editor navigation flow

## State Management

Firn uses **Zustand** for state management. `ideStore` owns the main IDE/session state, while focused stores such as `lspStore` and `searchStore` own feature-specific state that should not live as derived counters or duplicated data in `ideStore`.

### Store Structure

```typescript
// frontend/src/stores/ideStore.ts

interface IDEState {
  // Workspace
  workspace: WorkspaceInfo | null;
  isLoadingTree: boolean;

  // Sidebar
  activeSidebarView: 'explorer' | 'search' | 'git' | 'run';

  // Editor
  openFiles: EditorFile[];
  activeFileId: string | null;
  cursorPosition: { line: number; column: number };

  // Terminal
  activeTerminalTab: 'terminal' | 'output' | 'problems';
  terminalSessions: TerminalSession[];

  // Run profiles
  runProfiles: RunProfile[];
  runOutputs: Record<string, RunOutputState>;

  // Status
  gitBranch: string;
}
```

Diagnostics live in `lspStore` as a full URI -> diagnostics map. Error/warning/info counts are derived selector hooks, not separately maintained status fields.

### Selector Hooks

Use provided selector hooks to prevent unnecessary re-renders:

```typescript
// Good: Uses stable selector
const workspace = useWorkspace();
const activeFile = useActiveFile();

// Avoid: Creates new selector on each render
const workspace = useIDEStore(state => state.workspace);
```

### Available Selectors

| Hook | Returns |
|------|---------|
| `useWorkspace()` | Current workspace info |
| `useIsLoading()` | Loading state |
| `useSidebarView()` | Active sidebar view |
| `useOpenFiles()` | Array of open files |
| `useActiveFileId()` | ID of active file |
| `useActiveFile()` | Active file object |
| `useCursorPosition()` | Cursor line/column |
| `useTerminalTab()` | Active terminal tab |
| `useGitBranch()` | Current git branch |
| `useRunProfiles()` | Run profile list |
| `useLSPErrorCount()` | Derived LSP error count |
| `useLSPWarningCount()` | Derived LSP warning count |
| `useLSPInfoCount()` | Derived LSP info/hint count |

### Actions

```typescript
const store = useIDEStore();

// Workspace
store.setWorkspace(workspace);
store.setLoading(true);

// Sidebar
store.setSidebarView('explorer');

// Editor
store.openFile(file);
store.closeFile(fileId);
store.setActiveFile(fileId);
store.setCursorPosition({ line: 10, column: 5 });
store.setFileModified(fileId, true);

// Terminal
store.setTerminalTab('output');

// Status
store.setGitBranch('main');
```

For LSP diagnostics and workspace search state, use `lspStore` and `searchStore` actions rather than adding parallel counters or result state to `ideStore`.

## Run Profiles: Persistence and UI State

Run profiles live in per-workspace `.firn/` metadata owned by the `internal/runprofile` package. Saved profile definitions and adoption live in `.firn/run-profiles.json`; volatile run recency lives in `.firn/run-recency.json`.

### File Schema (v3)

The profiles file is versioned. **v3** adds an adoption-only `profileState` map keyed by profile ID, alongside the unchanged `profiles` array:

```jsonc
{
  "version": 3,
  "profiles": [ /* saved run profiles — unchanged from v2 */ ],
  "profileState": {
    "<profileId>": {
      "adopted": true  // working-set membership (user pulled a detected profile in)
    }
  }
}
```

`v2 → v3` migration is **additive**: a v2 file loads cleanly with an empty `profileState`, and the saved `profiles` are untouched. Older v3 files that embedded `lastRunAt` are migrated into `.firn/run-recency.json` on load.

Run recency is stored separately:

```jsonc
{
  "version": 1,
  "recency": {
    "<profileId>": 1700000000000
  }
}
```

### Snapshot Hydration Contract

`RunProfilesSnapshot{ profiles, profileState }` (defined in `internal/runprofile/project_manager.go`) is the single contract the frontend hydrates from. It is:

- Returned by `App.GetRunProfilesSnapshot()` for the initial load.
- Emitted on the `runprofiles:changed` Wails event after every state change — initial load, pin/unpin, variant change, adopt/unadopt, and a successful run.

The frontend re-validates the payload with `normalizeSnapshot` (`hooks/useRunProfiles.ts`) before storing it via `setRunProfilesSnapshot`, so `runProfiles` and `runProfileState` in `ideStore` always come from a validated snapshot rather than ad-hoc updates. Adopt/unadopt apply an optimistic local change first (`adoptProfileLocal`/`unadoptProfileLocal`) and revert it if the backend call rejects; the next snapshot reconciles the authoritative state.

### Section Model

The panel renders each profile in the **first** matching section (`utils/groupProfiles.ts`):

| Section | Membership |
|---------|------------|
| Activated (Working Set) | Detected profile that has been adopted |
| Pinned | Saved/user profiles |
| Recent | Detected, previously run, top 5 by `lastRunAt` |
| Detected | Everything else detected |

Run recency drives both the Recent ranking and the "just ran" indicator. For a compound profile, launching it records `lastRunAt` only for the launched profile — its child steps are not stamped.

## Adding New Features

Follow this guide when adding new functionality to Firn IDE.

### 1. Create the Go Backend (if needed)

Add methods to `app.go` that will be exposed to the frontend:

```go
// app.go

// ReadFile reads a file and returns its contents.
// Exposed to frontend via Wails binding.
func (a *App) ReadFile(path string) (string, error) {
    content, err := os.ReadFile(path)
    if err != nil {
        return "", err
    }
    return string(content), nil
}
```

### 2. Update Interfaces (for testability)

If the feature requires system calls, add to `interfaces.go`:

```go
// interfaces.go

type FileSystem interface {
    // ... existing methods ...

    // NewMethod does something new.
    NewMethod(param string) (Result, error)
}
```

### 3. Add Frontend State (if needed)

Extend the Zustand store in `frontend/src/stores/ideStore.ts`:

```typescript
interface IDEState {
  // ... existing state ...
  newFeatureData: NewFeatureType | null;
}

interface IDEActions {
  // ... existing actions ...
  setNewFeatureData: (data: NewFeatureType) => void;
}
```

### 4. Create React Component

Create a new component directory:

```
frontend/src/components/NewFeature/
├── NewFeature.tsx        # Component implementation
├── NewFeature.module.css # Scoped styles
└── index.ts              # Public export
```

### 5. Write Tests First (TDD)

Create failing tests before implementation:

```typescript
// frontend/src/__tests__/NewFeature.test.tsx

describe('NewFeature', () => {
  it('should render correctly', () => {
    // Test implementation
  });
});
```

```go
// newfeature_test.go

func TestNewFeature(t *testing.T) {
    // Test implementation
}
```

### 6. Document in TDD Directory

Create `docs/tdd/NNN-feature-name.md` with:
- Issue summary
- Acceptance criteria
- Test strategy
- Before/after test output

## Wails Bindings

Wails automatically exposes Go methods to the frontend JavaScript.

### How Bindings Work

1. Methods on structs listed in `main.go`'s `Bind` option are exposed
2. Wails generates TypeScript bindings during build
3. Frontend accesses via `window.go.main.StructName.MethodName()`

### Current Bindings

```go
// main.go
Bind: []interface{}{
    app,  // Exposes all public methods on *App
},
```

### Exposed Methods

| Go Method | Frontend Call | Returns |
|-----------|---------------|---------|
| `App.GetWorkspaceInfo()` | `window.go.main.App.GetWorkspaceInfo()` | `Promise<WorkspaceInfo>` |

### Adding New Bindings

1. Add a public method to `App` (or create a new struct):

```go
// app.go

// SaveFile saves content to a file path.
func (a *App) SaveFile(path string, content string) error {
    return os.WriteFile(path, []byte(content), 0644)
}
```

2. Rebuild the application (`wails build` or `wails dev`)

3. Wails generates bindings in `frontend/wailsjs/go/main/`:

```typescript
// Auto-generated
export function SaveFile(path: string, content: string): Promise<void>;
```

4. Import and use in React:

```typescript
import { SaveFile } from '../../wailsjs/go/main/App';

async function handleSave() {
    await SaveFile('/path/to/file', editorContent);
}
```

### Binding Conventions

- **Method names**: PascalCase (Go convention)
- **Return values**: Automatically converted to JavaScript equivalents
- **Errors**: Returned as rejected promises
- **Structs**: Converted to plain JavaScript objects

### Type Mapping

| Go Type | TypeScript Type |
|---------|-----------------|
| `string` | `string` |
| `int`, `int64` | `number` |
| `bool` | `boolean` |
| `[]byte` | `string` (base64) |
| `struct` | `interface` |
| `error` | `Promise rejection` |

## Project Structure

```
firn-ide/
├── main.go                 # Application entry point
├── app.go                  # App struct and business logic
├── interfaces.go           # Testable interfaces
├── *_test.go              # Go tests
├── frontend/
│   ├── src/
│   │   ├── App.tsx        # Root React component
│   │   ├── main.tsx       # React entry point
│   │   ├── components/    # React components
│   │   ├── stores/        # Zustand stores
│   │   ├── styles/        # Global CSS (tokens, reset)
│   │   ├── utils/         # Utility functions
│   │   └── __tests__/     # Jest tests
│   ├── wailsjs/           # Auto-generated Wails bindings
│   └── package.json
├── build/                  # Build output
├── docs/
│   ├── architecture.md    # This file
│   └── tdd/               # TDD documentation per issue
└── .github/workflows/     # CI/CD configuration
```

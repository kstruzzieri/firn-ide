# Flux IDE Architecture

This document describes the system architecture of Flux IDE for contributors and maintainers.

## Component Overview

Flux IDE uses a hybrid architecture: a **Go backend** for system operations and a **React frontend** for the user interface, connected via the Wails framework.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Flux IDE Application                         │
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
| `Header` | `components/Header/` | Logo, workspace selector, search |
| `Sidebar` | `components/Sidebar/` | Navigation icons (Explorer, Search, Git, Run) |
| `FileExplorer` | `components/FileExplorer/` | File tree navigation |
| `Editor` | `components/Editor/` | CodeMirror 6 code editor |
| `Terminal` | `components/Terminal/` | Integrated terminal panel |
| `RunProfiles` | `components/RunProfiles/` | Build/run configurations |
| `StatusBar` | `components/StatusBar/` | Git branch, cursor position, diagnostics |

### Backend Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `App` | `app.go` | Main application struct, Wails lifecycle |
| `FileSystem` | `interfaces.go` | File operations interface (mockable) |
| `ProcessManager` | `interfaces.go` | Process management interface (mockable) |

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
5. (Future) Wails binding reads file content from Go backend

### Example: Getting Workspace Info

1. Application starts
2. React calls `window.go.main.App.GetWorkspaceInfo()`
3. Wails runtime invokes Go method
4. Go backend returns `WorkspaceInfo` struct
5. React receives JavaScript object with `name` and `path`

## State Management

Flux uses **Zustand** for state management with a single store pattern.

### Store Structure

```typescript
// frontend/src/stores/ideStore.ts

interface IDEState {
  // Workspace
  workspace: WorkspaceInfo | null;
  isLoading: boolean;

  // Sidebar
  activeSidebarView: 'explorer' | 'search' | 'git' | 'run';

  // Editor
  openFiles: EditorFile[];
  activeFileId: string | null;
  cursorPosition: { line: number; column: number };

  // Terminal
  activeTerminalTab: 'terminal' | 'output' | 'problems';
  workingDirectory: string;

  // Status
  gitBranch: string;
  errorCount: number;
  warningCount: number;
}
```

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
| `useErrorCount()` | Number of errors |
| `useWarningCount()` | Number of warnings |

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
store.setWorkingDirectory('/path/to/dir');

// Status
store.setGitBranch('main');
store.setDiagnostics(2, 5);
```

## Adding New Features

Follow this guide when adding new functionality to Flux IDE.

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
flux-ide/
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
│   ├── ARCHITECTURE.md    # This file
│   └── tdd/               # TDD documentation per issue
└── .github/workflows/     # CI/CD configuration
```

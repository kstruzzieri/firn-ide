# Issue #7: JetBrains-style Autosave — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Files save automatically on idle, focus loss, tab switch, and Cmd+S — no manual save required.

**Architecture:** Content flows from CodeMirror → Zustand store → debounced WriteFile calls. A single `useAutosave` hook mounted in App.tsx manages all save triggers (idle timer, focus loss, tab switch, Cmd+S). A minimal Toast component shows save errors.

**Tech Stack:** React 18, Zustand, Wails WriteFile binding, CodeMirror 6

---

## Key Files Reference

- Store: `frontend/src/stores/ideStore.ts` — central Zustand state (255 lines)
- Editor: `frontend/src/components/Editor/Editor.tsx` — tab bar + CodeMirror wrapper
- CodeMirror: `frontend/src/components/Editor/CodeMirrorEditor.tsx` — CM6 wrapper
- File open: `frontend/src/components/FileExplorer/FileExplorer.tsx:150-170` — where files get opened
- App entry: `frontend/src/App.tsx` — renders IDEShell with all panels
- Wails WriteFile: `frontend/wailsjs/go/main/App.d.ts:24` — `WriteFile(path, content, encoding, lineEndings, createBackup): Promise<void>`
- Wails FileContent model: `frontend/wailsjs/go/models.ts:3-22` — already has `lineEndings` field
- Jest config: `frontend/jest.config.cjs`
- Test mocks pattern: `frontend/src/__tests__/App.test.tsx:12-18` — Wails mock pattern

---

## Task 1: Add `lineEndings` to EditorFile and store

**Files:**
- Modify: `frontend/src/stores/ideStore.ts:17-25` (EditorFile interface)
- Modify: `frontend/src/stores/ideStore.ts:86-98` (IDEActions — add updateFileContent)
- Test: `frontend/src/__tests__/stores/ideStore.test.ts` (create)

### Step 1: Write the failing test

Create `frontend/src/__tests__/stores/ideStore.test.ts`:

```typescript
import { useIDEStore } from '../../stores/ideStore';

// Reset store between tests
beforeEach(() => {
  useIDEStore.setState({
    openFiles: [],
    activeFileId: null,
    toast: null,
  });
});

describe('ideStore - editor actions', () => {
  it('should add lineEndings to opened files', () => {
    const { openFile } = useIDEStore.getState();
    openFile({
      id: '/test/file.ts',
      name: 'file.ts',
      path: '/test/file.ts',
      language: 'typescript',
      encoding: 'utf-8',
      lineEndings: 'LF',
      content: 'const x = 1;',
      isModified: false,
    });

    const file = useIDEStore.getState().openFiles[0];
    expect(file.lineEndings).toBe('LF');
  });

  it('should update file content and mark as modified', () => {
    const { openFile, updateFileContent } = useIDEStore.getState();
    openFile({
      id: '/test/file.ts',
      name: 'file.ts',
      path: '/test/file.ts',
      language: 'typescript',
      encoding: 'utf-8',
      lineEndings: 'LF',
      content: 'const x = 1;',
      isModified: false,
    });

    updateFileContent('/test/file.ts', 'const x = 2;');

    const file = useIDEStore.getState().openFiles[0];
    expect(file.content).toBe('const x = 2;');
    expect(file.isModified).toBe(true);
  });

  it('should not mark unmodified file when content is same', () => {
    const { openFile, updateFileContent } = useIDEStore.getState();
    openFile({
      id: '/test/file.ts',
      name: 'file.ts',
      path: '/test/file.ts',
      language: 'typescript',
      encoding: 'utf-8',
      lineEndings: 'LF',
      content: 'const x = 1;',
      isModified: false,
    });

    updateFileContent('/test/file.ts', 'const x = 1;');

    const file = useIDEStore.getState().openFiles[0];
    expect(file.isModified).toBe(false);
  });
});

describe('ideStore - toast', () => {
  it('should show and clear toast', () => {
    const { showToast } = useIDEStore.getState();
    showToast('Save failed', 'error');

    expect(useIDEStore.getState().toast).toEqual({
      message: 'Save failed',
      type: 'error',
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && npx jest __tests__/stores/ideStore.test.ts --no-coverage`
Expected: FAIL — `updateFileContent` and `showToast` not found, `lineEndings` not in type

### Step 3: Implement store changes

Modify `frontend/src/stores/ideStore.ts`:

**a) Add `lineEndings` to `EditorFile` (line ~24):**
```typescript
export interface EditorFile {
  id: string;
  name: string;
  path: string;
  language: string;
  encoding: string;
  lineEndings: string;  // ADD THIS
  content: string;
  isModified: boolean;
}
```

**b) Add toast state to `IDEState` (after line ~63):**
```typescript
  // Toast
  toast: { message: string; type: 'error' | 'info' } | null;
```

**c) Add new actions to `IDEActions` (after line ~90):**
```typescript
  updateFileContent: (fileId: string, content: string) => void;
  showToast: (message: string, type: 'error' | 'info') => void;
  clearToast: () => void;
```

**d) Add initial state (in the create block):**
```typescript
      toast: null,
```

**e) Add action implementations (after `setFileModified`):**
```typescript
      updateFileContent: (fileId, content) =>
        set(
          (state) => ({
            openFiles: state.openFiles.map((f) => {
              if (f.id !== fileId) return f;
              if (f.content === content) return f;
              return { ...f, content, isModified: true };
            }),
          }),
          false,
          'updateFileContent'
        ),

      showToast: (message, type) => set({ toast: { message, type } }, false, 'showToast'),

      clearToast: () => set({ toast: null }, false, 'clearToast'),
```

**f) Add selector hooks at bottom:**
```typescript
export const useToast = () => useIDEStore((state) => state.toast);
```

### Step 4: Run test to verify it passes

Run: `cd frontend && npx jest __tests__/stores/ideStore.test.ts --no-coverage`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/stores/ideStore.ts frontend/src/__tests__/stores/ideStore.test.ts
git commit -m "feat(store): add updateFileContent, lineEndings, and toast state

Part of Issue #7: JetBrains-style autosave"
```

---

## Task 2: Wire `lineEndings` through file open path

**Files:**
- Modify: `frontend/src/components/FileExplorer/FileExplorer.tsx:155-164`

### Step 1: Add `lineEndings` to the `openFile` call

In `FileExplorer.tsx`, the `handleOpen` callback (line ~155) currently opens files without `lineEndings`. Add it:

```typescript
      try {
        const content = await ReadFile(entry.path);
        openFile({
          id: entry.path,
          name: entry.name,
          path: entry.path,
          language: getLanguageFromPath(entry.path),
          encoding: content.encoding,
          lineEndings: content.lineEndings,  // ADD THIS
          content: content.content,
          isModified: false,
        });
```

### Step 2: Verify existing tests still pass

Run: `cd frontend && npx jest --no-coverage`
Expected: All existing tests PASS (may need to update FileExplorer test mock if it creates EditorFile objects)

### Step 3: Commit

```bash
git add frontend/src/components/FileExplorer/FileExplorer.tsx
git commit -m "feat(explorer): pass lineEndings from ReadFile to EditorFile

Part of Issue #7: JetBrains-style autosave"
```

---

## Task 3: Wire Editor content changes to store

**Files:**
- Modify: `frontend/src/components/Editor/Editor.tsx:26-32`

### Step 1: Update `handleContentChange` to store content

Currently `Editor.tsx:27` discards the content parameter (`_content`). Update to use `updateFileContent`:

```typescript
  const updateFileContent = useIDEStore((state) => state.updateFileContent);

  // Handle content changes from the editor
  const handleContentChange = useCallback(
    (fileId: string, content: string) => {
      updateFileContent(fileId, content);
    },
    [updateFileContent]
  );
```

Remove the `setFileModified` selector import if no longer used elsewhere in this file (it's still used by the store internally, just not needed in Editor.tsx directly).

### Step 2: Verify existing tests still pass

Run: `cd frontend && npx jest --no-coverage`
Expected: PASS

### Step 3: Commit

```bash
git add frontend/src/components/Editor/Editor.tsx
git commit -m "feat(editor): wire content changes to updateFileContent

Part of Issue #7: JetBrains-style autosave"
```

---

## Task 4: Create the Toast component

**Files:**
- Create: `frontend/src/components/Toast/Toast.tsx`
- Create: `frontend/src/components/Toast/Toast.module.css`
- Create: `frontend/src/components/Toast/index.ts`
- Test: `frontend/src/__tests__/components/Toast/Toast.test.tsx`

### Step 1: Write the failing test

Create `frontend/src/__tests__/components/Toast/Toast.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { Toast } from '../../../components/Toast';
import { useIDEStore } from '../../../stores/ideStore';

// Mock the store
jest.mock('../../../stores/ideStore', () => {
  const actual = jest.requireActual('../../../stores/ideStore');
  return {
    ...actual,
    useToast: jest.fn(),
    useIDEStore: Object.assign(jest.fn(), {
      getState: jest.fn(() => ({ clearToast: jest.fn() })),
    }),
  };
});

import { useToast } from '../../../stores/ideStore';

describe('Toast', () => {
  it('should render nothing when no toast', () => {
    (useToast as jest.Mock).mockReturnValue(null);
    const { container } = render(<Toast />);
    expect(container.firstChild).toBeNull();
  });

  it('should render error toast message', () => {
    (useToast as jest.Mock).mockReturnValue({
      message: 'Failed to save file.ts',
      type: 'error',
    });
    render(<Toast />);
    expect(screen.getByText('Failed to save file.ts')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('should render info toast message', () => {
    (useToast as jest.Mock).mockReturnValue({
      message: 'File saved',
      type: 'info',
    });
    render(<Toast />);
    expect(screen.getByText('File saved')).toBeInTheDocument();
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && npx jest __tests__/components/Toast --no-coverage`
Expected: FAIL — module not found

### Step 3: Implement Toast component

Create `frontend/src/components/Toast/Toast.tsx`:

```tsx
import { useEffect } from 'react';
import { useToast, useIDEStore } from '../../stores/ideStore';
import styles from './Toast.module.css';

const TOAST_DURATION = 4000;

export function Toast() {
  const toast = useToast();
  const clearToast = useIDEStore((state) => state.clearToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(clearToast, TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  if (!toast) return null;

  return (
    <div
      className={`${styles.toast} ${styles[toast.type]}`}
      role="alert"
      aria-live="assertive"
    >
      <span className={styles.message}>{toast.message}</span>
      <button
        className={styles.close}
        onClick={clearToast}
        aria-label="Dismiss"
        type="button"
      >
        ×
      </button>
    </div>
  );
}
```

Create `frontend/src/components/Toast/Toast.module.css`:

```css
.toast {
  position: fixed;
  bottom: 40px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 500;
  animation: slideIn 200ms ease-out;
  max-width: 400px;
}

.error {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #ef4444;
}

.info {
  background: rgba(6, 182, 212, 0.15);
  border: 1px solid rgba(6, 182, 212, 0.4);
  color: #22d3ee;
}

.message {
  flex: 1;
}

.close {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  font-size: 18px;
  padding: 0 4px;
  line-height: 1;
}

.close:hover {
  opacity: 1;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

Create `frontend/src/components/Toast/index.ts`:

```typescript
export { Toast } from './Toast';
```

### Step 4: Run test to verify it passes

Run: `cd frontend && npx jest __tests__/components/Toast --no-coverage`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/components/Toast/
git add frontend/src/__tests__/components/Toast/
git commit -m "feat(toast): add minimal Toast notification component

Part of Issue #7: JetBrains-style autosave"
```

---

## Task 5: Create the `useAutosave` hook

**Files:**
- Create: `frontend/src/hooks/useAutosave.ts`
- Test: `frontend/src/__tests__/hooks/useAutosave.test.ts`

### Step 1: Write the failing test

Create `frontend/src/__tests__/hooks/useAutosave.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';

// Mock Wails WriteFile
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../wailsjs/go/main/App', () => ({
  WriteFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// Import after mocks
import { useAutosave } from '../../hooks/useAutosave';

beforeEach(() => {
  jest.useFakeTimers();
  mockWriteFile.mockClear();
  useIDEStore.setState({
    openFiles: [],
    activeFileId: null,
    toast: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function openTestFile(overrides = {}) {
  useIDEStore.getState().openFile({
    id: '/test/file.ts',
    name: 'file.ts',
    path: '/test/file.ts',
    language: 'typescript',
    encoding: 'utf-8',
    lineEndings: 'LF',
    content: 'original',
    isModified: false,
    ...overrides,
  });
  useIDEStore.setState({ activeFileId: '/test/file.ts' });
}

describe('useAutosave', () => {
  it('should save file after idle timeout', async () => {
    openTestFile();
    renderHook(() => useAutosave());

    // Simulate content change
    act(() => {
      useIDEStore.getState().updateFileContent('/test/file.ts', 'modified');
    });

    // Advance past debounce
    act(() => {
      jest.advanceTimersByTime(1600);
    });

    // Wait for async WriteFile
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/file.ts',
      'modified',
      'utf-8',
      'LF',
      false
    );
  });

  it('should clear modified flag after successful save', async () => {
    openTestFile();
    renderHook(() => useAutosave());

    act(() => {
      useIDEStore.getState().updateFileContent('/test/file.ts', 'modified');
    });

    act(() => {
      jest.advanceTimersByTime(1600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const file = useIDEStore.getState().openFiles[0];
    expect(file.isModified).toBe(false);
  });

  it('should show toast on save failure', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('Permission denied'));
    openTestFile();
    renderHook(() => useAutosave());

    act(() => {
      useIDEStore.getState().updateFileContent('/test/file.ts', 'modified');
    });

    act(() => {
      jest.advanceTimersByTime(1600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const toast = useIDEStore.getState().toast;
    expect(toast).not.toBeNull();
    expect(toast?.type).toBe('error');
  });

  it('should not save unmodified files', () => {
    openTestFile();
    renderHook(() => useAutosave());

    // No content change, just advance time
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && npx jest __tests__/hooks/useAutosave --no-coverage`
Expected: FAIL — module not found

### Step 3: Implement the hook

Create `frontend/src/hooks/useAutosave.ts`:

```typescript
import { useEffect, useRef, useCallback } from 'react';
import { useIDEStore } from '../stores/ideStore';
import { WriteFile } from '../../wailsjs/go/main/App';
import { isMac } from '../utils/platform';

const AUTOSAVE_DELAY = 1500;

export function useAutosave() {
  const debounceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const savingFiles = useRef(new Set<string>());

  // Save a single file by ID
  const saveFile = useCallback(async (fileId: string) => {
    // Prevent double-saves
    if (savingFiles.current.has(fileId)) return;

    const file = useIDEStore.getState().openFiles.find((f) => f.id === fileId);
    if (!file || !file.isModified) return;

    savingFiles.current.add(fileId);

    try {
      await WriteFile(file.path, file.content, file.encoding, file.lineEndings, false);
      useIDEStore.getState().setFileModified(fileId, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      useIDEStore.getState().showToast(`Failed to save ${file.name}: ${message}`, 'error');
    } finally {
      savingFiles.current.delete(fileId);
    }
  }, []);

  // Save all modified files
  const saveAllModified = useCallback(() => {
    const { openFiles } = useIDEStore.getState();
    openFiles.forEach((file) => {
      if (file.isModified) {
        saveFile(file.id);
      }
    });
  }, [saveFile]);

  // Schedule debounced save for a file
  const scheduleSave = useCallback(
    (fileId: string) => {
      // Clear existing timer for this file
      const existing = debounceTimers.current.get(fileId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        debounceTimers.current.delete(fileId);
        saveFile(fileId);
      }, AUTOSAVE_DELAY);

      debounceTimers.current.set(fileId, timer);
    },
    [saveFile]
  );

  // Watch for content changes (isModified transitions to true)
  useEffect(() => {
    return useIDEStore.subscribe((state, prevState) => {
      state.openFiles.forEach((file) => {
        const prevFile = prevState.openFiles.find((f) => f.id === file.id);
        if (file.isModified && (!prevFile || !prevFile.isModified)) {
          scheduleSave(file.id);
        }
      });
    });
  }, [scheduleSave]);

  // Save outgoing tab on tab switch
  useEffect(() => {
    let prevActiveFileId = useIDEStore.getState().activeFileId;

    return useIDEStore.subscribe((state) => {
      if (state.activeFileId !== prevActiveFileId) {
        if (prevActiveFileId) {
          // Cancel debounce and save immediately
          const timer = debounceTimers.current.get(prevActiveFileId);
          if (timer) {
            clearTimeout(timer);
            debounceTimers.current.delete(prevActiveFileId);
          }
          saveFile(prevActiveFileId);
        }
        prevActiveFileId = state.activeFileId;
      }
    });
  }, [saveFile]);

  // Save on focus loss (visibility change + window blur)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveAllModified();
      }
    };

    const handleBlur = () => {
      saveAllModified();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [saveAllModified]);

  // Cmd+S / Ctrl+S handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = isMac() ? e.metaKey : e.ctrlKey;
      if (modifier && e.key === 's') {
        e.preventDefault();
        const { activeFileId } = useIDEStore.getState();
        if (activeFileId) {
          // Cancel debounce and save immediately
          const timer = debounceTimers.current.get(activeFileId);
          if (timer) {
            clearTimeout(timer);
            debounceTimers.current.delete(activeFileId);
          }
          saveFile(activeFileId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveFile]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      debounceTimers.current.forEach((timer) => clearTimeout(timer));
      debounceTimers.current.clear();
    };
  }, []);
}
```

### Step 4: Run test to verify it passes

Run: `cd frontend && npx jest __tests__/hooks/useAutosave --no-coverage`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/hooks/useAutosave.ts
git add frontend/src/__tests__/hooks/useAutosave.test.ts
git commit -m "feat(autosave): add useAutosave hook with debounce, focus, tab, Cmd+S triggers

Part of Issue #7: JetBrains-style autosave"
```

---

## Task 6: Mount hook and Toast in App

**Files:**
- Modify: `frontend/src/App.tsx`

### Step 1: Add useAutosave and Toast to App

```tsx
import './styles/tokens.css';
import './styles/reset.css';
import { IDEShell } from './components/layout';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { FileExplorer } from './components/FileExplorer';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';
import { RunProfiles } from './components/RunProfiles';
import { StatusBar } from './components/StatusBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toast } from './components/Toast';
import { useAutosave } from './hooks/useAutosave';

function App() {
  useAutosave();

  return (
    <ErrorBoundary>
      <IDEShell
        accent="project"
        header={<Header />}
        sidebar={<Sidebar />}
        leftPanel={<FileExplorer />}
        centerPanel={<Editor />}
        bottomPanel={<Terminal />}
        rightPanel={<RunProfiles />}
        statusBar={<StatusBar />}
      />
      <Toast />
    </ErrorBoundary>
  );
}

export default App;
```

### Step 2: Run all tests

Run: `cd frontend && npx jest --no-coverage`
Expected: All tests PASS. The App.test.tsx mock already includes WriteFile.

### Step 3: Commit

```bash
git add frontend/src/App.tsx
git commit -m "feat(app): mount useAutosave hook and Toast component

Completes Issue #7: JetBrains-style autosave"
```

---

## Task 7: Run full test suite and verify

### Step 1: Run all frontend tests

Run: `cd frontend && npx jest --no-coverage`
Expected: All tests PASS

### Step 2: Run Go tests

Run: `go test ./...`
Expected: All tests PASS (no Go changes needed)

### Step 3: Build verification

Run: `cd frontend && npx tsc --noEmit`
Expected: No TypeScript errors

### Step 4: Lint check

Run: `cd frontend && npx eslint src/ --ext .ts,.tsx`
Expected: No lint errors (or only pre-existing ones)

### Step 5: Final commit if any fixes needed

If any test/lint fixes were required, commit them:
```bash
git add -A
git commit -m "fix: resolve test/lint issues from autosave implementation"
```

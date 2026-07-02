# Issue #11: File Explorer - Display Directory Tree

## Issue Summary

Connect file explorer UI to backend directory reading. Display an interactive folder/file tree with expand/collapse, file type icons, and click-to-open functionality.

## Acceptance Criteria

- [x] Display folder/file tree from backend data
- [x] Expand/collapse folders
- [x] File type icons based on extension
- [x] Loading states and error handling
- [x] Click to open file in editor
- [x] Integration tests

## TDD: Before (Failing Tests)

### Criterion 1: Display folder/file tree from backend data

**Rationale:** The core purpose of the file explorer is to render directory data from the backend. This test verifies that `FileEntry` objects returned by `ReadDirectory` appear as visible tree items.

**Test Code:**
```typescript
it('renders top-level entries', () => {
  useIDEStore.setState({ directoryTree: mockDirectoryTree });
  render(<FileExplorer />);
  expect(screen.getByText('src')).toBeInTheDocument();
  expect(screen.getByText('package.json')).toBeInTheDocument();
});
```

**Failing Output:**
```
FAIL src/__tests__/components/FileExplorer/FileExplorer.test.tsx
  ● FileExplorer › tree rendering › renders top-level entries

    TypeError: Cannot read properties of undefined (reading 'directoryTree')
```

---

### Criterion 2: Expand/collapse folders

**Rationale:** Users need to navigate nested directory structures. These tests verify the TreeNode component toggles visibility of children and responds to click interactions on the expand/collapse chevron.

**Test Code:**
```typescript
it('calls onToggle when folder chevron is clicked', () => {
  const onToggle = jest.fn();
  render(<TreeNode {...defaultProps} entry={mockFolder} onToggle={onToggle} />);

  fireEvent.click(screen.getByRole('button', { name: /toggle/i }));
  expect(onToggle).toHaveBeenCalledWith('/workspace/src');
});

it('renders children when folder is expanded', () => {
  render(<TreeNode {...defaultProps} entry={mockFolder} isExpanded={true} />);
  expect(screen.getByText('index.ts')).toBeInTheDocument();
});

it('does not render children when folder is collapsed', () => {
  render(<TreeNode {...defaultProps} entry={mockFolder} isExpanded={false} />);
  expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
});
```

**Failing Output:**
```
FAIL src/__tests__/components/FileExplorer/TreeNode.test.tsx
  ● Test suite failed to run

    Cannot find module '../../../components/FileExplorer/TreeNode'
```

---

### Criterion 3: File type icons based on extension

**Rationale:** Visual differentiation helps users quickly identify file types. These tests verify the FileIcon component maps extensions to the correct icon types and colors per the design spec.

**Test Code:**
```typescript
it('renders typescript icon for .ts files', () => {
  render(<FileIcon name="index.ts" isDir={false} />);
  expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'typescript');
});

it('renders folder icon for directories', () => {
  render(<FileIcon name="src" isDir={true} />);
  expect(screen.getByTestId('folder-icon')).toBeInTheDocument();
});

it('returns correct color for typescript', () => {
  expect(getFileIconColor('typescript')).toBe('#3178C6');
});
```

**Failing Output:**
```
FAIL src/__tests__/components/FileExplorer/FileIcon.test.tsx
  ● Test suite failed to run

    Cannot find module '../../../components/FileExplorer/FileIcon'
```

---

### Criterion 4: Loading states and error handling

**Rationale:** Directory reading is async and can fail. These tests verify the UI communicates loading progress, displays errors clearly, and offers recovery options (retry button).

**Test Code:**
```typescript
it('shows loading skeleton when isLoadingTree is true', () => {
  useIDEStore.setState({ isLoadingTree: true });
  render(<FileExplorer />);
  expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
});

it('shows error message when treeError is set', () => {
  useIDEStore.setState({ treeError: 'Failed to read directory' });
  render(<FileExplorer />);
  expect(screen.getByText(/failed to read directory/i)).toBeInTheDocument();
});

it('shows retry button on error', () => {
  useIDEStore.setState({ treeError: 'Failed to read directory' });
  render(<FileExplorer />);
  expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
});
```

**Failing Output:**
```
FAIL src/__tests__/components/FileExplorer/FileExplorer.test.tsx
  ● FileExplorer › loading states › shows loading skeleton when isLoadingTree is true

    TestingLibraryElementError: Unable to find an accessible element with the role "status"
    and name `/loading/i`

  ● FileExplorer › error handling › shows error message when treeError is set

    TypeError: Cannot read properties of undefined (reading 'treeError')
```

---

### Criterion 5: Click to open file in editor

**Rationale:** The primary user action is opening files for editing. These tests verify clicking a file triggers the selection callback and updates the editor state.

**Test Code:**
```typescript
it('calls onSelect when file is clicked', () => {
  const onSelect = jest.fn();
  render(<TreeNode {...defaultProps} onSelect={onSelect} />);

  fireEvent.click(screen.getByText('test.ts'));
  expect(onSelect).toHaveBeenCalledWith(mockFile);
});

it('selects file when clicked', async () => {
  render(<FileExplorer />);
  fireEvent.click(screen.getByText('App.tsx'));

  await waitFor(() => {
    const state = useIDEStore.getState();
    expect(state.activeFileId).toBeDefined();
  });
});
```

**Failing Output:**
```
FAIL src/__tests__/components/FileExplorer/TreeNode.test.tsx
  ● Test suite failed to run

    Cannot find module '../../../components/FileExplorer/TreeNode'

FAIL src/__tests__/components/FileExplorer/FileExplorer.test.tsx
  ● FileExplorer › interactions › selects file when clicked

    TypeError: Cannot read properties of undefined (reading 'openFiles')
```

---

### Criterion 6: Integration tests

**Rationale:** The full data flow must work end-to-end: workspace change → API call → store update → UI render. These tests verify the Wails binding is called correctly and state synchronizes properly.

**Test Code:**
```typescript
it('fetches directory tree when workspace changes', async () => {
  (ReadDirectory as jest.Mock).mockResolvedValue(mockDirectoryTree);
  render(<FileExplorer />);

  await waitFor(() => {
    expect(ReadDirectory).toHaveBeenCalledWith('/workspace');
  });
});

it('updates store with fetched data', async () => {
  (ReadDirectory as jest.Mock).mockResolvedValue(mockDirectoryTree);
  render(<FileExplorer />);

  await waitFor(() => {
    const state = useIDEStore.getState();
    expect(state.directoryTree).toEqual(mockDirectoryTree);
  });
});

it('sets error state on fetch failure', async () => {
  (ReadDirectory as jest.Mock).mockRejectedValue(new Error('Network error'));
  render(<FileExplorer />);

  await waitFor(() => {
    const state = useIDEStore.getState();
    expect(state.treeError).toBeTruthy();
  });
});
```

**Failing Output:**
```
FAIL src/__tests__/components/FileExplorer/FileExplorer.test.tsx
  ● FileExplorer › data fetching › fetches directory tree when workspace changes

    expect(ReadDirectory).toHaveBeenCalledWith('/workspace')

    Expected: "/workspace"
    Received: (function was not called)
```

---

## Test Summary

```
$ npm test -- --testPathPatterns="FileExplorer"

Test Suites: 3 failed, 3 total
Tests:       0 passed, 0 total
```

## TDD: After (Passing Tests)

All tests now pass:

```
$ npm test -- --testPathPatterns="FileExplorer"

PASS src/__tests__/components/FileExplorer/FileIcon.test.tsx
PASS src/__tests__/components/FileExplorer/TreeNode.test.tsx
PASS src/__tests__/components/FileExplorer/FileExplorer.test.tsx

Test Suites: 3 passed, 3 total
Tests:       46 passed, 46 total
```

### Implementation Summary

**Files Created:**
- `src/components/FileExplorer/FileIcon.tsx` - Icon component with extension-to-type mapping and color theming
- `src/components/FileExplorer/TreeNode.tsx` - Recursive tree item component with expand/collapse
- `src/components/FileExplorer/TreeNode.module.css` - Styles for tree nodes
- `src/components/FileExplorer/useDirectoryTree.ts` - Hook for fetching directory data on workspace change

**Files Modified:**
- `src/stores/ideStore.ts` - Added directory tree state (directoryTree, expandedPaths, isLoadingTree, treeError)
- `src/components/FileExplorer/FileExplorer.tsx` - Rewrote to integrate all components
- `src/components/FileExplorer/FileExplorer.module.css` - Added error state styles
- `src/components/FileExplorer/index.ts` - Updated exports
- `src/components/icons/index.tsx` - Added ChevronRightIcon

## Related

- PR: TBD
- Depends on: #7 (ReadDirectory backend), #8 (ReadFile backend)
- Blocks: #12 (Editor - Open Files from Explorer)
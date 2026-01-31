# Issue #7: File System - Read Directory Tree

## Issue Summary

Implement Go backend function to read and return directory tree structure for the file explorer.

## Acceptance Criteria

- [ ] `ReadDirectory(path string)` returns nested file/folder structure
- [ ] Respects `.gitignore` patterns
- [ ] Returns file metadata (size, modified date, type)
- [ ] Handles permission errors gracefully
- [ ] Unit tests with mock filesystem

## Test Strategy

The file system reader is tested using:
1. **Mock filesystem** - Uses the `FileSystem` interface from `interfaces.go` for testability
2. **Unit tests** - Test each acceptance criterion in isolation
3. **Error handling tests** - Verify graceful handling of edge cases

## Test Cases

| Test | Rationale |
|------|-----------|
| `TestReadDirectory_ReturnsEntries` | Proves basic directory reading works |
| `TestReadDirectory_IncludesMetadata` | Proves file metadata (size, modTime, isDir) is returned |
| `TestReadDirectory_NestedStructure` | Proves recursive directory traversal works |
| `TestReadDirectory_RespectsGitignore` | Proves .gitignore patterns are honored |
| `TestReadDirectory_HandlesPermissionError` | Proves permission errors don't crash, return partial results |
| `TestReadDirectory_InvalidPath` | Proves invalid paths return appropriate error |
| `TestReadDirectory_EmptyDirectory` | Proves empty directories return empty slice |

## TDD: Before (Failing Tests)

```
=== RUN   TestReadDirectory_ReturnsEntries
    filesystem_test.go:69: Expected 3 entries, got 0
--- FAIL: TestReadDirectory_ReturnsEntries (0.00s)
=== RUN   TestReadDirectory_IncludesMetadata
    filesystem_test.go:107: Expected 1 entry, got 0
--- FAIL: TestReadDirectory_IncludesMetadata (0.00s)
=== RUN   TestReadDirectory_NestedStructure
    filesystem_test.go:156: Expected 1 entry, got 0
--- FAIL: TestReadDirectory_NestedStructure (0.00s)
=== RUN   TestReadDirectory_RespectsGitignore
    filesystem_test.go:206: Expected 2 entries (gitignore + keep.txt), got 0
--- FAIL: TestReadDirectory_RespectsGitignore (0.00s)
=== RUN   TestReadDirectory_HandlesPermissionError
    filesystem_test.go:261: Expected 2 entries, got 0
--- FAIL: TestReadDirectory_HandlesPermissionError (0.00s)
=== RUN   TestReadDirectory_InvalidPath
    filesystem_test.go:286: Expected error for invalid path
--- FAIL: TestReadDirectory_InvalidPath (0.00s)
=== RUN   TestReadDirectory_EmptyDirectory
    filesystem_test.go:304: Expected empty slice, got nil
--- FAIL: TestReadDirectory_EmptyDirectory (0.00s)
FAIL
exit status 1
FAIL    flux    0.012s
```

## Implementation Notes

### Data Structures

```go
// FileEntry represents a file or directory in the tree
type FileEntry struct {
    Name     string      `json:"name"`
    Path     string      `json:"path"`
    IsDir    bool        `json:"isDir"`
    Size     int64       `json:"size"`
    ModTime  time.Time   `json:"modTime"`
    Children []FileEntry `json:"children,omitempty"`
}
```

### Gitignore Handling

Use `github.com/go-git/go-git/v5/plumbing/format/gitignore` or similar library to parse `.gitignore` patterns. Walk up the directory tree to find all applicable `.gitignore` files.

### Error Handling Strategy

- Invalid path: Return error
- Permission denied on root: Return error
- Permission denied on subdirectory: Skip subdirectory, continue with rest
- Empty directory: Return empty `Children` slice

## TDD: After (Passing Tests)

```
=== RUN   TestReadDirectory_ReturnsEntries
--- PASS: TestReadDirectory_ReturnsEntries (0.00s)
=== RUN   TestReadDirectory_IncludesMetadata
--- PASS: TestReadDirectory_IncludesMetadata (0.00s)
=== RUN   TestReadDirectory_NestedStructure
--- PASS: TestReadDirectory_NestedStructure (0.00s)
=== RUN   TestReadDirectory_RespectsGitignore
--- PASS: TestReadDirectory_RespectsGitignore (0.00s)
=== RUN   TestReadDirectory_HandlesPermissionError
--- PASS: TestReadDirectory_HandlesPermissionError (0.00s)
=== RUN   TestReadDirectory_InvalidPath
--- PASS: TestReadDirectory_InvalidPath (0.00s)
=== RUN   TestReadDirectory_EmptyDirectory
--- PASS: TestReadDirectory_EmptyDirectory (0.00s)
PASS
ok      flux    0.023s
```

## Verification

All acceptance criteria met:
- [x] `ReadDirectory(path string)` returns nested file/folder structure
- [x] Respects `.gitignore` patterns
- [x] Returns file metadata (size, modified date, type)
- [x] Handles permission errors gracefully
- [x] Unit tests with mock filesystem

## Related

- PR: TBD
- Depends on: #1 (scaffold), #4 (Go testing infrastructure)
- Blocks: #8 (File Explorer UI)

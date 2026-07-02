# Issue #41: Refactor Go Package Structure

## Issue Summary

Reorganize Go backend code from flat root-level structure into a clean layered package hierarchy for better maintainability and testability.

## Acceptance Criteria

- [ ] Create `internal/filesystem` package with FileSystem interface and implementations
- [ ] Create `internal/process` package with Process/ProcessManager interfaces
- [ ] Keep `app.go` at root as thin Wails binding layer
- [ ] Update `main.go` to wire dependencies
- [ ] All existing tests pass in new locations
- [ ] Verify Wails bindings still work

## Test Strategy

This is a refactoring task - the "test" is that all existing functionality continues to work:

1. **Existing Go tests pass** - All 16 tests must pass in their new locations
2. **Existing frontend tests pass** - All 41 tests must still pass
3. **Wails build succeeds** - Application still builds and runs

## Test Cases

| Test | Rationale |
|------|-----------|
| `go test ./...` passes | Proves all Go tests work after reorganization |
| `npm test` passes | Proves frontend tests still work |
| `wails build` succeeds | Proves Wails bindings still work |

## Before Structure

```
firn-ide/
├── main.go
├── app.go
├── app_test.go
├── interfaces.go
├── interfaces_test.go
├── filesystem.go
├── filesystem_test.go
```

## After Structure

```
firn-ide/
├── main.go                       # Entry point + embed
├── app.go                        # Wails bindings (thin layer)
├── app_test.go                   # App tests
├── internal/
│   ├── filesystem/
│   │   ├── filesystem.go         # FileSystem interface
│   │   ├── os.go                 # OS implementation
│   │   ├── reader.go             # DirectoryReader, FileEntry
│   │   ├── reader_test.go        # DirectoryReader tests
│   │   └── mock.go               # Mock implementations
│   └── process/
│       ├── process.go            # Process, ProcessManager interfaces
│       └── mock.go               # Mock implementations
```

## TDD: Before (All Tests Pass)

```
=== RUN   TestNewApp
--- PASS: TestNewApp (0.00s)
=== RUN   TestStartup
--- PASS: TestStartup (0.00s)
... (16 Go tests pass)
PASS
ok      arc0.023s
```

## TDD: After (All Tests Still Pass)

```
=== RUN   TestNewApp
--- PASS: TestNewApp (0.00s)
=== RUN   TestStartup
--- PASS: TestStartup (0.00s)
=== RUN   TestGetWorkspaceInfo
--- PASS: TestGetWorkspaceInfo (0.00s)
=== RUN   TestWorkspaceInfoStruct
--- PASS: TestWorkspaceInfoStruct (0.00s)
PASS
ok      arc0.019s
=== RUN   TestMockImplementsInterface
--- PASS: TestMockImplementsInterface (0.00s)
=== RUN   TestMockReadFile
--- PASS: TestMockReadFile (0.00s)
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
ok      arc/internal/filesystem    0.013s
=== RUN   TestMockManagerImplementsInterface
--- PASS: TestMockManagerImplementsInterface (0.00s)
=== RUN   TestMockProcessImplementsInterface
--- PASS: TestMockProcessImplementsInterface (0.00s)
=== RUN   TestMockManagerStart
--- PASS: TestMockManagerStart (0.00s)
PASS
ok      arc/internal/process    0.012s
```

## Implementation Notes

- `app.go` stays at root as the Wails binding surface
- Each internal package owns its interface + implementations
- Mock implementations co-located with interfaces for easy imports
- `main.go` wires dependencies together

## Verification

- [x] All Go tests pass: `go test ./...`
- [x] All frontend tests pass: `npm test`
- [x] Wails build succeeds: `wails build`

## Related

- PR: TBD
- Depends on: #7 (filesystem implementation)
- Blocks: None

# Issue #4: Go Testing Setup

## Issue Summary

Configure testing infrastructure for the Go backend, enabling test-driven development for all backend features.

## Acceptance Criteria

- [ ] Go test configuration
- [ ] Mock interfaces for file system, processes
- [ ] Coverage reporting
- [ ] CI integration
- [ ] Example tests for app.go

## Test Strategy

Go has built-in testing (`go test`), so the strategy is:
1. **Verify test command works** - `go test ./...` executes successfully
2. **Verify coverage works** - `go test -cover` generates coverage report
3. **Verify mocks are usable** - Interfaces defined for external dependencies
4. **Verify CI runs tests** - GitHub Actions workflow updated

For TDD verification, we write tests first that:
- Test existing `app.go` functionality
- Define interfaces that will be needed for mocking
- Ensure the test infrastructure itself works

## Test Cases

| Test | File | Rationale |
|------|------|-----------|
| `TestNewApp` | `app_test.go` | Proves App struct initializes correctly |
| `TestStartup` | `app_test.go` | Proves startup stores context |
| `TestGetWorkspaceInfo` | `app_test.go` | Tests workspace info method |
| `TestWorkspaceInfoStruct` | `app_test.go` | Tests struct field assignment |
| `TestMockFileSystemImplementsInterface` | `interfaces_test.go` | Proves mock satisfies interface |
| `TestMockProcessManagerImplementsInterface` | `interfaces_test.go` | Proves mock satisfies interface |
| `TestMockProcessImplementsInterface` | `interfaces_test.go` | Proves mock satisfies interface |
| `TestMockFileSystemReadFile` | `interfaces_test.go` | Tests mock functionality |
| `TestMockProcessManagerStart` | `interfaces_test.go` | Tests mock functionality |

### Interface Definitions

| Interface | Purpose | Methods |
|-----------|---------|---------|
| `FileSystem` | Mock file operations | `ReadDir`, `ReadFile`, `WriteFile`, `Stat`, `MkdirAll`, `Remove` |
| `ProcessManager` | Mock process execution | `Start` |
| `Process` | Running process handle | `Wait`, `Kill`, `Pid` |

## TDD: Before (Failing Tests)

For issue #4, the tests were written against existing code (`app.go`), so they passed immediately. However, if we were testing new functionality, this is what a failing test would look like:

```
=== RUN   TestNewFeature
    app_test.go:15: undefined: NewFeature
--- FAIL: TestNewFeature (0.00s)
FAIL
```

For the interface tests, if we wrote them before defining the interfaces:

```
=== RUN   TestMockFileSystemImplementsInterface
    interfaces_test.go:10: undefined: FileSystem
--- FAIL: TestMockFileSystemImplementsInterface (0.00s)
FAIL
```

The TDD cycle for Go:
1. Write test that references undefined function/type → **Compile error**
2. Define minimal function/type → **Test runs but may fail**
3. Implement logic → **Test passes**

## Implementation Notes

### Configuration Decisions

| Decision | Rationale |
|----------|-----------|
| Standard `go test` | Built-in, no external dependencies, Go idiom |
| No mock framework | Interface-based mocking is Go convention |
| Table-driven tests | Standard Go pattern for multiple test cases |
| `_test.go` alongside code | Go convention, keeps tests near implementation |
| `testify` optional | May add later if assertions become verbose |

### Directory Structure

```
├── app.go              # Main application
├── app_test.go         # Tests for app.go
├── interfaces.go       # Interface definitions for mocking
└── internal/
    └── mocks/          # Mock implementations (future)
```

### CI Integration

Update `.github/workflows/test.yml` to:
1. Set up Go environment
2. Run `go test ./...`
3. Generate coverage with `-coverprofile`
4. Upload coverage report

## Verification

```
=== RUN   TestNewApp
--- PASS: TestNewApp (0.00s)
=== RUN   TestStartup
--- PASS: TestStartup (0.00s)
=== RUN   TestGetWorkspaceInfo
--- PASS: TestGetWorkspaceInfo (0.00s)
=== RUN   TestWorkspaceInfoStruct
--- PASS: TestWorkspaceInfoStruct (0.00s)
=== RUN   TestMockFileSystemImplementsInterface
--- PASS: TestMockFileSystemImplementsInterface (0.00s)
=== RUN   TestMockProcessManagerImplementsInterface
--- PASS: TestMockProcessManagerImplementsInterface (0.00s)
=== RUN   TestMockProcessImplementsInterface
--- PASS: TestMockProcessImplementsInterface (0.00s)
=== RUN   TestMockFileSystemReadFile
--- PASS: TestMockFileSystemReadFile (0.00s)
=== RUN   TestMockProcessManagerStart
--- PASS: TestMockProcessManagerStart (0.00s)
PASS
ok  	arc	0.010s	coverage: 42.9% of statements
```

All acceptance criteria met:
- [x] Go test configuration - `go test ./...` works
- [x] Mock interfaces for file system, processes - `FileSystem`, `ProcessManager`, `Process` interfaces defined
- [x] Coverage reporting - `go test -cover` shows 42.9% coverage
- [x] CI integration - GitHub Actions workflow updated with backend-tests job
- [x] Example tests for app.go - 4 tests for App struct and methods

## Related

- PR: TBD
- Depends on: #1
- Blocks: #7-16 (backend features need test infrastructure)

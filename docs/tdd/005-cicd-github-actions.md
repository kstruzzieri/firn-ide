# Issue #5: CI/CD - GitHub Actions

## Issue Summary

Setup comprehensive CI/CD pipeline with tests, linting, build verification, and release automation.

## Acceptance Criteria

- [ ] Run tests on PR
- [ ] Lint checks (ESLint, golangci-lint)
- [ ] Build verification
- [ ] Release builds for macOS/Linux
- [ ] Automated changelog

## Test Strategy

CI/CD configuration is tested by verifying:
1. **Workflow files exist** - Required YAML files are present
2. **Workflow content is correct** - Files contain expected configuration
3. **Changelog exists** - CHANGELOG.md is present

This ensures all required CI/CD components are in place before merging.

## Test Cases

| Test | Rationale |
|------|-----------|
| `test.yml exists` | Proves test workflow is configured (already exists from #3/#4) |
| `lint.yml exists` | Proves lint workflow is configured |
| `build.yml exists` | Proves build verification workflow exists |
| `release.yml exists` | Proves release workflow is configured |
| `release.yml triggers on v* tags` | Proves releases are tag-triggered |
| `release.yml builds for macOS` | Proves macOS release is configured |
| `release.yml builds for Linux` | Proves Linux release is configured |
| `lint.yml runs ESLint` | Proves frontend linting in CI |
| `lint.yml runs golangci-lint` | Proves backend linting in CI |
| `CHANGELOG.md exists` | Proves changelog is maintained |

## TDD: Before (Failing Tests)

```
FAIL src/__tests__/cicd.test.ts
  CI Workflow
    ✓ should have test.yml workflow (3 ms)
    ✕ should have lint.yml workflow (2 ms)
    ✕ should have build.yml workflow (1 ms)
  Release Workflow
    ✕ should have release.yml workflow (1 ms)
    ✕ should trigger on version tags (1 ms)
    ✕ should build for macOS
    ✕ should build for Linux
  Lint Workflow
    ✕ should run ESLint
    ✕ should run golangci-lint
  Changelog
    ✕ should have CHANGELOG.md (1 ms)

  ● CI Workflow › should have lint.yml workflow

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

  ● CI Workflow › should have build.yml workflow

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

  ● Release Workflow › should have release.yml workflow

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

  ● Lint Workflow › should run ESLint

    ENOENT: no such file or directory, open '.github/workflows/lint.yml'

  ● Changelog › should have CHANGELOG.md

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

Test Suites: 1 failed, 1 total
Tests:       9 failed, 1 passed, 10 total
```

Only `test.yml` exists (from #3/#4). All other workflows and CHANGELOG.md are missing.

## Implementation Notes

### Workflow Structure

```
.github/workflows/
├── test.yml      # Run tests on PR (exists)
├── lint.yml      # Run ESLint + golangci-lint on PR
├── build.yml     # Verify Wails build on PR
└── release.yml   # Build & release on v* tags
```

### Configuration Decisions

| Decision | Rationale |
|----------|-----------|
| Separate lint workflow | Faster feedback, can run in parallel with tests |
| golangci-lint | Standard Go meta-linter, includes many useful checks |
| Wails build verification | Ensures full app builds, not just tests pass |
| Tag-triggered releases | Standard pattern: `git tag v1.0.0 && git push --tags` |
| Matrix builds | Build for macOS and Linux in parallel |
| Conventional commits | Enables automated changelog generation |

### Release Strategy

1. Developer pushes tag: `git tag v1.0.0 && git push --tags`
2. Release workflow triggers
3. Builds for macOS (arm64, amd64) and Linux (amd64)
4. Creates GitHub Release with binaries
5. Generates changelog from commits

## TDD: After (Passing Tests)

```
PASS src/__tests__/cicd.test.ts
  CI Workflow
    ✓ should have test.yml workflow (2 ms)
    ✓ should have lint.yml workflow (1 ms)
    ✓ should have build.yml workflow
  Release Workflow
    ✓ should have release.yml workflow (1 ms)
    ✓ should trigger on version tags (1 ms)
    ✓ should build for macOS
    ✓ should build for Linux
  Lint Workflow
    ✓ should run ESLint
    ✓ should run golangci-lint (1 ms)
  Changelog
    ✓ should have CHANGELOG.md

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

## Verification

All acceptance criteria met:
- [x] Run tests on PR - `test.yml` runs frontend and backend tests
- [x] Lint checks - `lint.yml` runs ESLint and golangci-lint
- [x] Build verification - `build.yml` verifies Wails build
- [x] Release builds for macOS/Linux - `release.yml` builds both platforms on tags
- [x] Automated changelog - CHANGELOG.md created, releases auto-generate from commits

## Related

- PR: TBD
- Depends on: #2, #3, #4
- Blocks: None (infrastructure improvement)

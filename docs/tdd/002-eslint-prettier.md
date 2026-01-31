# Issue #2: ESLint + Prettier Configuration

## Issue Summary

Add linting and formatting configuration to enforce code quality and consistent style across the codebase.

## Acceptance Criteria

- [x] ESLint config with TypeScript rules
- [x] Prettier config
- [x] Pre-commit hooks with husky
- [x] npm scripts for lint/format
- [x] Fix existing lint issues

## Test Strategy

Infrastructure/tooling issues are tested by verifying:
1. **Config files exist** - Required configuration files are present
2. **Tools execute successfully** - Commands run without errors
3. **Scripts are defined** - package.json has required scripts

This approach directly tests the acceptance criteria - if any config is missing or broken, the tests fail.

## Test Cases

| Test | Rationale |
|------|-----------|
| `eslint.config.js exists` | Proves ESLint is configured (v9 flat config format) |
| `npm run lint passes` | Proves ESLint works and codebase has no errors |
| `.prettierrc exists` | Proves Prettier formatting rules are defined |
| `.prettierignore exists` | Proves build artifacts are excluded from formatting |
| `npm run format:check passes` | Proves all source code is properly formatted |
| `.husky directory exists` | Proves Husky git hooks are installed |
| `pre-commit hook exists` | Proves hook is configured to run on commit |
| `lint script defined` | Proves `npm run lint` is available |
| `lint:fix script defined` | Proves `npm run lint:fix` is available |
| `format script defined` | Proves `npm run format` is available |
| `format:check script defined` | Proves `npm run format:check` is available |

## TDD: Before (Failing Tests)

When tests were first run before implementation:

```
FAIL src/__tests__/lint.test.ts
  ● ESLint Configuration › should have eslint.config.js file

    expect(received).toBe(true)

    Received: false

  ● ESLint Configuration › should run eslint without errors on clean code

    Command failed: npm run lint
    npm ERR! missing script: lint

  ● Prettier Configuration › should have .prettierrc file

    expect(received).toBe(true)

    Received: false

  ● NPM Scripts › should have lint script

    expect(received).toBeDefined()

    Received: undefined

Test Suites: 1 failed, 1 total
Tests:       11 failed, 11 total
```

All 11 tests failed because:
- Config files didn't exist
- NPM scripts weren't defined
- Tools weren't installed

## Implementation Notes

### Configuration Decisions

| Decision | Rationale |
|----------|-----------|
| ESLint v9 flat config | Modern format, better TypeScript support, clearer structure |
| typescript-eslint | Official TypeScript ESLint integration |
| eslint-config-prettier | Disables ESLint rules that conflict with Prettier |
| Single quotes | Consistent with common JS/TS conventions |
| 100 char print width | Balance between readability and line length |
| Trailing commas (es5) | Cleaner git diffs, valid ES5+ syntax |

### Husky Setup

Husky installed at repo root (where `.git` lives) with lint-staged running ESLint and Prettier on staged files. This prevents committing code that doesn't meet quality standards.

### Pre-commit Flow

```
git commit → husky pre-commit → lint-staged → eslint --fix + prettier --write → commit succeeds
```

If lint-staged finds unfixable errors, the commit is blocked.

## TDD: After (Passing Tests)

After implementing ESLint, Prettier, and Husky configuration:

```
PASS src/__tests__/lint.test.ts (5.296 s)
  ESLint Configuration
    ✓ should have eslint.config.js file (3 ms)
    ✓ should run eslint without errors on clean code (3818 ms)
  Prettier Configuration
    ✓ should have .prettierrc file
    ✓ should have .prettierignore file (1 ms)
    ✓ should pass format check on all files (1156 ms)
  Husky Pre-commit Hook
    ✓ should have husky installed at root (1 ms)
    ✓ should have pre-commit hook configured
  NPM Scripts
    ✓ should have lint script (11 ms)
    ✓ should have lint:fix script (1 ms)
    ✓ should have format script
    ✓ should have format:check script

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

## Verification

```
Test Suites: 6 passed, 6 total
Tests:       25 passed, 25 total
```

All 11 lint-specific tests pass, verifying:
- Config files exist
- Lint and format commands succeed
- NPM scripts are defined
- Pre-commit hook is configured

## Related

- PR #36
- Depends on: #1, #3
- Blocks: None (DevEx improvement)

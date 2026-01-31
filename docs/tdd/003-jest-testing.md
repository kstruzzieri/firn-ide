# Issue #3: Jest + React Testing Library Setup

## Issue Summary

Configure testing infrastructure for the frontend, enabling test-driven development for all future features.

## Acceptance Criteria

- [x] Jest configuration for TypeScript
- [x] React Testing Library setup
- [x] Coverage reporting
- [x] CI integration
- [x] Example tests for existing components

## Test Strategy

For testing infrastructure itself, we use a bootstrap approach:
1. **Write tests that verify the infrastructure** - Tests check that Jest and RTL work
2. **Run tests** - They fail because infrastructure doesn't exist
3. **Implement infrastructure** - Add Jest, RTL, configs
4. **Tests pass** - Infrastructure is verified

This is TDD applied to tooling setup.

## Test Cases

| Test | Rationale |
|------|-----------|
| `TypeScript tests run` | Proves Jest can parse and execute .ts files |
| `jest-dom matchers work` | Proves `toBeInTheDocument()` and other matchers are available |
| `React components render` | Proves RTL can render React components |
| `Component text assertions` | Proves we can query and assert on rendered content |
| `Coverage reports generate` | Proves `npm run test:coverage` works |

### Component Tests (Examples)

| Component | Tests | Rationale |
|-----------|-------|-----------|
| App | Renders without crashing, shows header | Smoke test for entire app |
| Header | Shows app name, has buttons | Verifies core UI elements |
| Sidebar | Renders icons, has expected buttons | Verifies navigation structure |
| StatusBar | Renders, shows status info | Verifies status display |

## Implementation Notes

### Configuration Decisions

| Decision | Rationale |
|----------|-----------|
| Jest over Vitest | More mature, better IDE support, wider ecosystem |
| ts-jest | Official TypeScript transformer for Jest |
| jest-environment-jsdom | DOM simulation for React component testing |
| identity-obj-proxy | Mocks CSS modules to avoid style errors in tests |
| CommonJS config (.cjs) | Avoids ESM complications with Jest |

### Setup File (`setupTests.ts`)

Provides global test utilities:
- `@testing-library/jest-dom` - Extended matchers
- `matchMedia` mock - For responsive components
- `ResizeObserver` mock - For layout components

### Coverage Thresholds

Initial thresholds set conservatively:
- Branches: 20%
- Functions: 40%
- Lines: 40%
- Statements: 40%

These will increase as test coverage improves.

### CI Integration

GitHub Actions workflow (`.github/workflows/test.yml`):
1. Triggers on push/PR to main/develop
2. Installs dependencies
3. Runs tests
4. Generates coverage report
5. Uploads to Codecov (optional)

## Verification

```
Test Suites: 5 passed, 5 total
Tests:       14 passed, 14 total
Snapshots:   0 total
```

Coverage report generates successfully with `npm run test:coverage`.

## Related

- PR #35 (merged)
- Depends on: #1
- Blocks: #2 (needed test infrastructure for TDD)

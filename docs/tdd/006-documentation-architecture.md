# Issue #6: Documentation - Architecture Guide

## Issue Summary

Document system architecture for contributors, including component diagrams, data flow, state management patterns, and guides for adding new features.

## Acceptance Criteria

- [ ] Component diagram
- [ ] Data flow documentation
- [ ] State management patterns
- [ ] Adding new features guide
- [ ] Wails bindings documentation

## Test Strategy

Documentation is tested by verifying:
1. **Files exist** - Required documentation files are present
2. **Content is complete** - Files contain expected sections and headings

This ensures all architecture documentation is in place before merging.

## Test Cases

| Test | Rationale |
|------|-----------|
| `ARCHITECTURE.md exists` | Proves main architecture doc is created |
| `ARCHITECTURE.md has Component Overview section` | Proves component diagram/overview exists |
| `ARCHITECTURE.md has Data Flow section` | Proves data flow is documented |
| `ARCHITECTURE.md has State Management section` | Proves state patterns are documented |
| `ARCHITECTURE.md has Adding Features section` | Proves contributor guide exists |
| `ARCHITECTURE.md has Wails Bindings section` | Proves Wails integration is documented |

## TDD: Before (Failing Tests)

```
FAIL src/__tests__/documentation.test.ts
  Architecture Documentation
    ✕ should have ARCHITECTURE.md (4 ms)
    required sections
      ✕ should have Component Overview section
      ✕ should have Data Flow section
      ✕ should have State Management section
      ✕ should have Adding Features section
      ✕ should have Wails Bindings section (1 ms)

  ● Architecture Documentation › should have ARCHITECTURE.md

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

      10 |   it('should have ARCHITECTURE.md', () => {
      11 |     const exists = fs.existsSync(architecturePath);
    > 12 |     expect(exists).toBe(true);
         |                    ^

  ● Architecture Documentation › required sections › should have Component Overview section

    ENOENT: no such file or directory, open 'docs/ARCHITECTURE.md'

Test Suites: 1 failed, 1 total
Tests:       6 failed, 6 total
```

## Implementation Notes

### Documentation Structure

```
docs/
├── ARCHITECTURE.md    # Main architecture documentation
└── tdd/               # TDD documentation per issue
```

### ARCHITECTURE.md Sections

1. **Component Overview** - Mermaid diagram showing React components and Go backend
2. **Data Flow** - How data moves between frontend, Wails runtime, and Go backend
3. **State Management** - Zustand store patterns and conventions
4. **Adding New Features** - Step-by-step guide for contributors
5. **Wails Bindings** - How Go functions are exposed to the frontend

## TDD: After (Passing Tests)

```
PASS src/__tests__/documentation.test.ts
  Architecture Documentation
    ✓ should have ARCHITECTURE.md (3 ms)
    required sections
      ✓ should have Component Overview section
      ✓ should have Data Flow section (1 ms)
      ✓ should have State Management section
      ✓ should have Adding Features section
      ✓ should have Wails Bindings section

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

## Verification

All acceptance criteria met:
- [x] Component diagram - Mermaid diagram in Component Overview section
- [x] Data flow documentation - Data Flow section with diagrams
- [x] State management patterns - State Management section with Zustand patterns
- [x] Adding new features guide - Step-by-step contributor guide
- [x] Wails bindings documentation - Wails Bindings section with examples

## Related

- PR: TBD
- Depends on: #1 (scaffold must exist to document)
- Blocks: None (documentation improvement)

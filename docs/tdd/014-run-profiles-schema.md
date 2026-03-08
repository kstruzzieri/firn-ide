# TDD 014: Run Profiles - Configuration Schema

## Issue Summary

Implements the foundation for Run Profiles (Issue #14): schema types, persistent storage, auto-detection from project config files, validation, and reactive re-detection via the file watcher.

## Acceptance Criteria

- [x] Go schema types with JSON serialization (types.go)
- [x] Profile validation with field-level errors (validator.go)
- [x] Persistent storage in `.firn/run-profiles.json` (store.go)
- [x] Auto-detection from package.json, go.mod, Makefile, pyproject.toml, docker-compose (detector.go)
- [x] Manager orchestrating store + detector with merge/dedup (manager.go)
- [x] 7 Wails bindings in app.go + reactive re-detection in watcher callback
- [x] TypeScript types mirroring Go types (types/runProfile.ts)
- [x] Zustand store slice for run profiles (stores/ideStore.ts)
- [x] useRunProfilesLoader hook with EventsOn subscription (hooks/useRunProfiles.ts)
- [x] RunProfiles component displays real data grouped by source
- [x] Mock for Manager (mock.go)

## Test Strategy

### Go Tests (internal/runprofile/)
- **types_test.go** — JSON round-trip, omitempty correctness
- **validator_test.go** — valid/invalid profiles, field-level error detection
- **store_test.go** — load/save/delete/pin with mock filesystem
- **detector_test.go** — package.json parsing, go.mod/Makefile detection, tag inference
- **manager_test.go** — load, merge/dedup, save validation, reactive re-detect, workspace switching

### Frontend Tests (src/__tests__/)
- **stores/runProfileStore.test.ts** — store actions and state management
- **hooks/useRunProfiles.test.ts** — loading, event subscription, error handling, cleanup

## Architecture Decisions

1. **Deterministic IDs** — `detected-<source>-<name>` enables stable merge across re-detections
2. **Shadow-based dedup** — Saved profiles shadow detected profiles by DetectedFrom+Name key
3. **Reactive via file watcher** — No polling; config file changes trigger re-detection through existing watcher
4. **filesystem.FileSystem interface** — All disk I/O goes through the interface for testability

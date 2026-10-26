package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"firn/internal/filesystem"
	"firn/internal/runprofile"
	"firn/internal/watcher"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Issue #367: the Run Profiles panel's Reload action re-reads the profiles in
// place. These tests use the real filesystem, as the production App does.

const reloadSavedProfiles = `{
  "version": 3,
  "profiles": [
    {"id": "keep-a", "name": "Keep A", "type": "single", "source": "user", "command": "echo a"},
    {"id": "keep-b", "name": "Keep B", "type": "single", "source": "user", "command": "echo b"}
  ]
}
`

type reloadEmits struct {
	events []string
	snaps  []runprofile.RunProfilesSnapshot
}

// reloadApp opens a workspace whose run-profiles.json carries a conflict
// marker, so the load degrades to a warning and latches writes off.
func reloadApp(t *testing.T) (*App, string, *reloadEmits) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite","test":"jest"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".firn"), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, ".firn", "run-profiles.json")
	if err := os.WriteFile(path, []byte(reloadSavedProfiles+">>>>>>> feature/branch\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	app.osFS = filesystem.NewOS()
	got := &reloadEmits{}
	app.emitFn = func(event string, data any) {
		got.events = append(got.events, event)
		if snap, ok := data.(runprofile.RunProfilesSnapshot); ok {
			got.snaps = append(got.snaps, snap)
		}
	}
	if err := app.LoadRunProfiles(root); err != nil {
		t.Fatalf("LoadRunProfiles: %v", err)
	}
	warnings := app.GetRunProfilesSnapshot().LoadWarnings
	if len(warnings) != 1 || !strings.Contains(warnings[0], "Reload in the Run Profiles panel") {
		t.Fatalf("want one load warning naming the Reload action, got %q", warnings)
	}
	return app, path, got
}

func reloadUserProfile(app *App) runprofile.RunProfile {
	return runprofile.RunProfile{
		ID: "new-user", Name: "New", Type: runprofile.ProfileTypeSingle, Command: "echo new",
		WorkspaceID: app.GetAllRunProfiles()[0].WorkspaceID,
	}
}

func TestReloadRunProfilesClearsLatchAndEmitsCleanSnapshot(t *testing.T) {
	app, path, got := reloadApp(t)
	if err := os.WriteFile(path, []byte(reloadSavedProfiles), 0o644); err != nil {
		t.Fatal(err)
	}

	snap, err := app.ReloadRunProfiles()
	if err != nil {
		t.Fatalf("ReloadRunProfiles: %v", err)
	}
	if len(got.events) != 1 || got.events[0] != "runprofiles:changed" || len(got.snaps) != 1 {
		t.Fatalf("want exactly one runprofiles:changed snapshot, got events %v", got.events)
	}
	if w := got.snaps[0].LoadWarnings; w == nil || len(w) != 0 {
		t.Fatalf("a clean reload must emit an empty, non-nil warning list, got %#v", w)
	}
	// The caller learns the outcome from the return value: the same clean snapshot.
	if w := snap.LoadWarnings; w == nil || len(w) != 0 {
		t.Fatalf("a clean reload must return an empty, non-nil warning list, got %#v", w)
	}
	if len(snap.Profiles) != len(got.snaps[0].Profiles) {
		t.Fatalf("returned snapshot has %d profiles, emitted one has %d", len(snap.Profiles), len(got.snaps[0].Profiles))
	}

	res, err := app.SaveRunProfile(reloadUserProfile(app))
	if err != nil || !res.Valid {
		t.Fatalf("save after a successful reload: err=%v res=%+v", err, res)
	}
	var pf runprofile.ProfilesFile
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &pf); err != nil {
		t.Fatal(err)
	}
	if len(pf.Profiles) != 3 {
		t.Fatalf("want the two kept profiles plus the new one, got %+v", pf.Profiles)
	}
}

func TestReloadRunProfilesWithoutWorkspaceErrors(t *testing.T) {
	app := NewApp()
	var events []string
	app.emitFn = func(event string, _ any) { events = append(events, event) }

	snap, err := app.ReloadRunProfiles()
	if err == nil || !strings.Contains(err.Error(), "no workspace loaded") {
		t.Fatalf("want a no workspace loaded error, got %v", err)
	}
	if len(snap.Profiles) != 0 || snap.LoadWarnings != nil {
		t.Fatalf("a refused reload must return the zero snapshot, got %+v", snap)
	}
	if len(events) != 0 {
		t.Fatalf("a refused reload must emit nothing, got %v", events)
	}
}

// ProjectRunProfileManager.Load degrades a store failure to a warning and
// returns nil, so reloading a file that is still broken succeeds, re-emits the
// warning and keeps the write refusal.
func TestReloadRunProfilesWhileFileStillBrokenReEmitsWarningAndKeepsLatch(t *testing.T) {
	app, path, got := reloadApp(t)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	var logs bytes.Buffer
	previousLog := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previousLog) })

	snap, err := app.ReloadRunProfiles()
	if err != nil {
		t.Fatalf("ReloadRunProfiles: %v", err)
	}
	if len(got.snaps) != 1 || len(got.snaps[0].LoadWarnings) != 1 {
		t.Fatalf("want one snapshot carrying the one warning again, got %+v", got.snaps)
	}
	// The return value tells the caller a load problem remains, naming the file.
	if len(snap.LoadWarnings) != 1 || !strings.Contains(snap.LoadWarnings[0], path) {
		t.Fatalf("want the returned snapshot to carry one warning naming %s, got %q", path, snap.LoadWarnings)
	}
	// Reload logs what is still wrong, as a folder open does.
	if want := "run profiles: " + snap.LoadWarnings[0]; !strings.Contains(logs.String(), want) {
		t.Fatalf("want the reload to log %q, got %q", want, logs.String())
	}

	_, err = app.SaveRunProfile(reloadUserProfile(app))
	if err == nil || !strings.Contains(err.Error(), path) {
		t.Fatalf("save must still be refused naming %s, got %v", path, err)
	}
	after, rerr := os.ReadFile(path)
	if rerr != nil {
		t.Fatal(rerr)
	}
	if string(after) != string(before) {
		t.Fatalf("the broken file was rewritten:\n%s", after)
	}
}

// Reload is not a workspace open: the executor epoch and a running process
// survive it, even when it lifts the write latch.
func TestReloadRunProfilesKeepsExecutorEpochAndRunningProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sleep is not a standalone executable on Windows")
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".firn"), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, ".firn", "run-profiles.json")
	valid := `{"version": 3, "profiles": [{"id": "sleeper", "name": "Sleeper", "type": "single", "source": "user", "command": "sleep 30"}]}`
	if err := os.WriteFile(path, []byte(valid), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	app.osFS = filesystem.NewOS()
	executor := runprofile.NewExecutor(nil, nil)
	t.Cleanup(func() { executor.StopAll(2 * time.Second) }) //nolint:errcheck
	app.executor = executor
	app.emitFn = func(string, any) {}
	if err := app.LoadRunProfiles(root); err != nil {
		t.Fatalf("LoadRunProfiles: %v", err)
	}
	epoch := executor.CurrentEpoch()
	if err := app.StartRunProfile("sleeper"); err != nil {
		t.Fatalf("StartRunProfile: %v", err)
	}
	running := executor.GetStatus("sleeper")
	if running.State != runprofile.RunStateRunning {
		t.Fatalf("sleeper state = %q, want running", running.State)
	}

	// Break the file and reopen the same folder, which keeps runs, to latch writes.
	if err := os.WriteFile(path, []byte(valid+"\n>>>>>>> feature/branch\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := app.LoadRunProfiles(root); err != nil {
		t.Fatalf("LoadRunProfiles (broken): %v", err)
	}
	if w := app.GetRunProfilesSnapshot().LoadWarnings; len(w) != 1 {
		t.Fatalf("want one load warning before the reload, got %q", w)
	}
	if err := os.WriteFile(path, []byte(valid), 0o644); err != nil {
		t.Fatal(err)
	}

	snap, err := app.ReloadRunProfiles()
	if err != nil {
		t.Fatalf("ReloadRunProfiles: %v", err)
	}
	if len(snap.LoadWarnings) != 0 {
		t.Fatalf("want a clean reload, got %q", snap.LoadWarnings)
	}
	if snap.WorkspaceEpoch != epoch {
		t.Fatalf("snapshot epoch = %d, want %d", snap.WorkspaceEpoch, epoch)
	}
	if got := executor.CurrentEpoch(); got != epoch {
		t.Fatalf("executor epoch = %d after reload, want %d", got, epoch)
	}
	after := executor.GetStatus("sleeper")
	if after.State != runprofile.RunStateRunning || after.RunInstanceID != running.RunInstanceID {
		t.Fatalf("after reload sleeper = %+v, want the same run %q still running", after, running.RunInstanceID)
	}
	if err := app.StopRunProfile("sleeper"); err != nil {
		t.Fatalf("StopRunProfile: %v", err)
	}
}

// ProjectRunProfileManager.Load fails only when the repo's workspaces cannot be
// enumerated, which the real filesystem never reports (detection skips what it
// cannot read), so the load is failed through the test seam.
func TestReloadRunProfilesLoadErrorReturnsErrorAndEmitsNothing(t *testing.T) {
	app, _, got := reloadApp(t)
	loadErr := errors.New("workspace unavailable")
	app.loadRunProfilesFn = func(*runprofile.ProjectRunProfileManager) error { return loadErr }

	snap, err := app.ReloadRunProfiles()
	if !errors.Is(err, loadErr) {
		t.Fatalf("ReloadRunProfiles error = %v, want %v", err, loadErr)
	}
	if len(snap.Profiles) != 0 || snap.LoadWarnings != nil {
		t.Fatalf("a failed reload must return the zero snapshot, got %+v", snap)
	}
	if len(got.events) != 0 {
		t.Fatalf("a failed reload must emit nothing, got %v", got.events)
	}
}

// Detector warnings never reach the panel, so a watcher re-detection logs them
// to leave a trace of a config file that stopped parsing.
func TestHandleWatchEventLogsDetectorWarnings(t *testing.T) {
	root := t.TempDir()
	pkg := filepath.Join(root, "package.json")
	if err := os.WriteFile(pkg, []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	app.osFS = filesystem.NewOS()
	app.emitFn = func(string, any) {}
	if err := app.LoadRunProfiles(root); err != nil {
		t.Fatalf("LoadRunProfiles: %v", err)
	}
	if err := os.WriteFile(pkg, []byte("{ not valid json"), 0o644); err != nil {
		t.Fatal(err)
	}

	var logs bytes.Buffer
	previousLog := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previousLog) })
	app.handleWatchEvent(watcher.FileEvent{Path: pkg, Type: watcher.EventModified})

	if want := "run profiles: failed to parse package.json"; !strings.Contains(logs.String(), want) {
		t.Fatalf("want the re-detection to log %q, got %q", want, logs.String())
	}
}

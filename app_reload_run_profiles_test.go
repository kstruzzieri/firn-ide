package main

import (
	"encoding/json"
	"firn/internal/filesystem"
	"firn/internal/runprofile"
	"os"
	"path/filepath"
	"strings"
	"testing"
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

	if err := app.ReloadRunProfiles(); err != nil {
		t.Fatalf("ReloadRunProfiles: %v", err)
	}
	if len(got.events) != 1 || got.events[0] != "runprofiles:changed" || len(got.snaps) != 1 {
		t.Fatalf("want exactly one runprofiles:changed snapshot, got events %v", got.events)
	}
	if w := got.snaps[0].LoadWarnings; w == nil || len(w) != 0 {
		t.Fatalf("a clean reload must emit an empty, non-nil warning list, got %#v", w)
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

	err := app.ReloadRunProfiles()
	if err == nil || !strings.Contains(err.Error(), "no workspace loaded") {
		t.Fatalf("want a no workspace loaded error, got %v", err)
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

	if err := app.ReloadRunProfiles(); err != nil {
		t.Fatalf("ReloadRunProfiles: %v", err)
	}
	if len(got.snaps) != 1 || len(got.snaps[0].LoadWarnings) != 1 {
		t.Fatalf("want one snapshot carrying the one warning again, got %+v", got.snaps)
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

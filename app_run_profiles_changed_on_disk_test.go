package main

import (
	"bytes"
	"firn/internal/filesystem"
	"firn/internal/runprofile"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Issue #397: a write refused because run-profiles.json changed on disk names
// Reload as the remedy, and the panel draws Reload only while the snapshot
// carries a load warning. So the refusal itself must emit that snapshot; a
// failed write otherwise emits nothing.

const changedOtherBranch = `{
  "version": 3,
  "profiles": [
    {"id": "other-branch", "name": "Other branch", "type": "single", "source": "user", "command": "echo other"}
  ]
}
`

func TestIssue397RefusedWriteEmitsSnapshotWithReloadNotice(t *testing.T) {
	detectedID := func(t *testing.T, app *App) string {
		t.Helper()
		for _, p := range app.GetAllRunProfiles() {
			if p.Source == runprofile.ProfileSourceDetected {
				return p.ID
			}
		}
		t.Fatal("fixture detected no profiles")
		return ""
	}
	actions := []struct {
		name string
		run  func(t *testing.T, app *App) error
	}{
		{"SaveRunProfile", func(t *testing.T, app *App) error {
			_, err := app.SaveRunProfile(reloadUserProfile(app))
			return err
		}},
		{"DeleteRunProfile", func(t *testing.T, app *App) error { return app.DeleteRunProfile("keep-a") }},
		{"PinRunProfile", func(t *testing.T, app *App) error { return app.PinRunProfile(detectedID(t, app)) }},
	}
	for _, a := range actions {
		t.Run(a.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite","test":"jest"}}`), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Join(root, ".firn"), 0o755); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, ".firn", "run-profiles.json")
			if err := os.WriteFile(path, []byte(reloadSavedProfiles), 0o644); err != nil {
				t.Fatal(err)
			}
			app := NewApp()
			app.osFS = filesystem.NewOS()
			var snaps []runprofile.RunProfilesSnapshot
			app.emitFn = func(event string, data any) {
				if snap, ok := data.(runprofile.RunProfilesSnapshot); ok && event == "runprofiles:changed" {
					snaps = append(snaps, snap)
				}
			}
			if err := app.LoadRunProfiles(root); err != nil {
				t.Fatalf("LoadRunProfiles: %v", err)
			}
			if err := os.WriteFile(path, []byte(changedOtherBranch), 0o644); err != nil {
				t.Fatal(err)
			}
			snaps = nil

			err := a.run(t, app)

			if err == nil {
				t.Fatalf("%s must refuse after the profiles file changed on disk", a.name)
			}
			if got, _ := os.ReadFile(path); !bytes.Equal(got, []byte(changedOtherBranch)) {
				t.Fatalf("%s rewrote the changed file:\n%s", a.name, got)
			}
			if len(snaps) != 1 {
				t.Fatalf("want one runprofiles:changed snapshot from the refusal, got %d", len(snaps))
			}
			w := snaps[0].LoadWarnings
			if len(w) != 1 || !strings.Contains(w[0], "changed on disk") || !strings.Contains(w[0], "Reload in the Run Profiles panel") {
				t.Fatalf("the emitted snapshot must carry the change notice, got %q", w)
			}
		})
	}
}

// A failed write that latches nothing still emits nothing: the snapshot is
// unchanged, and re-applying it would be noise.
func TestIssue397OrdinaryWriteFailureEmitsNoSnapshot(t *testing.T) {
	app, _, got := reloadApp(t)
	got.events, got.snaps = nil, nil
	if err := app.DeleteRunProfile("no-such-profile"); err == nil {
		t.Fatal("deleting an unknown profile must fail")
	}
	if len(got.events) != 0 {
		t.Fatalf("an ordinary failure must not emit, got %v", got.events)
	}
}

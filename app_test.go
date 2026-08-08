package main

import (
	"context"
	"firn/internal/runprofile"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestMain sandboxes the home directory for the whole package. startup opens
// the Golem consent store under <home>/.firn, which creates that directory and
// tightens its permissions, and the workspace and run-history stores write
// there too; without this the suite would reach into the developer's real home
// directory. USERPROFILE covers Windows, where os.UserHomeDir ignores HOME.
// Individual tests still override HOME with t.Setenv when they need to.
func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "firn-test-home")
	if err != nil {
		log.Fatalf("sandbox home directory: %v", err)
	}
	for _, key := range []string{"HOME", "USERPROFILE"} {
		if err := os.Setenv(key, home); err != nil {
			log.Fatalf("sandbox %s: %v", key, err)
		}
	}
	code := m.Run()
	_ = os.RemoveAll(home)
	os.Exit(code)
}

func TestNewApp(t *testing.T) {
	app := NewApp()
	if app == nil {
		t.Error("NewApp() returned nil")
	}
}

func TestStartup(t *testing.T) {
	app := NewApp()
	ctx := context.Background()

	// startup should not panic and should store context
	app.startup(ctx)

	if app.ctx == nil {
		t.Error("startup() did not store context")
	}
}

// GetWorkspaceInfo is the Golem repository binding call. Before startup there
// is no service to bind against, so it must reject rather than panic.
func TestGetWorkspaceInfoBeforeStartup(t *testing.T) {
	app := NewApp()

	info, err := app.GetWorkspaceInfo(t.TempDir())
	if err == nil {
		t.Fatal("expected a rejection before startup, got nil")
	}
	if info != (WorkspaceInfo{}) {
		t.Errorf("Expected zero WorkspaceInfo, got %+v", info)
	}
}

func TestWorkspaceInfoStruct(t *testing.T) {
	info := WorkspaceInfo{
		Name:      "test-project",
		Path:      "/path/to/project",
		RepoKey:   "0f9a",
		RepoEpoch: 3,
	}

	if info.Name != "test-project" {
		t.Errorf("Expected Name 'test-project', got %q", info.Name)
	}
	if info.Path != "/path/to/project" {
		t.Errorf("Expected Path '/path/to/project', got %q", info.Path)
	}
	if info.RepoKey != "0f9a" {
		t.Errorf("Expected RepoKey '0f9a', got %q", info.RepoKey)
	}
	if info.RepoEpoch != 3 {
		t.Errorf("Expected RepoEpoch 3, got %d", info.RepoEpoch)
	}
}

// StartRunProfile must guard a nil executor the same way StopRunProfile does,
// rather than dereferencing it and panicking before the app has started up.
func TestStartRunProfileNilExecutor(t *testing.T) {
	app := &App{}

	err := app.StartRunProfile("any-id")
	if err == nil {
		t.Fatal("expected error when executor is nil, got nil")
	}
	if !strings.Contains(err.Error(), "not initialized") {
		t.Fatalf("expected 'not initialized' error, got %v", err)
	}
}

func newLoadedAppForProfiles(t *testing.T) *App {
	t.Helper()
	app := NewApp()
	app.ctx = context.Background()
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "package.json"),
		[]byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	if err := app.LoadRunProfiles(tmp); err != nil {
		t.Fatalf("LoadRunProfiles: %v", err)
	}
	return app
}

func TestSaveRunProfileEmitsOnlyWhenValid(t *testing.T) {
	app := newLoadedAppForProfiles(t)
	all := app.GetAllRunProfiles()
	if len(all) == 0 {
		t.Fatal("expected a detected profile from package.json")
	}
	wsID := all[0].WorkspaceID

	var events []string
	app.emitFn = func(event string, _ ...any) { events = append(events, event) }

	// Invalid: empty name → no emit.
	res, err := app.SaveRunProfile(runprofile.RunProfile{
		ID: "user-dev", Type: runprofile.ProfileTypeSingle, Command: "vite", WorkspaceID: wsID,
	})
	if err != nil {
		t.Fatalf("unexpected transport error: %v", err)
	}
	if res.Valid {
		t.Fatal("expected invalid result for empty name")
	}
	if len(events) != 0 {
		t.Fatalf("expected no emit on invalid save, got %v", events)
	}

	// Valid: emits exactly one runprofiles:changed.
	res, err = app.SaveRunProfile(runprofile.RunProfile{
		ID: "user-dev", Name: "Dev", Type: runprofile.ProfileTypeSingle,
		Command: "vite", WorkspaceID: wsID,
	})
	if err != nil || !res.Valid {
		t.Fatalf("valid save failed: err=%v res=%+v", err, res)
	}
	if len(events) != 1 || events[0] != "runprofiles:changed" {
		t.Fatalf("expected one runprofiles:changed, got %v", events)
	}
}

func TestDeleteRunProfileEmitsOnSuccess(t *testing.T) {
	app := newLoadedAppForProfiles(t)
	wsID := app.GetAllRunProfiles()[0].WorkspaceID

	// Set emitFn before seed save so the valid save doesn't reach runtime.EventsEmit.
	var events []string
	app.emitFn = func(event string, _ ...any) { events = append(events, event) }

	if _, err := app.SaveRunProfile(runprofile.RunProfile{
		ID: "user-dev", Name: "Dev", Type: runprofile.ProfileTypeSingle,
		Command: "vite", WorkspaceID: wsID,
	}); err != nil {
		t.Fatalf("seed save: %v", err)
	}
	// Discard the seed-save emit; only count events from here.
	events = nil

	if err := app.DeleteRunProfile("user-dev"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if len(events) != 1 || events[0] != "runprofiles:changed" {
		t.Fatalf("expected one emit on delete, got %v", events)
	}

	events = nil
	if err := app.DeleteRunProfile("does-not-exist"); err == nil {
		t.Fatal("expected error deleting missing profile")
	}
	if len(events) != 0 {
		t.Fatalf("expected no emit on failed delete, got %v", events)
	}
}

func TestApp_DetectWorkspaces(t *testing.T) {
	repo := t.TempDir()
	if err := os.MkdirAll(filepath.Join(repo, "frontend"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "frontend", "package.json"), []byte(`{"devDependencies":{"vite":"5.0.0"}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	defs, err := app.DetectWorkspaces(repo)
	if err != nil {
		t.Fatalf("DetectWorkspaces error: %v", err)
	}
	if len(defs) != 2 {
		t.Fatalf("got %d defs, want 2 (project + frontend): %+v", len(defs), defs)
	}
	if defs[0].ID != "project" {
		t.Errorf("defs[0].ID = %q, want project", defs[0].ID)
	}
	if defs[1].ID != "frontend" || defs[1].Accent != "frontend" {
		t.Errorf("defs[1] = %+v, want frontend/frontend", defs[1])
	}
}

package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

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

func TestGetWorkspaceInfo(t *testing.T) {
	app := NewApp()

	info := app.GetWorkspaceInfo()

	// Currently returns empty values (no workspace loaded)
	if info.Name != "" {
		t.Errorf("Expected empty Name, got %q", info.Name)
	}
	if info.Path != "" {
		t.Errorf("Expected empty Path, got %q", info.Path)
	}
}

func TestWorkspaceInfoStruct(t *testing.T) {
	info := WorkspaceInfo{
		Name: "test-project",
		Path: "/path/to/project",
	}

	if info.Name != "test-project" {
		t.Errorf("Expected Name 'test-project', got %q", info.Name)
	}
	if info.Path != "/path/to/project" {
		t.Errorf("Expected Path '/path/to/project', got %q", info.Path)
	}
}

func TestApp_DetectWorkspaces(t *testing.T) {
	repo := t.TempDir()
	if err := os.MkdirAll(filepath.Join(repo, "frontend"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "frontend", "package.json"), []byte("{}"), 0o644); err != nil {
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
	if defs[1].ID != "frontend" || defs[1].Accent != "blue" {
		t.Errorf("defs[1] = %+v, want frontend/blue", defs[1])
	}
}

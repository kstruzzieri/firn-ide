package main

import (
	"context"
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

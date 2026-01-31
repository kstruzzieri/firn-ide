package main

import (
	"context"
)

// App represents the main application structure for Flux IDE.
// It holds the application context for Wails runtime interactions.
type App struct {
	ctx context.Context
}

// NewApp creates and returns a new App instance.
func NewApp() *App {
	return &App{}
}

// startup is called by Wails when the application starts.
// It stores the context for later use with runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// GetWorkspaceInfo returns information about the current workspace.
// Returns empty values when no workspace is loaded.
func (a *App) GetWorkspaceInfo() WorkspaceInfo {
	// TODO: Implement actual workspace detection
	return WorkspaceInfo{
		Name: "",
		Path: "",
	}
}

// WorkspaceInfo contains information about the current workspace.
type WorkspaceInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

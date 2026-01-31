package main

import (
	"context"
	"io/fs"
	"os"
)

// App represents the main application structure for Flux IDE.
// It holds the application context for Wails runtime interactions.
type App struct {
	ctx       context.Context
	dirReader *DirectoryReader
}

// NewApp creates and returns a new App instance.
func NewApp() *App {
	return &App{
		dirReader: NewDirectoryReader(&osFileSystem{}),
	}
}

// osFileSystem implements FileSystem using the real OS filesystem.
type osFileSystem struct{}

func (o *osFileSystem) ReadDir(path string) ([]fs.DirEntry, error) {
	return os.ReadDir(path)
}

func (o *osFileSystem) ReadFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func (o *osFileSystem) WriteFile(path string, data []byte, perm fs.FileMode) error {
	return os.WriteFile(path, data, perm)
}

func (o *osFileSystem) Stat(path string) (fs.FileInfo, error) {
	return os.Stat(path)
}

func (o *osFileSystem) MkdirAll(path string, perm fs.FileMode) error {
	return os.MkdirAll(path, perm)
}

func (o *osFileSystem) Remove(path string) error {
	return os.Remove(path)
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

// ReadDirectory reads a directory and returns its contents as a tree structure.
// This is exposed to the frontend via Wails bindings.
func (a *App) ReadDirectory(path string) ([]FileEntry, error) {
	return a.dirReader.ReadDirectory(path)
}

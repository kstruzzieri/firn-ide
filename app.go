package main

import (
	"context"

	"flux/internal/filesystem"
	"flux/internal/watcher"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App represents the main application structure for Flux IDE.
// It holds the application context for Wails runtime interactions.
type App struct {
	ctx         context.Context
	dirReader   *filesystem.DirectoryReader
	fileReader  *filesystem.FileReader
	fileWriter  *filesystem.FileWriter
	fileWatcher watcher.Watcher
}

// NewApp creates and returns a new App instance.
func NewApp() *App {
	osFS := filesystem.NewOS()

	// Create file watcher with default config
	watcherConfig := watcher.WatcherConfig{
		DebounceMs: 100,
	}
	fw, _ := watcher.NewFSNotifyWatcher(watcherConfig)

	return &App{
		dirReader:   filesystem.NewDirectoryReader(osFS),
		fileReader:  filesystem.NewFileReader(osFS),
		fileWriter:  filesystem.NewFileWriter(osFS),
		fileWatcher: fw,
	}
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
func (a *App) ReadDirectory(path string) ([]filesystem.FileEntry, error) {
	return a.dirReader.ReadDirectory(path)
}

// ReadFile reads a file and returns its contents with metadata.
// Detects encoding (UTF-8, UTF-16, Latin-1) and line endings.
// This is exposed to the frontend via Wails bindings.
func (a *App) ReadFile(path string) (*filesystem.FileContent, error) {
	return a.fileReader.ReadFileWithMetadata(path)
}

// WriteFile writes content to a file with optional encoding and line ending settings.
// This is exposed to the frontend via Wails bindings.
func (a *App) WriteFile(path string, content string, encoding string, lineEndings string, createBackup bool) error {
	opts := &filesystem.WriteOptions{
		Encoding:     encoding,
		LineEndings:  lineEndings,
		CreateBackup: createBackup,
		CreateDirs:   true,
	}
	return a.fileWriter.WriteFileWithOptions(path, content, opts)
}

// StartWatching starts watching the given path for file changes.
// Events are emitted to the frontend via "file:changed" event.
// This is exposed to the frontend via Wails bindings.
func (a *App) StartWatching(path string) error {
	return a.fileWatcher.Watch(a.ctx, path, func(event watcher.FileEvent) {
		runtime.EventsEmit(a.ctx, "file:changed", event)
	})
}

// StopWatching stops watching for file changes.
// This is exposed to the frontend via Wails bindings.
func (a *App) StopWatching() error {
	return a.fileWatcher.Stop()
}

// IsWatching returns true if currently watching a path.
// This is exposed to the frontend via Wails bindings.
func (a *App) IsWatching() bool {
	return a.fileWatcher.IsWatching()
}

// GetWatchedPath returns the currently watched path.
// This is exposed to the frontend via Wails bindings.
func (a *App) GetWatchedPath() string {
	return a.fileWatcher.WatchedPath()
}

package main

import (
	"firn/internal/filesystem"
	"firn/internal/terminal"
	"firn/internal/watcher"
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App represents the main application structure for Firn IDE.
// It holds the application context for Wails runtime interactions.
type App struct {
	ctx         context.Context
	dirReader   *filesystem.DirectoryReader
	fileReader  *filesystem.FileReader
	fileWriter  *filesystem.FileWriter
	fileWatcher watcher.Watcher
	termManager *terminal.Manager
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
		termManager: terminal.NewManager(),
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

// OpenFolderDialog opens a native folder picker dialog.
// Returns the selected folder path, or empty string if cancelled.
// This is exposed to the frontend via Wails bindings.
func (a *App) OpenFolderDialog() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Folder",
	})
}

// ToggleMaximize toggles the window between maximized and restored states.
// This is exposed to the frontend via Wails bindings.
func (a *App) ToggleMaximize() {
	runtime.WindowToggleMaximise(a.ctx)
}

// CreateTerminal creates a new terminal
// This is exposed to the frontend via Wails bindings.
func (a *App) CreateTerminal() (string, error) {
	id, err := a.termManager.Create()
	if err != nil {
		return "", err
	}

	session, _ := a.termManager.Get(id)
	go session.ReadLoop(func(data string) {
		runtime.EventsEmit(a.ctx, "terminal:output", id, data)
	})

	return id, nil
}

// WriteTerminal passes strings from JS
// This is exposed to the frontend via Wails bindings.
func (a *App) WriteTerminal(id string, data string) error {
	return a.termManager.Write(id, []byte(data))
}

// ResizeTerminal passes the new dimensions of the terminal window
// This is exposed to the frontend via Wails bindings.
func (a *App) ResizeTerminal(id string, rows uint16, cols uint16) error {
	return a.termManager.Resize(id, rows, cols)
}

// CloseTerminal terminates the terminal session and removes it from the manager.
// This is exposed to the frontend via Wails bindings.
func (a *App) CloseTerminal(id string) error {
	return a.termManager.Close(id)
}

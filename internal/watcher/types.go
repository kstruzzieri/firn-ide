// Package watcher provides file system watching capabilities for Arc IDE.
package watcher

import "time"

// EventType represents the type of file system change.
type EventType string

const (
	// EventCreated indicates a file or directory was created.
	EventCreated EventType = "created"
	// EventModified indicates a file was modified.
	EventModified EventType = "modified"
	// EventDeleted indicates a file or directory was deleted.
	EventDeleted EventType = "deleted"
	// EventRenamed indicates a file or directory was renamed.
	EventRenamed EventType = "renamed"
)

// FileEvent represents a file system change event.
type FileEvent struct {
	// Type is the kind of change that occurred.
	Type EventType `json:"type"`
	// Path is the absolute path to the affected file or directory.
	Path string `json:"path"`
	// OldPath is the previous path for rename events.
	OldPath string `json:"oldPath,omitempty"`
	// IsDir indicates whether the path is a directory.
	IsDir bool `json:"isDir"`
	// Time is when the event occurred.
	Time time.Time `json:"time"`
}

// WatcherConfig configures the file watcher behavior.
type WatcherConfig struct {
	// DebounceMs is the debounce window in milliseconds.
	// Events for the same path within this window are coalesced.
	// Default: 100ms.
	DebounceMs int
	// ExcludePatterns is a list of patterns to exclude from watching.
	// Supports exact names (e.g., "node_modules") and suffix wildcards (e.g., "*.swp").
	// Default: common build/dependency directories and editor temp files.
	ExcludePatterns []string
}

// DefaultExcludePatterns returns the default patterns to exclude from watching.
func DefaultExcludePatterns() []string {
	return []string{
		"node_modules",
		".git",
		"dist",
		"build",
		".venv",
		"__pycache__",
		".DS_Store",
		"*.swp",
		"*.swo",
		"*~",
	}
}

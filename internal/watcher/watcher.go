package watcher

import "context"

// Watcher defines the interface for file system watching.
// This allows for easy mocking in tests.
type Watcher interface {
	// Watch starts watching the given directory recursively.
	// Events are delivered to the provided callback function.
	// Only one path can be watched at a time; calling Watch again
	// will stop watching the previous path.
	Watch(ctx context.Context, path string, callback func(FileEvent)) error

	// Stop stops watching and cleans up resources.
	Stop() error

	// IsWatching returns true if currently watching a path.
	IsWatching() bool

	// WatchedPath returns the currently watched path, or empty string if not watching.
	WatchedPath() string
}

// EventEmitter defines the interface for emitting events to the frontend.
// This abstracts the Wails runtime for testing.
type EventEmitter interface {
	// Emit sends an event with the given name and data.
	Emit(eventName string, data ...any)
}

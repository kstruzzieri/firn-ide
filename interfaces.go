package main

import (
	"io/fs"
)

// FileSystem defines the interface for file system operations.
// This allows for easy mocking in tests.
type FileSystem interface {
	// ReadDir reads the directory and returns directory entries.
	ReadDir(path string) ([]fs.DirEntry, error)

	// ReadFile reads the entire file and returns its contents.
	ReadFile(path string) ([]byte, error)

	// WriteFile writes data to a file, creating it if necessary.
	WriteFile(path string, data []byte, perm fs.FileMode) error

	// Stat returns file info for the given path.
	Stat(path string) (fs.FileInfo, error)

	// MkdirAll creates a directory and all parent directories.
	MkdirAll(path string, perm fs.FileMode) error

	// Remove removes a file or empty directory.
	Remove(path string) error
}

// ProcessManager defines the interface for managing external processes.
// This allows for easy mocking in tests.
type ProcessManager interface {
	// Start starts a new process with the given command and arguments.
	Start(name string, args ...string) (Process, error)
}

// Process represents a running process.
type Process interface {
	// Wait waits for the process to exit and returns the exit code.
	Wait() (int, error)

	// Kill terminates the process.
	Kill() error

	// Pid returns the process ID.
	Pid() int
}

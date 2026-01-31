// Package filesystem provides file system operations for Flux IDE.
package filesystem

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

// Package filesystem provides file system operations for Firn IDE.
package filesystem

import (
	"errors"
	"fmt"
	"io/fs"
)

var ErrUnsafePath = errors.New("unsafe filesystem path")

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

	// Rename atomically renames (moves) oldpath to newpath, replacing newpath if it exists.
	Rename(oldpath, newpath string) error
}

type lstatFileSystem interface {
	Lstat(path string) (fs.FileInfo, error)
}

type chmodFileSystem interface {
	Chmod(path string, mode fs.FileMode) error
}

// Lstat returns metadata without following the final path component when supported.
func Lstat(fsys FileSystem, path string) (fs.FileInfo, error) {
	if lstatFS, ok := fsys.(lstatFileSystem); ok {
		return lstatFS.Lstat(path)
	}
	return fsys.Stat(path)
}

// EnsureDirPerm creates dir with perm and tightens an existing directory that is
// more permissive than perm. MkdirAll leaves an existing directory's mode alone,
// so installs that predate a tightened mode would otherwise keep the old one
// forever — the ~/.firn tree shipped as 0755 before run history existed.
//
// Creation errors are returned; the tightening is best-effort. A filesystem that
// cannot report a mode or cannot chmod (mocks, exotic backends) still gets the
// directory, because refusing to save state is worse than a loose mode on a
// platform that could never have enforced one. A non-directory in the way is a
// real conflict and is reported.
func EnsureDirPerm(fsys FileSystem, dir string, perm fs.FileMode) error {
	if err := fsys.MkdirAll(dir, perm); err != nil {
		return err
	}
	chmodFS, ok := fsys.(chmodFileSystem)
	if !ok {
		return nil
	}
	info, err := Lstat(fsys, dir)
	if err != nil || info == nil {
		return nil
	}
	if !info.IsDir() {
		return fmt.Errorf("%w: %s is not a directory", ErrUnsafePath, dir)
	}
	if info.Mode().Perm()&^perm.Perm() == 0 {
		return nil
	}
	return chmodFS.Chmod(dir, info.Mode().Perm()&perm.Perm())
}

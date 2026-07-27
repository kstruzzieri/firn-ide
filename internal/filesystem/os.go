package filesystem

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
)

// OS implements FileSystem using the real OS filesystem.
type OS struct{}

// NewOS creates a new OS filesystem implementation.
func NewOS() *OS {
	return &OS{}
}

func (o *OS) ReadDir(path string) ([]fs.DirEntry, error) {
	return os.ReadDir(path)
}

func (o *OS) ReadFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func (o *OS) ReadFileLimited(path string, limit int64) ([]byte, fs.FileInfo, error) {
	file, err := openReadNoFollow(path, false)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, info, fmt.Errorf("%w: %s is not a regular file", ErrUnsafePath, path)
	}
	before, err := os.Lstat(path)
	if err != nil {
		return nil, info, err
	}
	if !before.Mode().IsRegular() || !os.SameFile(before, info) {
		return nil, info, fmt.Errorf("%w: %s changed before open", ErrUnsafePath, path)
	}
	if info.Size() > limit {
		return nil, info, fmt.Errorf("file exceeds %d bytes", limit)
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, info, err
	}
	if int64(len(data)) > limit {
		return nil, info, fmt.Errorf("file exceeds %d bytes", limit)
	}
	if int64(len(data)) != info.Size() {
		return nil, info, fmt.Errorf("file changed during bounded read")
	}
	return data, info, nil
}

func (o *OS) ReadDirLimited(path string, limit int) ([]fs.DirEntry, error) {
	dir, err := openReadNoFollow(path, true)
	if err != nil {
		return nil, err
	}
	defer func() { _ = dir.Close() }()
	opened, err := dir.Stat()
	if err != nil {
		return nil, err
	}
	if !opened.IsDir() {
		return nil, fmt.Errorf("%w: %s is not a directory", ErrUnsafePath, path)
	}
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !before.IsDir() || !os.SameFile(before, opened) {
		return nil, fmt.Errorf("%w: %s changed before open", ErrUnsafePath, path)
	}
	entries, err := dir.ReadDir(limit + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	if len(entries) > limit {
		return nil, fmt.Errorf("directory exceeds %d entries", limit)
	}
	return entries, nil
}

func (o *OS) WriteFile(path string, data []byte, perm fs.FileMode) error {
	return os.WriteFile(path, data, perm)
}

func (o *OS) Stat(path string) (fs.FileInfo, error) {
	return os.Stat(path)
}

func (o *OS) Lstat(path string) (fs.FileInfo, error) {
	return os.Lstat(path)
}

func (o *OS) MkdirAll(path string, perm fs.FileMode) error {
	return os.MkdirAll(path, perm)
}

func (o *OS) Remove(path string) error {
	return os.Remove(path)
}

func (o *OS) Rename(oldpath, newpath string) error {
	return os.Rename(oldpath, newpath)
}

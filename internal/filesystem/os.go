package filesystem

import (
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

func (o *OS) WriteFile(path string, data []byte, perm fs.FileMode) error {
	return os.WriteFile(path, data, perm)
}

func (o *OS) Stat(path string) (fs.FileInfo, error) {
	return os.Stat(path)
}

func (o *OS) MkdirAll(path string, perm fs.FileMode) error {
	return os.MkdirAll(path, perm)
}

func (o *OS) Remove(path string) error {
	return os.Remove(path)
}

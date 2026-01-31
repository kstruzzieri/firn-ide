package filesystem

import (
	"io/fs"
)

// Mock is a test implementation of the FileSystem interface.
type Mock struct {
	ReadDirFunc   func(path string) ([]fs.DirEntry, error)
	ReadFileFunc  func(path string) ([]byte, error)
	WriteFileFunc func(path string, data []byte, perm fs.FileMode) error
	StatFunc      func(path string) (fs.FileInfo, error)
	MkdirAllFunc  func(path string, perm fs.FileMode) error
	RemoveFunc    func(path string) error
}

func (m *Mock) ReadDir(path string) ([]fs.DirEntry, error) {
	if m.ReadDirFunc != nil {
		return m.ReadDirFunc(path)
	}
	return nil, nil
}

func (m *Mock) ReadFile(path string) ([]byte, error) {
	if m.ReadFileFunc != nil {
		return m.ReadFileFunc(path)
	}
	return nil, nil
}

func (m *Mock) WriteFile(path string, data []byte, perm fs.FileMode) error {
	if m.WriteFileFunc != nil {
		return m.WriteFileFunc(path, data, perm)
	}
	return nil
}

func (m *Mock) Stat(path string) (fs.FileInfo, error) {
	if m.StatFunc != nil {
		return m.StatFunc(path)
	}
	return nil, nil
}

func (m *Mock) MkdirAll(path string, perm fs.FileMode) error {
	if m.MkdirAllFunc != nil {
		return m.MkdirAllFunc(path, perm)
	}
	return nil
}

func (m *Mock) Remove(path string) error {
	if m.RemoveFunc != nil {
		return m.RemoveFunc(path)
	}
	return nil
}

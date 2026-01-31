package main

import (
	"io/fs"
	"testing"
	"time"
)

// MockFileSystem is a test implementation of the FileSystem interface.
type MockFileSystem struct {
	ReadDirFunc   func(path string) ([]fs.DirEntry, error)
	ReadFileFunc  func(path string) ([]byte, error)
	WriteFileFunc func(path string, data []byte, perm fs.FileMode) error
	StatFunc      func(path string) (fs.FileInfo, error)
	MkdirAllFunc  func(path string, perm fs.FileMode) error
	RemoveFunc    func(path string) error
}

func (m *MockFileSystem) ReadDir(path string) ([]fs.DirEntry, error) {
	if m.ReadDirFunc != nil {
		return m.ReadDirFunc(path)
	}
	return nil, nil
}

func (m *MockFileSystem) ReadFile(path string) ([]byte, error) {
	if m.ReadFileFunc != nil {
		return m.ReadFileFunc(path)
	}
	return nil, nil
}

func (m *MockFileSystem) WriteFile(path string, data []byte, perm fs.FileMode) error {
	if m.WriteFileFunc != nil {
		return m.WriteFileFunc(path, data, perm)
	}
	return nil
}

func (m *MockFileSystem) Stat(path string) (fs.FileInfo, error) {
	if m.StatFunc != nil {
		return m.StatFunc(path)
	}
	return nil, nil
}

func (m *MockFileSystem) MkdirAll(path string, perm fs.FileMode) error {
	if m.MkdirAllFunc != nil {
		return m.MkdirAllFunc(path, perm)
	}
	return nil
}

func (m *MockFileSystem) Remove(path string) error {
	if m.RemoveFunc != nil {
		return m.RemoveFunc(path)
	}
	return nil
}

// MockProcess is a test implementation of the Process interface.
type MockProcess struct {
	WaitFunc func() (int, error)
	KillFunc func() error
	PidFunc  func() int
}

func (m *MockProcess) Wait() (int, error) {
	if m.WaitFunc != nil {
		return m.WaitFunc()
	}
	return 0, nil
}

func (m *MockProcess) Kill() error {
	if m.KillFunc != nil {
		return m.KillFunc()
	}
	return nil
}

func (m *MockProcess) Pid() int {
	if m.PidFunc != nil {
		return m.PidFunc()
	}
	return 0
}

// MockProcessManager is a test implementation of the ProcessManager interface.
type MockProcessManager struct {
	StartFunc func(name string, args ...string) (Process, error)
}

func (m *MockProcessManager) Start(name string, args ...string) (Process, error) {
	if m.StartFunc != nil {
		return m.StartFunc(name, args...)
	}
	return &MockProcess{}, nil
}

// mockFileInfo implements fs.FileInfo for testing
type mockFileInfo struct {
	name    string
	size    int64
	mode    fs.FileMode
	modTime time.Time
	isDir   bool
}

func (m mockFileInfo) Name() string       { return m.name }
func (m mockFileInfo) Size() int64        { return m.size }
func (m mockFileInfo) Mode() fs.FileMode  { return m.mode }
func (m mockFileInfo) ModTime() time.Time { return m.modTime }
func (m mockFileInfo) IsDir() bool        { return m.isDir }
func (m mockFileInfo) Sys() any            { return nil }

// TestMockFileSystemImplementsInterface verifies MockFileSystem implements FileSystem.
func TestMockFileSystemImplementsInterface(t *testing.T) {
	var _ FileSystem = (*MockFileSystem)(nil)
}

// TestMockProcessManagerImplementsInterface verifies MockProcessManager implements ProcessManager.
func TestMockProcessManagerImplementsInterface(t *testing.T) {
	var _ ProcessManager = (*MockProcessManager)(nil)
}

// TestMockProcessImplementsInterface verifies MockProcess implements Process.
func TestMockProcessImplementsInterface(t *testing.T) {
	var _ Process = (*MockProcess)(nil)
}

// TestMockFileSystemReadFile tests the mock ReadFile implementation.
func TestMockFileSystemReadFile(t *testing.T) {
	mock := &MockFileSystem{
		ReadFileFunc: func(path string) ([]byte, error) {
			return []byte("test content"), nil
		},
	}

	content, err := mock.ReadFile("/test/path")
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if string(content) != "test content" {
		t.Errorf("Expected 'test content', got %q", string(content))
	}
}

// TestMockProcessManagerStart tests the mock Start implementation.
func TestMockProcessManagerStart(t *testing.T) {
	mock := &MockProcessManager{
		StartFunc: func(name string, args ...string) (Process, error) {
			return &MockProcess{
				PidFunc: func() int { return 12345 },
			}, nil
		},
	}

	process, err := mock.Start("echo", "hello")
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if process.Pid() != 12345 {
		t.Errorf("Expected PID 12345, got %d", process.Pid())
	}
}

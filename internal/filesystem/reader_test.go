package filesystem

import (
	"errors"
	"io/fs"
	"testing"
	"time"
)

// mockDirEntry implements fs.DirEntry for testing.
type mockDirEntry struct {
	name  string
	isDir bool
	mode  fs.FileMode
	info  fs.FileInfo
}

func (m *mockDirEntry) Name() string               { return m.name }
func (m *mockDirEntry) IsDir() bool                { return m.isDir }
func (m *mockDirEntry) Type() fs.FileMode          { return m.mode }
func (m *mockDirEntry) Info() (fs.FileInfo, error) { return m.info, nil }

// mockFileInfo implements fs.FileInfo for testing.
type mockFileInfo struct {
	name    string
	size    int64
	mode    fs.FileMode
	modTime time.Time
	isDir   bool
}

func (m *mockFileInfo) Name() string       { return m.name }
func (m *mockFileInfo) Size() int64        { return m.size }
func (m *mockFileInfo) Mode() fs.FileMode  { return m.mode }
func (m *mockFileInfo) ModTime() time.Time { return m.modTime }
func (m *mockFileInfo) IsDir() bool        { return m.isDir }
func (m *mockFileInfo) Sys() any           { return nil }

func TestMockImplementsInterface(t *testing.T) {
	var _ FileSystem = (*Mock)(nil)
}

func TestMockReadFile(t *testing.T) {
	mock := &Mock{
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

func TestReadDirectory_ReturnsEntries(t *testing.T) {
	modTime := time.Now()
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			if path == "/test" {
				return []fs.DirEntry{
					&mockDirEntry{name: "file1.txt", isDir: false},
					&mockDirEntry{name: "file2.go", isDir: false},
					&mockDirEntry{name: "subdir", isDir: true},
				}, nil
			}
			return nil, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{
				name:    "test",
				size:    100,
				modTime: modTime,
				isDir:   false,
			}, nil
		},
	}

	reader := NewDirectoryReader(mockFS)
	entries, err := reader.ReadDirectory("/test")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if len(entries) != 3 {
		t.Errorf("Expected 3 entries, got %d", len(entries))
	}
}

func TestReadDirectory_IncludesMetadata(t *testing.T) {
	modTime := time.Date(2024, 1, 15, 10, 30, 0, 0, time.UTC)
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			return []fs.DirEntry{
				&mockDirEntry{
					name:  "test.txt",
					isDir: false,
					info: &mockFileInfo{
						name:    "test.txt",
						size:    1024,
						modTime: modTime,
						isDir:   false,
					},
				},
			}, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{
				name:    "test.txt",
				size:    1024,
				modTime: modTime,
				isDir:   false,
			}, nil
		},
	}

	reader := NewDirectoryReader(mockFS)
	entries, err := reader.ReadDirectory("/test")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("Expected 1 entry, got %d", len(entries))
	}

	entry := entries[0]
	if entry.Name != "test.txt" {
		t.Errorf("Expected name 'test.txt', got %q", entry.Name)
	}
	if entry.Size != 1024 {
		t.Errorf("Expected size 1024, got %d", entry.Size)
	}
	if !entry.ModTime.Equal(modTime) {
		t.Errorf("Expected modTime %v, got %v", modTime, entry.ModTime)
	}
	if entry.IsDir {
		t.Error("Expected IsDir to be false")
	}
}

func TestReadDirectory_NestedStructure(t *testing.T) {
	modTime := time.Now()
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			switch path {
			case "/test":
				return []fs.DirEntry{
					&mockDirEntry{name: "subdir", isDir: true},
				}, nil
			case "/test/subdir":
				return []fs.DirEntry{
					&mockDirEntry{name: "nested.txt", isDir: false},
				}, nil
			}
			return nil, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{
				size:    100,
				modTime: modTime,
			}, nil
		},
	}

	reader := NewDirectoryReader(mockFS)
	entries, err := reader.ReadDirectory("/test")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("Expected 1 entry, got %d", len(entries))
	}
	if !entries[0].IsDir {
		t.Error("Expected first entry to be a directory")
	}
	if len(entries[0].Children) != 1 {
		t.Errorf("Expected 1 child in subdir, got %d", len(entries[0].Children))
	}
	if entries[0].Children[0].Name != "nested.txt" {
		t.Errorf("Expected nested file name 'nested.txt', got %q", entries[0].Children[0].Name)
	}
}

func TestReadDirectory_RespectsGitignore(t *testing.T) {
	modTime := time.Now()
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			if path == "/test" {
				return []fs.DirEntry{
					&mockDirEntry{name: ".gitignore", isDir: false},
					&mockDirEntry{name: "keep.txt", isDir: false},
					&mockDirEntry{name: "node_modules", isDir: true},
					&mockDirEntry{name: "dist", isDir: true},
				}, nil
			}
			return nil, nil
		},
		ReadFileFunc: func(path string) ([]byte, error) {
			if path == "/test/.gitignore" {
				return []byte("node_modules/\ndist/\n"), nil
			}
			return nil, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{
				size:    100,
				modTime: modTime,
			}, nil
		},
	}

	reader := NewDirectoryReader(mockFS)
	entries, err := reader.ReadDirectory("/test")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Should only have .gitignore and keep.txt, not node_modules or dist
	if len(entries) != 2 {
		t.Errorf("Expected 2 entries (gitignore + keep.txt), got %d", len(entries))
	}

	names := make(map[string]bool)
	for _, e := range entries {
		names[e.Name] = true
	}

	if names["node_modules"] {
		t.Error("node_modules should be filtered by .gitignore")
	}
	if names["dist"] {
		t.Error("dist should be filtered by .gitignore")
	}
}

func TestReadDirectory_HidesDotDirectories(t *testing.T) {
	modTime := time.Now()
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			if path == "/test" {
				return []fs.DirEntry{
					&mockDirEntry{name: ".git", isDir: true},
					&mockDirEntry{name: ".github", isDir: true},
					&mockDirEntry{name: "src", isDir: true},
					&mockDirEntry{name: ".env", isDir: false},
					&mockDirEntry{name: "main.go", isDir: false},
				}, nil
			}
			return nil, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{
				size:    100,
				modTime: modTime,
			}, nil
		},
	}

	reader := NewDirectoryReader(mockFS)
	entries, err := reader.ReadDirectory("/test")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	names := make(map[string]bool)
	for _, e := range entries {
		names[e.Name] = true
	}

	// Dot-directories must be hidden.
	if names[".git"] {
		t.Error(".git directory should be hidden from the tree")
	}
	if names[".github"] {
		t.Error(".github directory should be hidden from the tree")
	}
	// Normal dir and dot-files must remain visible.
	if !names["src"] {
		t.Error("src directory should be visible")
	}
	if !names[".env"] {
		t.Error(".env file should remain visible")
	}
	if !names["main.go"] {
		t.Error("main.go file should be visible")
	}
}

func TestReadDirectory_HandlesPermissionError(t *testing.T) {
	modTime := time.Now()
	permErr := errors.New("permission denied")

	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			switch path {
			case "/test":
				return []fs.DirEntry{
					&mockDirEntry{name: "accessible", isDir: true},
					&mockDirEntry{name: "restricted", isDir: true},
				}, nil
			case "/test/accessible":
				return []fs.DirEntry{
					&mockDirEntry{name: "file.txt", isDir: false},
				}, nil
			case "/test/restricted":
				return nil, permErr
			}
			return nil, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{
				size:    100,
				modTime: modTime,
			}, nil
		},
	}

	reader := NewDirectoryReader(mockFS)
	entries, err := reader.ReadDirectory("/test")

	// Should not return error for permission denied on subdirectory
	if err != nil {
		t.Fatalf("Should not error on subdirectory permission denied: %v", err)
	}

	// Should still return accessible directory
	if len(entries) != 2 {
		t.Errorf("Expected 2 entries, got %d", len(entries))
	}

	// accessible should have children, restricted should have empty children
	for _, entry := range entries {
		if entry.Name == "accessible" && len(entry.Children) != 1 {
			t.Errorf("Expected accessible to have 1 child, got %d", len(entry.Children))
		}
		if entry.Name == "restricted" && len(entry.Children) != 0 {
			t.Errorf("Expected restricted to have 0 children, got %d", len(entry.Children))
		}
	}
}

func TestReadDirectory_InvalidPath(t *testing.T) {
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			return nil, errors.New("no such file or directory")
		},
	}

	reader := NewDirectoryReader(mockFS)
	_, err := reader.ReadDirectory("/nonexistent")

	if err == nil {
		t.Error("Expected error for invalid path")
	}
}

func TestReadDirectory_EmptyDirectory(t *testing.T) {
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			return []fs.DirEntry{}, nil
		},
	}

	reader := NewDirectoryReader(mockFS)
	entries, err := reader.ReadDirectory("/empty")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if entries == nil {
		t.Error("Expected empty slice, got nil")
	}
	if len(entries) != 0 {
		t.Errorf("Expected 0 entries, got %d", len(entries))
	}
}

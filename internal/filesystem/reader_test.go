package filesystem

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
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

func TestReadDirectoryShallow_ImmediateChildrenOnly(t *testing.T) {
	modTime := time.Now()
	calledPaths := map[string]bool{}
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			calledPaths[path] = true
			switch path {
			case "/test":
				return []fs.DirEntry{
					&mockDirEntry{name: "subdir", isDir: true},
					&mockDirEntry{name: "top.txt", isDir: false},
				}, nil
			case "/test/subdir":
				return []fs.DirEntry{
					&mockDirEntry{name: "deep.txt", isDir: false},
				}, nil
			}
			return nil, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{size: 100, modTime: modTime}, nil
		},
	}

	reader := NewDirectoryReader(mockFS)
	entries, err := reader.ReadDirectoryShallow("/test", "/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("want 2 entries, got %d", len(entries))
	}
	if !entries[0].IsDir || entries[0].Name != "subdir" {
		t.Fatalf("want dir 'subdir' first, got %+v", entries[0])
	}
	if entries[0].Children != nil {
		t.Fatalf("want nil children for shallow dir, got %v", entries[0].Children)
	}
	if calledPaths["/test/subdir"] {
		t.Fatalf("shallow read must NOT descend into /test/subdir")
	}
}

func TestReadDirectoryShallow_EmptyDir(t *testing.T) {
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) { return []fs.DirEntry{}, nil },
		StatFunc:    func(path string) (fs.FileInfo, error) { return &mockFileInfo{}, nil },
	}
	entries, err := NewDirectoryReader(mockFS).ReadDirectoryShallow("/empty", "/empty")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("want 0 entries, got %d", len(entries))
	}
}

func TestReadDirectoryShallow_RespectsGitignoreAndDotDirs(t *testing.T) {
	modTime := time.Now()
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			if path == "/test" {
				return []fs.DirEntry{
					&mockDirEntry{name: ".gitignore", isDir: false},
					&mockDirEntry{name: "keep.txt", isDir: false},
					&mockDirEntry{name: "node_modules", isDir: true},
					&mockDirEntry{name: ".git", isDir: true},
				}, nil
			}
			return nil, nil
		},
		ReadFileFunc: func(path string) ([]byte, error) {
			if path == "/test/.gitignore" {
				return []byte("node_modules/\n"), nil
			}
			return nil, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{size: 100, modTime: modTime}, nil
		},
	}
	entries, err := NewDirectoryReader(mockFS).ReadDirectoryShallow("/test", "/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	names := map[string]bool{}
	for _, e := range entries {
		names[e.Name] = true
	}
	if names["node_modules"] || names[".git"] {
		t.Fatalf("gitignore/dot-dir not respected: %v", names)
	}
	if !names[".gitignore"] || !names["keep.txt"] {
		t.Fatalf("expected .gitignore + keep.txt visible: %v", names)
	}
}

func TestReadDirectoryShallow_UsesParentGitignore(t *testing.T) {
	modTime := time.Now()
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			if path == "/test/src" {
				return []fs.DirEntry{
					&mockDirEntry{name: "keep.txt", isDir: false},
					&mockDirEntry{name: "debug.log", isDir: false},
					&mockDirEntry{name: "node_modules", isDir: true},
				}, nil
			}
			return nil, nil
		},
		ReadFileFunc: func(path string) ([]byte, error) {
			if path == "/test/.gitignore" {
				return []byte("node_modules/\n*.log\n"), nil
			}
			return nil, fs.ErrNotExist
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{size: 100, modTime: modTime}, nil
		},
	}
	entries, err := NewDirectoryReader(mockFS).ReadDirectoryShallow("/test/src", "/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 1 || entries[0].Name != "keep.txt" {
		t.Fatalf("expected only keep.txt after parent .gitignore, got %+v", entries)
	}
}

func TestReadDirectory_NestedGitignoreRules(t *testing.T) {
	root := nestedGitignoreFixture(t)

	entries, err := NewDirectoryReader(&OS{}).ReadDirectory(root)
	if err != nil {
		t.Fatalf("ReadDirectory() error = %v", err)
	}
	paths := entryPaths(t, root, entries)

	for _, path := range []string{
		".gitignore",
		"artifacts",
		"builder",
		"builder/root.txt",
		"class-1.txt",
		"keep.tmp",
		"src/.gitignore",
		"src/keep.log",
		"src/nested/.gitignore",
		"src/nested/drop.log",
		"src/nested/local-only.txt",
		"sibling/local-only.txt",
		"sibling/nested-only.txt",
		"sibling/vendor",
	} {
		if !paths[path] {
			t.Errorf("expected %q to be visible", path)
		}
	}
	for _, path := range []string{
		"build",
		"class-a.txt",
		"drop.tmp",
		"artifacts/output.bin",
		"src/drop.log",
		"src/local-only.txt",
		"src/nested/nested-only.txt",
		"src/vendor",
		"sibling/keep.log",
	} {
		if paths[path] {
			t.Errorf("expected %q to be ignored", path)
		}
	}
}

func TestReadDirectoryShallow_NestedGitignoreRules(t *testing.T) {
	root := nestedGitignoreFixture(t)

	tests := []struct {
		path    string
		visible []string
		hidden  []string
	}{
		{root, []string{".gitignore", "artifacts", "builder", "class-1.txt", "keep.tmp", "src", "sibling"}, []string{"build", "class-a.txt", "drop.tmp"}},
		{filepath.Join(root, "artifacts"), nil, []string{"output.bin"}},
		{filepath.Join(root, "src"), []string{".gitignore", "keep.log", "nested"}, []string{"drop.log", "local-only.txt", "vendor"}},
		{filepath.Join(root, "src", "nested"), []string{".gitignore", "drop.log", "local-only.txt"}, []string{"nested-only.txt"}},
		{filepath.Join(root, "src", "vendor"), nil, []string{"dependency.go"}},
		{filepath.Join(root, "sibling"), []string{"local-only.txt", "nested-only.txt", "vendor"}, []string{"keep.log"}},
	}

	reader := NewDirectoryReader(&OS{})
	for _, test := range tests {
		entries, err := reader.ReadDirectoryShallow(test.path, root)
		if err != nil {
			t.Fatalf("ReadDirectoryShallow(%q) error = %v", test.path, err)
		}
		names := make(map[string]bool, len(entries))
		for _, entry := range entries {
			names[entry.Name] = true
		}
		for _, name := range test.visible {
			if !names[name] {
				t.Errorf("ReadDirectoryShallow(%q): expected %q to be visible", test.path, name)
			}
		}
		for _, name := range test.hidden {
			if names[name] {
				t.Errorf("ReadDirectoryShallow(%q): expected %q to be ignored", test.path, name)
			}
		}
	}
}

func TestReadDirectory_MalformedAndEmptyPatternsAreSkipped(t *testing.T) {
	root := t.TempDir()
	writeDirectoryFixture(t, root, map[string]string{
		// "bad[pattern" is an unterminated character class (path.Match rejects
		// it); "/" normalizes to an empty pattern. Both must be dropped at load
		// without disturbing the valid rules around them, and "logs/**" must
		// still match through the double-star fast path.
		".gitignore":      "*.log\nbad[pattern\n/\nlogs/**\n",
		"app.log":         "",
		"keep.txt":        "",
		"bad[pattern":     "",
		"logs/deep/a.txt": "",
		"logs/b.txt":      "",
	})

	entries, err := NewDirectoryReader(&OS{}).ReadDirectory(root)
	if err != nil {
		t.Fatalf("ReadDirectory() error = %v", err)
	}
	paths := entryPaths(t, root, entries)

	for _, p := range []string{"keep.txt", "bad[pattern", "logs"} {
		if !paths[p] {
			t.Errorf("expected %q to be visible (invalid/empty rule must not hide it)", p)
		}
	}
	for _, p := range []string{"app.log", "logs/deep/a.txt", "logs/b.txt"} {
		if paths[p] {
			t.Errorf("expected %q to be ignored by a valid rule", p)
		}
	}
}

func nestedGitignoreFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeDirectoryFixture(t, root, map[string]string{
		".gitignore":                 "*.log\n/build/\nvendor/\n*.tmp\n!keep.tmp\nartifacts/**\nclass-[!0-9].txt\n",
		"artifacts/output.bin":       "",
		"build/root.txt":             "",
		"builder/root.txt":           "",
		"class-1.txt":                "",
		"class-a.txt":                "",
		"drop.tmp":                   "",
		"keep.tmp":                   "",
		"src/.gitignore":             "!keep.log\n/local-only.txt\nnested-only.txt\n",
		"src/keep.log":               "",
		"src/drop.log":               "",
		"src/local-only.txt":         "",
		"src/nested/.gitignore":      "!drop.log\n",
		"src/nested/drop.log":        "",
		"src/nested/local-only.txt":  "",
		"src/nested/nested-only.txt": "",
		"src/vendor/dependency.go":   "",
		"sibling/keep.log":           "",
		"sibling/local-only.txt":     "",
		"sibling/nested-only.txt":    "",
		"sibling/vendor":             "",
	})
	return root
}

func writeDirectoryFixture(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("MkdirAll(%q) error = %v", filepath.Dir(path), err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatalf("WriteFile(%q) error = %v", path, err)
		}
	}
}

func entryPaths(t *testing.T, root string, entries []FileEntry) map[string]bool {
	t.Helper()
	paths := make(map[string]bool)
	var walk func([]FileEntry)
	walk = func(entries []FileEntry) {
		for _, entry := range entries {
			rel, err := filepath.Rel(root, entry.Path)
			if err != nil {
				t.Fatalf("Rel(%q, %q) error = %v", root, entry.Path, err)
			}
			paths[filepath.ToSlash(rel)] = true
			walk(entry.Children)
		}
	}
	walk(entries)
	return paths
}

package filesystem

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
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

func TestReadDirectory_StatFailureKeepsEntryUnreadable(t *testing.T) {
	unknownPath := filepath.Join("/test", "unknown.txt")
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			return []fs.DirEntry{
				&mockDirEntry{name: "healthy.txt"},
				&mockDirEntry{name: "unknown.txt"},
			}, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			if path == unknownPath {
				return nil, errors.New("metadata unavailable")
			}
			return &mockFileInfo{name: "healthy.txt", size: 12, modTime: time.Now()}, nil
		},
	}

	entries, err := NewDirectoryReader(mockFS).ReadDirectory("/test")
	if err != nil {
		t.Fatalf("ReadDirectory(/test): %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("visible DirEntry must not disappear on Stat failure, got %+v", entries)
	}
	if entries[0].Name != "healthy.txt" || entries[0].Unreadable {
		t.Errorf("healthy entry changed: %+v", entries[0])
	}
	if entries[1].Name != "unknown.txt" || entries[1].Path != unknownPath || !entries[1].Unreadable {
		t.Errorf("failed metadata must remain visible and marked unreadable: %+v", entries[1])
	}
}

func TestReadDirectory_StatFailureDoesNotDescend(t *testing.T) {
	restrictedPath := filepath.Join("/test", "restricted")
	readablePath := filepath.Join("/test", "readable")
	restrictedRead := false
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			switch path {
			case "/test":
				return []fs.DirEntry{
					&mockDirEntry{name: "restricted", isDir: true},
					&mockDirEntry{name: "readable", isDir: true},
				}, nil
			case restrictedPath:
				restrictedRead = true
				return []fs.DirEntry{&mockDirEntry{name: "unknown.txt"}}, nil
			case readablePath:
				return []fs.DirEntry{&mockDirEntry{name: "visible.txt"}}, nil
			}
			return nil, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			if path == restrictedPath {
				return nil, errors.New("metadata unavailable")
			}
			return &mockFileInfo{modTime: time.Now()}, nil
		},
	}

	entries, err := NewDirectoryReader(mockFS).ReadDirectory("/test")
	if err != nil {
		t.Fatalf("ReadDirectory(/test): %v", err)
	}
	if restrictedRead {
		t.Fatal("must not descend after the directory metadata read failed")
	}
	if !entries[1].Unreadable || entries[1].Children != nil {
		t.Errorf("restricted directory must stay visible, marked, and unloaded: %+v", entries[1])
	}
	if len(entries[0].Children) != 1 || entries[0].Children[0].Name != "visible.txt" {
		t.Errorf("readable sibling descendants changed: %+v", entries[0])
	}
}

func TestFileEntryJSON_OmitsFalseAndCarriesTrueUnreadable(t *testing.T) {
	readable, err := json.Marshal(FileEntry{Name: "readable"})
	if err != nil {
		t.Fatalf("Marshal(readable): %v", err)
	}
	if strings.Contains(string(readable), "Unreadable") || strings.Contains(string(readable), "unreadable") {
		t.Fatalf("readable JSON must omit unreadable, got %s", readable)
	}

	unreadable, err := json.Marshal(FileEntry{Name: "restricted", Unreadable: true})
	if err != nil {
		t.Fatalf("Marshal(unreadable): %v", err)
	}
	if !strings.Contains(string(unreadable), `"unreadable":true`) {
		t.Fatalf("unreadable JSON must carry the optional marker, got %s", unreadable)
	}
}

func TestReadDirectory_NestedStructure(t *testing.T) {
	modTime := time.Now()
	root := filepath.FromSlash("/test")
	subdir := filepath.Join(root, "subdir")
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			switch path {
			case root:
				return []fs.DirEntry{
					&mockDirEntry{name: "subdir", isDir: true},
				}, nil
			case subdir:
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
	entries, err := reader.ReadDirectory(root)

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
	root := filepath.FromSlash("/test")
	gitignorePath := filepath.Join(root, ".gitignore")
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			if path == root {
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
			if path == gitignorePath {
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
	entries, err := reader.ReadDirectory(root)

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
	root := filepath.FromSlash("/test")
	accessiblePath := filepath.Join(root, "accessible")
	restrictedPath := filepath.Join(root, "restricted")

	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			switch path {
			case root:
				return []fs.DirEntry{
					&mockDirEntry{name: "accessible", isDir: true},
					&mockDirEntry{name: "restricted", isDir: true},
				}, nil
			case accessiblePath:
				return []fs.DirEntry{
					&mockDirEntry{name: "file.txt", isDir: false},
				}, nil
			case restrictedPath:
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
	entries, err := reader.ReadDirectory(root)

	// Should not return error for permission denied on subdirectory
	if err != nil {
		t.Fatalf("Should not error on subdirectory permission denied: %v", err)
	}

	// Should still return accessible directory
	if len(entries) != 2 {
		t.Errorf("Expected 2 entries, got %d", len(entries))
	}

	// accessible should have children, restricted should remain unreadable and unloaded
	for _, entry := range entries {
		if entry.Name == "accessible" {
			if entry.Unreadable {
				t.Error("Expected accessible to remain readable")
			}
			if len(entry.Children) != 1 {
				t.Errorf("Expected accessible to have 1 child, got %d", len(entry.Children))
			}
		}
		if entry.Name == "restricted" {
			if !entry.Unreadable {
				t.Error("Expected restricted to be marked unreadable")
			}
			if entry.Children != nil {
				t.Errorf("Expected restricted children to remain unknown, got %v", entry.Children)
			}
		}
	}
}

func TestReadDirectory_PermissionSmoke(t *testing.T) {
	root := t.TempDir()
	writeDirectoryFixture(t, root, map[string]string{
		"readable/file.txt":     "",
		"restricted/hidden.txt": "",
	})
	restrictedPath := filepath.Join(root, "restricted")
	if err := os.Chmod(restrictedPath, 0); err != nil {
		t.Skipf("cannot create an unreadable directory on this platform: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chmod(restrictedPath, 0o755); err != nil {
			t.Errorf("restore restricted directory permissions: %v", err)
		}
	})
	if _, err := os.ReadDir(restrictedPath); err == nil {
		t.Skip("mode 000 does not deny directory reads for this platform or account")
	}

	entries, err := NewDirectoryReader(&OS{}).ReadDirectory(root)
	if err != nil {
		t.Fatalf("ReadDirectory(root): %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("want both readable and restricted siblings, got %+v", entries)
	}
	for _, entry := range entries {
		switch entry.Name {
		case "readable":
			if entry.Unreadable || len(entry.Children) != 1 {
				t.Errorf("readable sibling changed: %+v", entry)
			}
		case "restricted":
			if !entry.Unreadable {
				t.Errorf("restricted sibling must be marked unreadable: %+v", entry)
			}
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
	root := filepath.FromSlash("/test")
	subdir := filepath.Join(root, "subdir")
	calledPaths := map[string]bool{}
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			calledPaths[path] = true
			switch path {
			case root:
				return []fs.DirEntry{
					&mockDirEntry{name: "subdir", isDir: true},
					&mockDirEntry{name: "top.txt", isDir: false},
				}, nil
			case subdir:
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
	entries, err := reader.ReadDirectoryShallow(root, root)
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
	if calledPaths[subdir] {
		t.Fatalf("shallow read must NOT descend into %s", subdir)
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

func TestReadDirectoryShallow_RootFailureReturnsError(t *testing.T) {
	permissionErr := errors.New("permission denied")
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			return nil, permissionErr
		},
	}

	_, err := NewDirectoryReader(mockFS).ReadDirectoryShallow("/test", "/test")
	if !errors.Is(err, permissionErr) {
		t.Fatalf("root failure must remain actionable, got %v", err)
	}
}

func TestReadDirectoryShallow_RespectsGitignoreAndDotDirs(t *testing.T) {
	modTime := time.Now()
	root := filepath.FromSlash("/test")
	gitignorePath := filepath.Join(root, ".gitignore")
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			if path == root {
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
			if path == gitignorePath {
				return []byte("node_modules/\n"), nil
			}
			return nil, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{size: 100, modTime: modTime}, nil
		},
	}
	entries, err := NewDirectoryReader(mockFS).ReadDirectoryShallow(root, root)
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
	root := filepath.FromSlash("/test")
	src := filepath.Join(root, "src")
	gitignorePath := filepath.Join(root, ".gitignore")
	mockFS := &Mock{
		ReadDirFunc: func(path string) ([]fs.DirEntry, error) {
			if path == src {
				return []fs.DirEntry{
					&mockDirEntry{name: "keep.txt", isDir: false},
					&mockDirEntry{name: "debug.log", isDir: false},
					&mockDirEntry{name: "node_modules", isDir: true},
				}, nil
			}
			return nil, nil
		},
		ReadFileFunc: func(path string) ([]byte, error) {
			if path == gitignorePath {
				return []byte("node_modules/\n*.log\n"), nil
			}
			return nil, fs.ErrNotExist
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			return &mockFileInfo{size: 100, modTime: modTime}, nil
		},
	}
	entries, err := NewDirectoryReader(mockFS).ReadDirectoryShallow(src, root)
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

// trackedIgnoredFixture is a workspace whose .gitignore matches files git
// tracks (#536): CLAUDE.md was committed before "**/CLAUDE.md" was added, and
// data/kaggle/a.csv was committed before "data/" was. Untracked files beside
// them, and the untracked-only cache/ folder, stay hidden.
func trackedIgnoredFixture(t *testing.T) (*DirectoryReader, string) {
	t.Helper()
	root := t.TempDir()
	writeDirectoryFixture(t, root, map[string]string{
		".gitignore":          "**/CLAUDE.md\ndata/\ncache/\n*.log\n",
		"CLAUDE.md":           "tracked",
		"keep.txt":            "",
		"untracked.log":       "",
		"data/top.csv":        "",
		"data/kaggle/a.csv":   "tracked",
		"data/kaggle/u.csv":   "",
		"data/kaggle/.hidden": "",
		"data/raw/u.csv":      "",
		"cache/u.bin":         "",
	})
	reader := NewDirectoryReader(&OS{})
	reader.SetTrackedIgnored(root, []string{"CLAUDE.md", "data/kaggle/a.csv"})
	return reader, root
}

func TestReadDirectory_ListsTrackedFilesIgnoreRulesMatch(t *testing.T) {
	reader, root := trackedIgnoredFixture(t)

	entries, err := reader.ReadDirectory(root)
	if err != nil {
		t.Fatalf("ReadDirectory() error = %v", err)
	}
	paths := entryPaths(t, root, entries)
	want := map[string]bool{
		".gitignore":        true,
		"CLAUDE.md":         true,
		"keep.txt":          true,
		"data":              true,
		"data/kaggle":       true,
		"data/kaggle/a.csv": true,
	}
	for path := range want {
		if !paths[path] {
			t.Errorf("expected %q to be visible", path)
		}
	}
	for path := range paths {
		if !want[path] {
			t.Errorf("expected %q to stay hidden", path)
		}
	}
}

func TestReadDirectoryShallow_ListsTrackedFilesIgnoreRulesMatch(t *testing.T) {
	reader, root := trackedIgnoredFixture(t)

	tests := []struct {
		path string
		want []string
	}{
		{root, []string{"data", ".gitignore", "CLAUDE.md", "keep.txt"}},
		// Inside an ignored folder only the tracked files and the folders
		// leading to them are listed, though no rule matches them on their own.
		{filepath.Join(root, "data"), []string{"kaggle"}},
		{filepath.Join(root, "data", "kaggle"), []string{"a.csv"}},
		{filepath.Join(root, "data", "raw"), nil},
		{filepath.Join(root, "cache"), nil},
	}
	for _, test := range tests {
		entries, err := reader.ReadDirectoryShallow(test.path, root)
		if err != nil {
			t.Fatalf("ReadDirectoryShallow(%q) error = %v", test.path, err)
		}
		var got []string
		for _, entry := range entries {
			got = append(got, entry.Name)
		}
		if strings.Join(got, ",") != strings.Join(test.want, ",") {
			t.Errorf("ReadDirectoryShallow(%q) = %v, want %v", test.path, got, test.want)
		}
	}
}

// TestReadDirectory_ReopenedRootIsListedAgain: one workspace is open at a
// time, and a root's set goes stale while another is open (its .gitignore can
// change meanwhile). Opening another root forgets the first, so reopening it
// lists it afresh rather than restoring the tree against the old set.
func TestReadDirectory_ReopenedRootIsListedAgain(t *testing.T) {
	_, root := trackedIgnoredFixture(t)
	reader := NewDirectoryReader(&OS{})
	listed := map[string]int{}
	reader.SetTrackedLister(func(root string) []string {
		listed[root]++
		return []string{"CLAUDE.md"}
	}, nil)
	other := filepath.Join(root, "data")

	for _, read := range []string{root, other, root} {
		if _, err := reader.ReadDirectoryShallow(read, read); err != nil {
			t.Fatal(err)
		}
	}
	if listed[root] != 2 || listed[other] != 1 {
		t.Fatalf("lister calls = %v, want %s twice and %s once", listed, root, other)
	}
}

func TestSetTrackedIgnored_ReportsFoldersWhoseListingsChange(t *testing.T) {
	root := filepath.FromSlash("/ws")
	reader := NewDirectoryReader(&Mock{})
	abs := func(rels ...string) []string {
		out := make([]string, 0, len(rels))
		for _, rel := range rels {
			out = append(out, filepath.Join(root, filepath.FromSlash(rel)))
		}
		return out
	}

	steps := []struct {
		paths []string
		want  []string
	}{
		// An unknown root counts as an empty set.
		{nil, nil},
		{[]string{"data/kaggle/a.csv"}, abs(".", "data", "data/kaggle")},
		{[]string{"data/kaggle/a.csv"}, nil},
		{[]string{"data/kaggle/a.csv", "CLAUDE.md"}, abs(".")},
		{nil, abs(".", "data", "data/kaggle")},
	}
	for i, step := range steps {
		got := reader.SetTrackedIgnored(root, step.paths)
		if strings.Join(got, "|") != strings.Join(step.want, "|") {
			t.Errorf("step %d: SetTrackedIgnored(%v) = %v, want %v", i, step.paths, got, step.want)
		}
	}
}

func TestTrackedIgnoredFiles_ListsExistingFilesOutsideDotFolders(t *testing.T) {
	reader, root := trackedIgnoredFixture(t)
	writeDirectoryFixture(t, root, map[string]string{".github/ci.yml": "", ".env": ""})
	reader.SetTrackedIgnored(root, []string{
		"CLAUDE.md",
		"data/kaggle/a.csv",
		".env",
		// #450 decides how search treats dot-folders.
		".github/ci.yml",
		// Deleted from the working tree but still in the index: ripgrep fails
		// the whole search on a missing path.
		"gone.txt",
	})

	got := reader.TrackedIgnoredFiles(root)
	want := []string{
		filepath.Join(root, ".env"),
		filepath.Join(root, "CLAUDE.md"),
		filepath.Join(root, "data", "kaggle", "a.csv"),
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("TrackedIgnoredFiles() = %v, want %v", got, want)
	}
	if other := reader.TrackedIgnoredFiles(filepath.Join(root, "data")); len(other) != 0 {
		t.Fatalf("a root with no set has no files, got %v", other)
	}
}

func TestSetTrackedLister_ListsAnUnknownRootOnce(t *testing.T) {
	_, root := trackedIgnoredFixture(t)
	reader := NewDirectoryReader(&OS{})
	var listed []string
	reader.SetTrackedLister(func(root string) []string {
		listed = append(listed, root)
		return []string{"CLAUDE.md"}
	}, nil)

	for range 2 {
		entries, err := reader.ReadDirectoryShallow(root, root)
		if err != nil {
			t.Fatal(err)
		}
		if !entryPaths(t, root, entries)["CLAUDE.md"] {
			t.Fatalf("the lister's set must apply to the first read: %+v", entries)
		}
	}
	if len(listed) != 1 || listed[0] != root {
		t.Fatalf("lister calls = %v, want one for %s", listed, root)
	}

	// A root git status already covered, even with an empty set, is known.
	other := filepath.Join(root, "data")
	reader.SetTrackedIgnored(other, nil)
	if _, err := reader.ReadDirectoryShallow(other, other); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 {
		t.Fatalf("lister ran for a root SetTrackedIgnored covered: %v", listed)
	}
}

// TestSetTrackedIgnored_LateOtherRootKeepsTheBaseline: a git status for the
// previous workspace can land after a switch. It must not erase the open
// workspace's set, which its next refresh diffs against: erased, removing
// the last tracked, ignored file would name no folder to re-read.
func TestSetTrackedIgnored_LateOtherRootKeepsTheBaseline(t *testing.T) {
	open, previous := filepath.FromSlash("/ws/b"), filepath.FromSlash("/ws/a")
	reader := NewDirectoryReader(&Mock{})
	reader.SetTrackedIgnored(open, []string{"CLAUDE.md"})
	reader.SetTrackedIgnored(previous, []string{"x.md"})

	if got := reader.SetTrackedIgnored(open, nil); strings.Join(got, "|") != open {
		t.Fatalf("SetTrackedIgnored(open, nil) = %v, want [%s]", got, open)
	}
}

// TestSetTrackedLister_StatusDuringARelistWins: a git status for a root that
// lands while a read is listing that root is newer than the listing, even
// when another root's status lands after it: the listing must not replace it.
func TestSetTrackedLister_StatusDuringARelistWins(t *testing.T) {
	root, other := filepath.FromSlash("/ws/a"), filepath.FromSlash("/ws/b")
	reader := NewDirectoryReader(&Mock{})
	started, release := make(chan struct{}), make(chan struct{})
	reader.SetTrackedLister(func(string) []string {
		close(started)
		<-release
		return []string{"old.md"}
	}, nil)
	reader.SetTrackedIgnored(other, nil)

	done := make(chan struct{})
	go func() {
		defer close(done)
		reader.TrackedIgnoredFiles(root)
	}()
	<-started
	reader.SetTrackedIgnored(root, []string{"new.md"})
	reader.SetTrackedIgnored(other, nil)
	close(release)
	<-done

	if got := reader.SetTrackedIgnored(root, []string{"new.md"}); len(got) != 0 {
		t.Fatalf("the listing replaced the newer set: SetTrackedIgnored(root, [new.md]) = %v, want none", got)
	}
}

// TestSetTrackedLister_RelistReportsFoldersWhoseListingsChange: reopening a
// root lists it again, and the tree may still hold listings drawn from the
// set it had. A listing that moves that set names the folders to re-read, as
// a git status would; a root's first listing replaces nothing a read used.
func TestSetTrackedLister_RelistReportsFoldersWhoseListingsChange(t *testing.T) {
	root, other := filepath.FromSlash("/ws/a"), filepath.FromSlash("/ws/b")
	reader := NewDirectoryReader(&Mock{})
	var reported [][]string
	reader.SetTrackedLister(func(string) []string {
		return []string{"data/a.csv"}
	}, func(dirs []string) {
		reported = append(reported, dirs)
	})

	reader.TrackedIgnoredFiles(root)
	if len(reported) != 0 {
		t.Fatalf("a first listing reported %v, want nothing", reported)
	}
	reader.SetTrackedIgnored(root, []string{"CLAUDE.md"})
	reader.SetTrackedIgnored(other, nil)
	reader.TrackedIgnoredFiles(root)
	want := []string{root, filepath.Join(root, "data")}
	if len(reported) != 1 || strings.Join(reported[0], "|") != strings.Join(want, "|") {
		t.Fatalf("relisting reported %v, want one report naming %v", reported, want)
	}
}

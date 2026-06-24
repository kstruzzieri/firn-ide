package filesystem

import (
	"bytes"
	"io/fs"
	"testing"
)

// newStatefulMock returns a Mock backed by an in-memory map of path -> bytes,
// wiring WriteFile/ReadFile/Rename so the rename semantics can be exercised the
// same way the rest of the codebase drives the Mock (closures over a map).
func newStatefulMock() (*Mock, map[string][]byte) {
	files := map[string][]byte{}
	m := &Mock{
		WriteFileFunc: func(path string, data []byte, _ fs.FileMode) error {
			b := make([]byte, len(data))
			copy(b, data)
			files[path] = b
			return nil
		},
		ReadFileFunc: func(path string) ([]byte, error) {
			data, ok := files[path]
			if !ok {
				return nil, fs.ErrNotExist
			}
			return data, nil
		},
		RenameFunc: func(oldpath, newpath string) error {
			data, ok := files[oldpath]
			if !ok {
				return fs.ErrNotExist
			}
			files[newpath] = data
			delete(files, oldpath)
			return nil
		},
	}
	return m, files
}

func TestMockRenameMovesBytes(t *testing.T) {
	m, _ := newStatefulMock()

	want := []byte("hello world")
	if err := m.WriteFile("/a.txt", want, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	if err := m.Rename("/a.txt", "/b.txt"); err != nil {
		t.Fatalf("Rename: %v", err)
	}

	// Old path is gone.
	if _, err := m.ReadFile("/a.txt"); err == nil {
		t.Errorf("expected old path to be gone after Rename, but ReadFile succeeded")
	}

	// New path has the bytes.
	got, err := m.ReadFile("/b.txt")
	if err != nil {
		t.Fatalf("ReadFile(new): %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("expected new path to hold %q, got %q", want, got)
	}
}

func TestMockRenameMissingSourceErrors(t *testing.T) {
	m, _ := newStatefulMock()

	if err := m.Rename("/missing.txt", "/dest.txt"); err == nil {
		t.Fatal("expected error renaming a missing source, got nil")
	}
}

func TestMockRenameNoHookIsNoop(t *testing.T) {
	// A Mock without a RenameFunc must behave like the other unconfigured
	// methods: return nil rather than panic.
	m := &Mock{}
	if err := m.Rename("/x", "/y"); err != nil {
		t.Errorf("expected nil from unconfigured Rename, got %v", err)
	}
}

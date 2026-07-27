package filesystem

import (
	"errors"
	"io/fs"
	"strings"
	"testing"
)

func TestWriteFileAtomicCleansTempAfterRenameFailure(t *testing.T) {
	renameErr := errors.New("rename failed")
	var tempPath, removedPath string
	mock := &Mock{
		WriteFileFunc: func(path string, _ []byte, mode fs.FileMode) error {
			tempPath = path
			if mode.Perm() != 0o600 {
				t.Fatalf("temp mode = %o, want 0600", mode.Perm())
			}
			return nil
		},
		RenameFunc: func(_, _ string) error { return renameErr },
		RemoveFunc: func(path string) error {
			removedPath = path
			return nil
		},
	}

	err := WriteFileAtomic(mock, "/data/state.json", []byte("{}"), 0o600)
	if !errors.Is(err, renameErr) {
		t.Fatalf("WriteFileAtomic error = %v, want rename error", err)
	}
	if !strings.HasPrefix(tempPath, "/data/state.json.") || removedPath != tempPath {
		t.Fatalf("temp %q was not cleaned up; removed %q", tempPath, removedPath)
	}
}

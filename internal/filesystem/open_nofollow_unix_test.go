//go:build darwin || linux

package filesystem

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestOpenReadNoFollowDoesNotBlockOnFIFO(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pipe")
	if err := syscall.Mkfifo(path, 0o600); err != nil {
		t.Fatalf("Mkfifo: %v", err)
	}

	type result struct {
		file *os.File
		err  error
	}
	done := make(chan result, 1)
	go func() {
		file, err := openReadNoFollow(path, false)
		done <- result{file: file, err: err}
	}()

	select {
	case opened := <-done:
		if opened.err != nil {
			t.Fatalf("openReadNoFollow: %v", opened.err)
		}
		_ = opened.file.Close()
	case <-time.After(500 * time.Millisecond):
		t.Fatal("openReadNoFollow blocked on a FIFO")
	}

	if _, _, err := NewOS().ReadFileLimited(path, 1); !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("ReadFileLimited error = %v, want ErrUnsafePath", err)
	}
}

func TestOpenReadNoFollowRejectsSymlink(t *testing.T) {
	target := filepath.Join(t.TempDir(), "target")
	if err := os.WriteFile(target, []byte("secret"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("Symlink: %v", err)
	}

	if file, err := openReadNoFollow(link, false); !errors.Is(err, ErrUnsafePath) {
		if file != nil {
			_ = file.Close()
		}
		t.Fatalf("openReadNoFollow error = %v, want ErrUnsafePath", err)
	}
	if _, _, err := NewOS().ReadFileLimited(link, 10); !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("ReadFileLimited error = %v, want ErrUnsafePath", err)
	}
}

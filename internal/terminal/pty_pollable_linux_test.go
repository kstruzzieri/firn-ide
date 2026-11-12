package terminal

import (
	"os"
	"syscall"
	"testing"
)

// TestPollableMasterKeepsOriginalWhenPollerRefuses: a non-blocking file the
// poller does not manage fails a read that would have to wait with EAGAIN.
// For a terminal that ends ReadLoop at once and leaves the tab dead, so when
// the poller turns the descriptor down the blocking original must come back.
//
// Linux only: the case needs a descriptor the poller refuses. epoll refuses a
// regular file; kqueue accepts one.
func TestPollableMasterKeepsOriginalWhenPollerRefuses(t *testing.T) {
	regular, err := os.CreateTemp(t.TempDir(), "not-pollable")
	if err != nil {
		t.Fatalf("CreateTemp() returned error: %v", err)
	}
	defer func() { _ = regular.Close() }()

	got := pollableMaster(regular)
	if got != regular {
		_ = got.Close()
		t.Fatal("pollableMaster returned a new file for a descriptor the poller refused")
	}

	flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, regular.Fd(), syscall.F_GETFL, 0)
	if errno != 0 {
		t.Fatalf("fcntl(F_GETFL) on the original file failed, so it was closed: %v", errno)
	}
	if flags&syscall.O_NONBLOCK != 0 {
		t.Error("the original file was left non-blocking")
	}
}

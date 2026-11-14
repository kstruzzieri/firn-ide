//go:build !windows

package terminal

import (
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// TestNewSessionMasterStaysPollableAfterResize is the check for #558 that does
// not depend on timing. Session.Close can only interrupt ReadLoop when the PTY
// master is non-blocking and in Go's poller, and it has to stay that way
// through Resize, whose ioctl reaches the descriptor through (*os.File).Fd().
func TestNewSessionMasterStaysPollableAfterResize(t *testing.T) {
	requirePTY(t)
	session, err := NewSession("")
	if err != nil {
		t.Fatalf("NewSession() returned error: %v", err)
	}
	defer func() { _ = session.Close() }()

	if err := session.Resize(30, 100); err != nil {
		t.Fatalf("Resize() returned error: %v", err)
	}

	flags, err := unix.FcntlInt(session.pty.Fd(), unix.F_GETFL, 0)
	if err != nil {
		t.Fatalf("fcntl(F_GETFL) on the PTY master failed: %v", err)
	}
	if flags&unix.O_NONBLOCK == 0 {
		t.Error("the PTY master is in blocking mode")
	}
	if err := session.pty.SetDeadline(time.Time{}); err != nil {
		t.Errorf("Go's poller does not manage the PTY master: %v", err)
	}
}

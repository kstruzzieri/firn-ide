package terminal

import (
	"sync"
	"testing"

	"github.com/creack/pty"
)

var (
	ptyCheckOnce sync.Once
	ptyAvailable bool
)

// requirePTY skips the calling test when the environment cannot allocate a
// pseudo-terminal. Headless CI and sandboxed runs have no controlling TTY, so
// opening /dev/ptmx fails with "device not configured"; the PTY-backed terminal
// paths are inherently untestable there. Any environment that provides a real
// terminal device (a developer shell, a PTY-enabled CI runner) still runs them.
// The probe result is cached so the check costs one pty.Open across the package.
func requirePTY(t *testing.T) {
	t.Helper()
	ptyCheckOnce.Do(func() {
		master, slave, err := pty.Open()
		if err != nil {
			return
		}
		_ = slave.Close()
		_ = master.Close()
		ptyAvailable = true
	})
	if !ptyAvailable {
		t.Skip("skipping: no pseudo-terminal available in this environment")
	}
}

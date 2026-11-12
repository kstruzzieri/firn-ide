//go:build !windows

package terminal

import (
	"os"
	"syscall"
	"time"
)

// pollableMaster returns the PTY master as a file that Go's poller manages,
// and closes ptmx. If it cannot, because the descriptor cannot be duplicated
// or the poller will not take it, it returns ptmx as it was, and Session.Close
// keeps the old behavior described next.
//
// Close cannot interrupt a Read on a blocking file: Go puts the real close(2)
// off until that read returns. ReadLoop sits in such a read whenever the shell
// is quiet, so the master stayed open, the kernel never hung the shell up, and
// Session.Close ran out its grace period and killed the shell (#558).
// creack/pty returns a blocking master on both platforms Firn runs a terminal
// on: on macOS by design (golang/go#22099), on Linux because its ioctl helper
// calls Fd().
//
// A descriptor that is already non-blocking when os.NewFile receives it is
// offered to the poller and, once accepted, stays there. Unlike a file Go made
// non-blocking itself, Fd() leaves it alone, and pty.Setsize calls Fd() on
// every resize.
func pollableMaster(ptmx *os.File) *os.File {
	// ForkLock stops a concurrent fork from inheriting the duplicate before it
	// is close-on-exec; a copy in another process would hold the PTY open.
	syscall.ForkLock.RLock()
	fd, err := syscall.Dup(int(ptmx.Fd()))
	if err == nil {
		syscall.CloseOnExec(fd)
	}
	syscall.ForkLock.RUnlock()
	if err != nil {
		return ptmx
	}
	// O_NONBLOCK belongs to the open file description the two descriptors
	// share. The shell's end of the terminal is a separate one and stays
	// blocking.
	if err := syscall.SetNonblock(fd, true); err != nil {
		_ = syscall.Close(fd)
		return ptmx
	}
	pollable := os.NewFile(uintptr(fd), ptmx.Name())
	// Only a file the poller manages accepts a deadline. One it turned down
	// must not be used: non-blocking and unmanaged, its reads fail with EAGAIN
	// instead of waiting, which would end ReadLoop at once.
	if err := pollable.SetDeadline(time.Time{}); err != nil {
		_ = syscall.SetNonblock(fd, false)
		_ = pollable.Close()
		return ptmx
	}
	_ = ptmx.Close()
	return pollable
}

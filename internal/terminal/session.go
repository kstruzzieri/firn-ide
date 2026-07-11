package terminal

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"time"

	"github.com/creack/pty"
)

type Session struct {
	cmd     *exec.Cmd
	pty     *os.File
	running bool
}

func defaultShell() string {
	if runtime.GOOS == "windows" {
		if ps, err := exec.LookPath("powershell.exe"); err == nil {
			return ps
		}
		return "cmd.exe"
	}
	return "/bin/sh"
}

// NewSession starts a shell in dir (the loaded workspace root). An empty,
// missing, or non-directory dir falls back to inheriting the app process's
// working directory rather than failing terminal creation — the workspace may
// have been deleted since it was recorded.
func NewSession(dir string) (*Session, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = defaultShell()
	}
	cacheRoot, _ := os.UserCacheDir() // empty on error → integratedCommand falls open to plain
	cmd := integratedCommand(shell, cacheRoot)
	if dir != "" {
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			cmd.Dir = dir
		}
	}
	ptmx, err := pty.Start(cmd)
	if err != nil {
		// ENXIO ("device not configured") from /dev/ptmx means the system PTY
		// pool is exhausted (macOS caps it at kern.tty.ptmx_max). Surface an
		// actionable message instead of the raw errno.
		if errors.Is(err, syscall.ENXIO) {
			return nil, fmt.Errorf(
				"no pseudo-terminals available: the system PTY limit (kern.tty.ptmx_max) is exhausted — close terminal-heavy apps or raise the limit: %w",
				err,
			)
		}
		return nil, fmt.Errorf("starting shell %q: %w", shell, err)
	}
	return &Session{cmd: cmd, running: true, pty: ptmx}, nil
}

// Read reads output from the shell.
func (s *Session) Read(buf []byte) (int, error) {

	return s.pty.Read(buf)
}

// Write sends input to the shell.
func (s *Session) Write(data []byte) (int, error) { return s.pty.Write(data) }

// Close terminates the PTY session gracefully. Closing the PTY master fd
// causes the kernel to send SIGHUP to the shell process group. We wait
// briefly for the process to exit, then force-kill as a fallback.
func (s *Session) Close() error {
	if err := s.pty.Close(); err != nil && !errors.Is(err, os.ErrClosed) {
		return fmt.Errorf("closing pty: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- s.cmd.Wait() }()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = s.cmd.Process.Kill()
		select {
		case <-done:
		case <-time.After(1 * time.Second):
		}
	}

	s.running = false
	return nil
}

// Resize updates the PTY dimensions so the shell reflows text properly.
func (s *Session) Resize(rows uint16, cols uint16) error {
	return pty.Setsize(s.pty, &pty.Winsize{Rows: rows, Cols: cols})
}

// ReadLoop reads input from the PTY
func (s *Session) ReadLoop(callback func(data string)) {
	for {
		buf := make([]byte, 4096)
		n, err := s.pty.Read(buf)
		if err != nil {
			return
		}
		callback(string(buf[:n]))
	}
}

package terminal

import (
	"os"
	"os/exec"
	"runtime"
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

func NewSession() (*Session, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = defaultShell()
	}
	cmd := exec.Command(shell)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
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
	s.pty.Close()

	done := make(chan error, 1)
	go func() { done <- s.cmd.Wait() }()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = s.cmd.Process.Kill()
		<-done
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

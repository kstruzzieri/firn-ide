package terminal

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// terminalOutput collects what ReadLoop delivers, for tests that have to wait
// on the shell.
type terminalOutput struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (o *terminalOutput) add(data string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.buf.WriteString(data)
}

func (o *terminalOutput) String() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.buf.String()
}

func (o *terminalOutput) waitFor(t *testing.T, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(o.String(), want) {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %q in terminal output, got %q", want, o.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// startStreamingSession starts a session the way App.CreateTerminal does: a
// goroutine sits in ReadLoop for the terminal's whole life, and the frontend
// sizes the terminal as soon as it mounts. The returned channel closes when
// ReadLoop returns.
func startStreamingSession(t *testing.T) (*Session, *terminalOutput, <-chan struct{}) {
	t.Helper()
	requirePTY(t)
	// Any POSIX sh: the tests below type trap commands into it.
	t.Setenv("SHELL", "/bin/sh")

	session, err := NewSession("")
	if err != nil {
		t.Fatalf("NewSession() returned error: %v", err)
	}
	// Backstop for a test that fails before its own Close; Close is safe to
	// call twice.
	t.Cleanup(func() { _ = session.Close() })

	out := &terminalOutput{}
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		session.ReadLoop(out.add)
	}()

	if err := session.Resize(30, 100); err != nil {
		t.Fatalf("Resize() returned error: %v", err)
	}
	return session, out, readerDone
}

// TestSessionCloseHangsUpShellWhileReaderIsBlocked: every real terminal has a
// goroutine blocked in ReadLoop. Close must still hang the shell up at once,
// so the shell runs its exit hooks and writes its history, instead of waiting
// out the grace period and killing it (#558).
func TestSessionCloseHangsUpShellWhileReaderIsBlocked(t *testing.T) {
	session, out, _ := startStreamingSession(t)

	// A hung-up shell leaves either on the SIGHUP itself or on the end-of-file
	// its terminal now returns; which one wins depends on the shell and the
	// kernel. Both are a clean exit, so the hook is installed for both.
	// The "" splits the word so the echoed command line cannot match it.
	hookRan := filepath.Join(t.TempDir(), "exit-hook-ran")
	command := `trap 'echo ran > "` + hookRan + `"; exit 0' HUP EXIT; echo re""ady` + "\n"
	if _, err := session.Write([]byte(command)); err != nil {
		t.Fatalf("Write() returned error: %v", err)
	}
	out.waitFor(t, "ready")

	start := time.Now()
	err := session.Close()
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Close() returned error: %v", err)
	}
	// The grace period before the force-kill is 3s; a hangup takes milliseconds.
	if elapsed > 2*time.Second {
		t.Errorf("Close() took %v: the shell was not hung up, the grace period ran out", elapsed)
	}
	state := session.cmd.ProcessState
	if state == nil {
		t.Fatal("the shell was never reaped")
	}
	if status, ok := state.Sys().(syscall.WaitStatus); ok && status.Signaled() && status.Signal() == syscall.SIGKILL {
		t.Error("the shell was force-killed instead of hung up")
	}
	if _, err := os.Stat(hookRan); err != nil {
		t.Errorf("the shell's exit hook did not run: %v", err)
	}
}

// TestSessionCloseReleasesReaderWhileBackgroundJobHoldsTerminal: a background
// job that outlives the shell keeps the terminal's other end open. Close must
// release the reader and the PTY regardless, not leave them waiting on that
// job (#558).
func TestSessionCloseReleasesReaderWhileBackgroundJobHoldsTerminal(t *testing.T) {
	session, out, readerDone := startStreamingSession(t)

	// The job ignores the hangup, so it outlives the shell under every sh
	// (bash would otherwise pass its own SIGHUP on to it), and it says "ready"
	// only once that is arranged. It runs while keepRunning exists, for 10s at
	// most, and leaves jobExited behind when it goes. Nothing is killed by
	// process id: removing the file, or the test's temporary directory, ends it.
	dir := t.TempDir()
	keepRunning := filepath.Join(dir, "keep-running")
	jobExited := filepath.Join(dir, "job-exited")
	if err := os.WriteFile(keepRunning, nil, 0o600); err != nil {
		t.Fatalf("WriteFile() returned error: %v", err)
	}
	command := `(trap '' HUP; echo re""ady; i=0; ` +
		`while [ -e "` + keepRunning + `" ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done; ` +
		`echo gone > "` + jobExited + `") &` + "\n"
	if _, err := session.Write([]byte(command)); err != nil {
		t.Fatalf("Write() returned error: %v", err)
	}
	out.waitFor(t, "ready")

	closed := make(chan error, 1)
	go func() { closed <- session.Close() }()

	select {
	case <-readerDone:
	case <-time.After(2 * time.Second):
		t.Error("ReadLoop was still blocked 2s after Close() started")
	}
	// Always wait for this Close, so the cleanup's Close never runs beside it.
	if err := <-closed; err != nil {
		t.Fatalf("Close() returned error: %v", err)
	}

	// The job must have been there the whole time, or the reader may simply
	// have been released by the terminal's last holder going away. It was if
	// it has not left yet and does leave once told to; a job the hangup had
	// killed would never write jobExited.
	if _, err := os.Stat(jobExited); err == nil {
		t.Fatal("the background job ended before it was told to")
	}
	if err := os.Remove(keepRunning); err != nil {
		t.Fatalf("Remove() returned error: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(jobExited); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the background job did not outlive the shell: it never reported leaving")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

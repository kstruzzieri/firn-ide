package terminal

import (
	"bytes"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestNewSession(t *testing.T) {
	requirePTY(t)
	session, err := NewSession("")
	if err != nil {
		t.Fatalf("NewSession() returned error: %v", err)
	}
	defer func() { _ = session.Close() }()

	if session.pty == nil {
		t.Fatal("expected pty to be set")
	}
	if !session.running {
		t.Fatal("expected session to be true")
	}
}

// TestNewSession_StartsInDir: the shell must start in the workspace root, not
// wherever the app process happens to run from (wails dev runs from the repo
// checkout, so without this every terminal opened there instead of the loaded
// project).
func TestNewSession_StartsInDir(t *testing.T) {
	requirePTY(t)
	dir := t.TempDir()
	session, err := NewSession(dir)
	if err != nil {
		t.Fatalf("NewSession(dir) returned error: %v", err)
	}
	defer func() { _ = session.Close() }()

	if session.cmd.Dir != dir {
		t.Errorf("cmd.Dir = %q, want %q", session.cmd.Dir, dir)
	}
}

// TestNewSession_MissingDirFallsBack: a stale or deleted workspace path must
// not break terminal creation — fall back to the process default.
func TestNewSession_MissingDirFallsBack(t *testing.T) {
	requirePTY(t)
	session, err := NewSession("/nonexistent/definitely/gone")
	if err != nil {
		t.Fatalf("NewSession(missing dir) returned error: %v", err)
	}
	defer func() { _ = session.Close() }()

	if session.cmd.Dir != "" {
		t.Errorf("cmd.Dir = %q, want empty fallback", session.cmd.Dir)
	}
}

func TestSessionWriteRead(t *testing.T) {
	requirePTY(t)
	session, err := NewSession("")
	if err != nil {
		t.Fatalf("NewSession() returned error: %v", err)
	}
	defer func() { _ = session.Close() }()

	_, err = session.Write([]byte("echo hello\n"))
	if err != nil {
		t.Fatalf("Write() returned error: %v", err)
	}

	// PTY Read() blocks, so run it in a goroutine with a real timeout.
	type readResult struct {
		data string
		err  error
	}
	ch := make(chan readResult, 1)
	go func() {
		var collected string
		buf := make([]byte, 4096)
		for {
			n, err := session.Read(buf)
			if err != nil {
				ch <- readResult{collected, err}
				return
			}
			collected += string(buf[:n])
			if strings.Contains(collected, "hello") {
				ch <- readResult{collected, nil}
				return
			}
		}
	}()

	select {
	case res := <-ch:
		if res.err != nil {
			t.Fatalf("session.Read() returned error: %v", res.err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for 'hello' in PTY output")
	}
}

func TestSessionCloseGraceful(t *testing.T) {
	requirePTY(t)
	session, err := NewSession("")
	if err != nil {
		t.Fatalf("NewSession() returned error: %v", err)
	}

	start := time.Now()
	err = session.Close()
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Close() returned error: %v", err)
	}
	if session.running {
		t.Fatal("expected running to be false after Close()")
	}
	if elapsed > 2*time.Second {
		t.Fatalf("graceful Close() took too long: %v", elapsed)
	}
}

func TestSessionCloseTerminatesStubbornProcess(t *testing.T) {
	requirePTY(t)
	session, err := NewSession("")
	if err != nil {
		t.Fatalf("NewSession() returned error: %v", err)
	}

	// Launch a process that traps SIGHUP and ignores it.
	_, err = session.Write([]byte("trap '' HUP; sleep 300 &\n"))
	if err != nil {
		t.Fatalf("Write() returned error: %v", err)
	}
	time.Sleep(200 * time.Millisecond)

	start := time.Now()
	err = session.Close()
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Close() returned error: %v", err)
	}
	// Should complete within the 3s SIGHUP timeout + 1s kill timeout.
	if elapsed > 5*time.Second {
		t.Fatalf("Close() with stubborn process took too long: %v", elapsed)
	}
}

// TestNewSession_ZshBackspaceErasesWithoutParentTERM: an app launched by
// launchd (Finder, the Dock, `open`) has no TERM, and without one zsh treats
// the PTY as dumb and echoes Backspace as a space instead of "\b \b" (#556).
// The session must give the shell a TERM itself. zsh only: bash and sh echo
// "\b" with or without TERM.
func TestNewSession_ZshBackspaceErasesWithoutParentTERM(t *testing.T) {
	requirePTY(t)
	zsh, err := exec.LookPath("zsh")
	if err != nil {
		t.Skip("zsh not installed")
	}
	// Hermetic: no user rc files, no global zshrc, no inherited TERM (as
	// under launchd).
	t.Setenv("HOME", hermeticHome(t))
	t.Setenv("SHELL", zsh)
	unsetenv(t, "TERM", "COLORTERM", "ZDOTDIR", "USER_ZDOTDIR", "XDG_CACHE_HOME")

	session, err := NewSession("")
	if err != nil {
		t.Fatalf("NewSession() returned error: %v", err)
	}
	defer func() { _ = session.Close() }()

	chunks := make(chan []byte, 64)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := session.Read(buf)
			if n > 0 {
				chunks <- append([]byte(nil), buf[:n]...)
			}
			if err != nil {
				close(chunks)
				return
			}
		}
	}()
	var seen []byte
	// waitFor reads until want appears after offset from, returning the
	// offset just past it.
	waitFor := func(want string, from int) int {
		t.Helper()
		deadline := time.After(5 * time.Second)
		for {
			if i := bytes.Index(seen[from:], []byte(want)); i >= 0 {
				return from + i + len(want)
			}
			select {
			case c, ok := <-chunks:
				if !ok {
					t.Fatalf("shell exited before %q; output after offset: %q", want, seen[from:])
				}
				seen = append(seen, c...)
			case <-deadline:
				t.Fatalf("timed out waiting for %q; output after offset: %q", want, seen[from:])
			}
		}
	}

	// zsh enables bracketed paste once its line editor owns the tty. Input sent
	// earlier is echoed by the kernel's line discipline, which erases with
	// "\b \b" whatever TERM says, so the test would pass for the wrong reason.
	ready := waitFor("\x1b[?2004h", 0)
	if _, err := session.Write([]byte("a")); err != nil {
		t.Fatalf("Write(a): %v", err)
	}
	typed := waitFor("a", ready)
	if _, err := session.Write([]byte("\x7f")); err != nil {
		t.Fatalf("Write(DEL): %v", err)
	}
	waitFor("\b", typed)

	// Let zsh exit on its own: Close cannot hang up a PTY that the reader
	// goroutine is still blocked on, and would wait out its 3s grace period.
	_, _ = session.Write([]byte("exit\n"))
}

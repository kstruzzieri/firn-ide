package terminal

import (
	"strings"
	"testing"
	"time"
)

func TestNewSession(t *testing.T) {
	session, err := NewSession()
	if err != nil {
		t.Fatalf("NewSession() returned error: %v", err)
	}
	defer session.Close()

	if session.pty == nil {
		t.Fatal("expected pty to be set")
	}
	if !session.running {
		t.Fatal("expected session to be true")
	}
}

func TestSessionWriteRead(t *testing.T) {
	session, err := NewSession()
	if err != nil {
		t.Fatalf("NewSession() returned error: %v", err)
	}
	defer session.Close()

	_, err = session.Write([]byte("echo hello\n"))
	if err != nil {
		t.Fatalf("Write() returned error: %v", err)
	}

	buf := make([]byte, 4096)
	n, err := session.Read(buf)
	if err != nil {
		t.Fatalf("session.Read() returned error: %v", err)
	}

	output := string(buf[:n])
	if !strings.Contains(output, "hello") {
		t.Fatalf("expected output to contain 'hello', got: %s", output)
	}
}

func TestSessionCloseGraceful(t *testing.T) {
	session, err := NewSession()
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
	session, err := NewSession()
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

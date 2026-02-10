package terminal

import (
	"strings"
	"testing"
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

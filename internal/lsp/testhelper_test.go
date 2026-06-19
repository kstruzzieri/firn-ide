package lsp

import (
	"io"
	"os"
	"os/exec"
	"testing"
)

// TestMockServerProcess is not a real test — it runs the mock LSP server when
// invoked as a subprocess with FIRN_MOCK_LSP=1. This allows tests to spawn
// a real process that speaks JSON-RPC over stdio.
func TestMockServerProcess(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") != "1" {
		t.Skip("not running as mock server")
	}
	mockServerMain()
}

// mockServerCmd returns an exec.Cmd that starts a mock LSP server subprocess.
// The subprocess is the current test binary re-invoked with FIRN_MOCK_LSP=1.
func mockServerCmd() *exec.Cmd {
	// Re-invoke the test binary running only the mock server test
	cmd := exec.Command(os.Args[0], "-test.run=^TestMockServerProcess$")
	cmd.Env = append(os.Environ(), "FIRN_MOCK_LSP=1")
	return cmd
}

// startMockTransport starts a mock LSP server and returns a StdioTransport connected to it.
func startMockTransport(t *testing.T) *StdioTransport {
	t.Helper()

	cmd := mockServerCmd()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("stdin pipe: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		t.Fatalf("start mock server: %v", err)
	}

	transport := &StdioTransport{
		cmd:    cmd,
		codec:  NewCodec(stdout, stdin),
		stdin:  stdin,
		stdout: stdout,
		done:   make(chan struct{}),
	}

	go func() {
		waitErr := cmd.Wait()
		transport.errMu.Lock()
		transport.exitErr = waitErr
		transport.errMu.Unlock()
		close(transport.done)
	}()

	t.Cleanup(func() {
		_ = stdin.Close()
		_ = stdout.Close()
		<-transport.done
	})

	return transport
}

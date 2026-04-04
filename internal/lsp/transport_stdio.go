package lsp

import (
	"bytes"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"
)

// processExitTimeout is the time to wait for a server process to exit gracefully before killing it.
const processExitTimeout = 5 * time.Second

// maxStderrCapture is the maximum number of stderr bytes to retain for diagnostics.
const maxStderrCapture = 4096

// StdioTransport implements Transport over a child process's stdin/stdout.
type StdioTransport struct {
	cmd    *exec.Cmd
	codec  *Codec
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr *limitedBuffer

	closeOnce sync.Once
	done      chan struct{}
	exitErr   error
	errMu     sync.Mutex
}

// NewStdioTransport starts the given command and wraps its stdin/stdout as an LSP transport.
// dir sets the working directory for the spawned process; if empty, the parent's cwd is used.
func NewStdioTransport(name string, dir string, args ...string) (*StdioTransport, error) {
	cmd := exec.Command(name, args...)
	if dir != "" {
		cmd.Dir = dir
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}

	// Capture stderr so crash diagnostics can be included in error messages.
	stderrBuf := &limitedBuffer{max: maxStderrCapture}
	cmd.Stderr = stderrBuf

	if err := cmd.Start(); err != nil {
		stdin.Close()
		return nil, fmt.Errorf("start %q: %w", name, err)
	}

	t := &StdioTransport{
		cmd:    cmd,
		codec:  NewCodec(stdout, stdin),
		stdin:  stdin,
		stdout: stdout,
		stderr: stderrBuf,
		done:   make(chan struct{}),
	}

	// Monitor the process in the background so we know when it exits.
	go func() {
		waitErr := cmd.Wait()
		t.errMu.Lock()
		t.exitErr = waitErr
		t.errMu.Unlock()
		close(t.done)
	}()

	return t, nil
}

// Stderr returns the captured stderr output from the server process.
func (t *StdioTransport) Stderr() string {
	return t.stderr.String()
}

// Send writes a JSON-RPC message to the server's stdin.
func (t *StdioTransport) Send(msg *JSONRPCMessage) error {
	select {
	case <-t.done:
		t.errMu.Lock()
		err := t.exitErr
		t.errMu.Unlock()
		return fmt.Errorf("transport closed: server process exited: %w", err)
	default:
	}
	return t.codec.WriteMessage(msg)
}

// Receive reads the next JSON-RPC message from the server's stdout.
func (t *StdioTransport) Receive() (*JSONRPCMessage, error) {
	msg, err := t.codec.ReadMessage()
	if err != nil {
		// Check if the process exited
		select {
		case <-t.done:
			return nil, io.EOF
		default:
		}
		return nil, err
	}
	return msg, nil
}

// Close shuts down the transport by closing stdin and waiting for the process.
// If the server does not exit within 5 seconds, it is killed.
func (t *StdioTransport) Close() error {
	var closeErr error
	t.closeOnce.Do(func() {
		// Close stdin to signal the server to exit
		t.stdin.Close()

		// Close stdout to unblock any pending Receive call
		t.stdout.Close()

		// Wait for process to finish, with a timeout
		select {
		case <-t.done:
		case <-time.After(processExitTimeout):
			_ = t.cmd.Process.Kill()
			<-t.done
		}

		t.errMu.Lock()
		closeErr = t.exitErr
		t.errMu.Unlock()
	})
	return closeErr
}

// Done returns a channel that is closed when the server process exits.
func (t *StdioTransport) Done() <-chan struct{} {
	return t.done
}

// ExitErr returns the process exit error, or nil if still running.
func (t *StdioTransport) ExitErr() error {
	select {
	case <-t.done:
		t.errMu.Lock()
		defer t.errMu.Unlock()
		return t.exitErr
	default:
		return nil
	}
}

// limitedBuffer is a bytes.Buffer that silently discards writes beyond max bytes.
// This prevents a chatty server from consuming unbounded memory via stderr.
type limitedBuffer struct {
	buf bytes.Buffer
	max int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	remaining := b.max - b.buf.Len()
	if remaining <= 0 {
		return len(p), nil // discard but report success so the writer doesn't block
	}
	if len(p) > remaining {
		p = p[:remaining]
	}
	b.buf.Write(p)
	return len(p), nil
}

func (b *limitedBuffer) String() string {
	return b.buf.String()
}

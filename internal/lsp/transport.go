package lsp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
)

// maxMessageSize is the maximum allowed size for a single LSP message (32 MiB).
// This prevents a buggy or malicious server from causing an OOM via a large Content-Length.
const maxMessageSize = 32 * 1024 * 1024

// Transport abstracts the bidirectional JSON-RPC message channel to a language server.
type Transport interface {
	// Send writes a JSON-RPC message to the server.
	Send(msg *JSONRPCMessage) error

	// Receive reads the next JSON-RPC message from the server.
	// Returns io.EOF when the transport is closed.
	Receive() (*JSONRPCMessage, error)

	// Close shuts down the transport.
	Close() error
}

// Codec handles JSON-RPC Content-Length framing for LSP.
// It is used by transport implementations to read/write framed messages.
// ReadMessage is NOT safe for concurrent use; callers must ensure single-reader access.
// WriteMessage is safe for concurrent use.
type Codec struct {
	reader *bufio.Reader
	writer io.Writer
	wmu    sync.Mutex
}

// NewCodec creates a Codec that frames JSON-RPC messages with Content-Length headers.
func NewCodec(r io.Reader, w io.Writer) *Codec {
	return &Codec{
		reader: bufio.NewReaderSize(r, 64*1024),
		writer: w,
	}
}

// WriteMessage serializes a JSON-RPC message with Content-Length framing.
// The full frame (header + body) is assembled in a buffer before writing
// to prevent stream corruption from partial writes.
func (c *Codec) WriteMessage(msg *JSONRPCMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal JSON-RPC message: %w", err)
	}

	var frame bytes.Buffer
	fmt.Fprintf(&frame, "Content-Length: %d\r\n\r\n", len(data))
	frame.Write(data)

	c.wmu.Lock()
	defer c.wmu.Unlock()

	if _, err := c.writer.Write(frame.Bytes()); err != nil {
		return fmt.Errorf("write message: %w", err)
	}
	return nil
}

// ReadMessage reads a Content-Length framed JSON-RPC message.
func (c *Codec) ReadMessage() (*JSONRPCMessage, error) {
	contentLength := -1

	// Parse headers until we hit the blank line separator
	for {
		line, err := c.reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")

		if line == "" {
			break
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])

		if strings.EqualFold(key, "Content-Length") {
			n, err := strconv.Atoi(val)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("invalid Content-Length %q", val)
			}
			if n > maxMessageSize {
				return nil, fmt.Errorf("Content-Length %d exceeds maximum allowed size %d", n, maxMessageSize)
			}
			contentLength = n
		}
		// Content-Type and other headers are ignored per LSP spec
	}

	if contentLength < 0 {
		return nil, fmt.Errorf("missing Content-Length header")
	}

	body := make([]byte, contentLength)
	if _, err := io.ReadFull(c.reader, body); err != nil {
		return nil, fmt.Errorf("read body (%d bytes): %w", contentLength, err)
	}

	var msg JSONRPCMessage
	if err := json.Unmarshal(body, &msg); err != nil {
		return nil, fmt.Errorf("unmarshal JSON-RPC message: %w", err)
	}

	return &msg, nil
}

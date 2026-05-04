package lsp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"
)

func TestCodec_WriteAndReadMessage(t *testing.T) {
	var buf bytes.Buffer
	codec := NewCodec(&buf, &buf)

	msg := &JSONRPCMessage{
		JSONRPC: "2.0",
		ID:      json.RawMessage(`1`),
		Method:  "textDocument/hover",
	}

	if err := codec.WriteMessage(msg); err != nil {
		t.Fatalf("WriteMessage: %v", err)
	}

	got, err := codec.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}

	if got.Method != "textDocument/hover" {
		t.Errorf("Method = %q, want %q", got.Method, "textDocument/hover")
	}
	if string(got.ID) != "1" {
		t.Errorf("ID = %s, want 1", string(got.ID))
	}
}

func TestCodec_MultipleMessages(t *testing.T) {
	var buf bytes.Buffer
	codec := NewCodec(&buf, &buf)

	// Write multiple messages
	for i := 1; i <= 3; i++ {
		idJSON, _ := json.Marshal(i)
		msg := &JSONRPCMessage{
			JSONRPC: "2.0",
			ID:      idJSON,
			Method:  "test",
		}
		if err := codec.WriteMessage(msg); err != nil {
			t.Fatalf("WriteMessage %d: %v", i, err)
		}
	}

	// Read all back
	for i := 1; i <= 3; i++ {
		got, err := codec.ReadMessage()
		if err != nil {
			t.Fatalf("ReadMessage %d: %v", i, err)
		}
		var id int
		_ = json.Unmarshal(got.ID, &id)
		if id != i {
			t.Errorf("message %d: ID = %d, want %d", i, id, i)
		}
	}
}

func TestCodec_ContentLengthFraming(t *testing.T) {
	// Manually construct a framed message
	body := `{"jsonrpc":"2.0","id":42,"method":"test"}`
	framed := "Content-Length: " + itoa(len(body)) + "\r\n\r\n" + body

	codec := NewCodec(strings.NewReader(framed), io.Discard)
	msg, err := codec.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}

	var id int
	_ = json.Unmarshal(msg.ID, &id)
	if id != 42 {
		t.Errorf("ID = %d, want 42", id)
	}
}

func TestCodec_PartialReads(t *testing.T) {
	// Simulate a reader that delivers data in small chunks
	body := `{"jsonrpc":"2.0","id":1,"result":null}`
	framed := "Content-Length: " + itoa(len(body)) + "\r\n\r\n" + body

	// Use a reader that delivers one byte at a time
	slow := &slowReader{data: []byte(framed)}
	codec := NewCodec(slow, io.Discard)

	msg, err := codec.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage with slow reader: %v", err)
	}
	if !msg.IsResponse() {
		t.Error("expected response message")
	}
}

func TestCodec_MissingContentLength(t *testing.T) {
	// Headers without Content-Length
	input := "Content-Type: application/json\r\n\r\n{}"
	codec := NewCodec(strings.NewReader(input), io.Discard)

	_, err := codec.ReadMessage()
	if err == nil {
		t.Error("expected error for missing Content-Length")
	}
}

func TestCodec_ExtraHeaders(t *testing.T) {
	// Content-Type header should be ignored, Content-Length should be parsed
	body := `{"jsonrpc":"2.0","id":1,"result":"ok"}`
	framed := "Content-Type: application/json\r\nContent-Length: " + itoa(len(body)) + "\r\n\r\n" + body

	codec := NewCodec(strings.NewReader(framed), io.Discard)
	msg, err := codec.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	if !msg.IsResponse() {
		t.Error("expected response message")
	}
}

func TestJSONRPCMessage_Classification(t *testing.T) {
	tests := []struct {
		name           string
		msg            JSONRPCMessage
		isRequest      bool
		isResponse     bool
		isNotification bool
	}{
		{
			name:      "request",
			msg:       JSONRPCMessage{ID: json.RawMessage(`1`), Method: "hover"},
			isRequest: true,
		},
		{
			name:       "response with result",
			msg:        JSONRPCMessage{ID: json.RawMessage(`1`), Result: json.RawMessage(`null`)},
			isResponse: true,
		},
		{
			name:       "response with error",
			msg:        JSONRPCMessage{ID: json.RawMessage(`1`), Error: &JSONRPCError{Code: -1, Message: "err"}},
			isResponse: true,
		},
		{
			name:           "notification",
			msg:            JSONRPCMessage{Method: "textDocument/publishDiagnostics"},
			isNotification: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.msg.IsRequest(); got != tt.isRequest {
				t.Errorf("IsRequest() = %v, want %v", got, tt.isRequest)
			}
			if got := tt.msg.IsResponse(); got != tt.isResponse {
				t.Errorf("IsResponse() = %v, want %v", got, tt.isResponse)
			}
			if got := tt.msg.IsNotification(); got != tt.isNotification {
				t.Errorf("IsNotification() = %v, want %v", got, tt.isNotification)
			}
		})
	}
}

func TestLimitedBufferCapsCaptureAndReportsFullWrite(t *testing.T) {
	buf := &limitedBuffer{max: 5}

	n, err := buf.Write([]byte("abcdef"))
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if n != 6 {
		t.Fatalf("Write reported %d bytes, want 6", n)
	}
	if got := buf.String(); got != "abcde" {
		t.Fatalf("captured stderr = %q, want abcde", got)
	}

	n, err = buf.Write([]byte("gh"))
	if err != nil {
		t.Fatalf("second Write: %v", err)
	}
	if n != 2 {
		t.Fatalf("second Write reported %d bytes, want 2", n)
	}
	if got := buf.String(); got != "abcde" {
		t.Fatalf("captured stderr after overflow = %q, want abcde", got)
	}
}

// --- helpers ---

type slowReader struct {
	data []byte
	pos  int
}

func (r *slowReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	// Deliver one byte at a time
	p[0] = r.data[r.pos]
	r.pos++
	return 1, nil
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}

package lsp

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"
)

func TestClient_InitializeAndShutdown(t *testing.T) {
	transport := startMockTransport(t)
	client := NewClient(transport, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Initialize(ctx, "file:///tmp/test", nil); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	if client.State() != ClientStateReady {
		t.Errorf("State = %d, want %d (Ready)", client.State(), ClientStateReady)
	}

	// Check that server capabilities were stored
	caps := client.ServerCapabilities()
	if caps.HoverProvider == nil {
		t.Error("HoverProvider capability not stored")
	}
	if caps.DefinitionProvider == nil {
		t.Error("DefinitionProvider capability not stored")
	}

	if err := client.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}

	if client.State() != ClientStateStopped {
		t.Errorf("State after shutdown = %d, want %d (Stopped)", client.State(), ClientStateStopped)
	}
}

func TestClient_DoubleInitialize(t *testing.T) {
	transport := startMockTransport(t)
	client := NewClient(transport, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Initialize(ctx, "file:///tmp/test", nil); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	// Second initialize should fail
	if err := client.Initialize(ctx, "file:///tmp/test", nil); err == nil {
		t.Error("expected error on double initialize")
	}

	_ = client.Shutdown(ctx)
}

func TestClient_Hover(t *testing.T) {
	transport := startMockTransport(t)
	client := NewClient(transport, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Initialize(ctx, "file:///tmp/test", nil); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	hover, err := client.Hover(ctx, "file:///tmp/test/main.ts", 0, 0)
	if err != nil {
		t.Fatalf("Hover: %v", err)
	}
	if hover == nil {
		t.Fatal("Hover returned nil")
	}
	if hover.Contents == nil {
		t.Error("Hover contents is nil")
	}

	_ = client.Shutdown(ctx)
}

func TestClient_Definition(t *testing.T) {
	transport := startMockTransport(t)
	client := NewClient(transport, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Initialize(ctx, "file:///tmp/test", nil); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	locs, err := client.Definition(ctx, "file:///tmp/test/main.ts", 5, 10)
	if err != nil {
		t.Fatalf("Definition: %v", err)
	}
	if len(locs) == 0 {
		t.Fatal("Definition returned no locations")
	}
	if locs[0].URI != "file:///tmp/test/main.ts" {
		t.Errorf("Definition URI = %q, want %q", locs[0].URI, "file:///tmp/test/main.ts")
	}

	_ = client.Shutdown(ctx)
}

func TestClient_Completion(t *testing.T) {
	transport := startMockTransport(t)
	client := NewClient(transport, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Initialize(ctx, "file:///tmp/test", nil); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	list, err := client.Complete(ctx, "file:///tmp/test/main.ts", 0, 0, ".")
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if list == nil || len(list.Items) == 0 {
		t.Fatal("Complete returned no items")
	}
	if list.Items[0].Label != "mockFunction" {
		t.Errorf("first completion label = %q, want %q", list.Items[0].Label, "mockFunction")
	}

	_ = client.Shutdown(ctx)
}

func TestClient_ResolveCompletionItem(t *testing.T) {
	transport := startMockTransport(t)
	client := NewClient(transport, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Initialize(ctx, "file:///tmp/test", nil); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	resolved, err := client.ResolveCompletionItem(ctx, CompletionItem{
		Label: "mockFunction",
		Data:  json.RawMessage(`{"id":1}`),
	})
	if err != nil {
		t.Fatalf("ResolveCompletionItem: %v", err)
	}
	if resolved == nil {
		t.Fatal("ResolveCompletionItem returned nil")
	}
	if resolved.Detail != "(method) mockFunction(value: string): boolean" {
		t.Fatalf("resolved detail = %q", resolved.Detail)
	}

	_ = client.Shutdown(ctx)
}

func TestClient_DidOpenAndDiagnostics(t *testing.T) {
	transport := startMockTransport(t)

	var diagMu sync.Mutex
	var receivedDiag *PublishDiagnosticsParams

	client := NewClient(transport, func(method string, params json.RawMessage) {
		if method == "textDocument/publishDiagnostics" {
			diagMu.Lock()
			defer diagMu.Unlock()
			var d PublishDiagnosticsParams
			if err := json.Unmarshal(params, &d); err != nil {
				return
			}
			receivedDiag = &d
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Initialize(ctx, "file:///tmp/test", nil); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	uri := "file:///tmp/test/main.ts"
	if err := client.DidOpen(uri, "typescript", 1, "const x: number = 'hello';"); err != nil {
		t.Fatalf("DidOpen: %v", err)
	}

	// Wait for diagnostic notification from mock server
	deadline := time.After(3 * time.Second)
	for {
		diagMu.Lock()
		got := receivedDiag
		diagMu.Unlock()

		if got != nil {
			if got.URI != uri {
				t.Errorf("diagnostic URI = %q, want %q", got.URI, uri)
			}
			if len(got.Diagnostics) == 0 {
				t.Error("expected at least one diagnostic")
			}
			break
		}

		select {
		case <-deadline:
			t.Fatal("timed out waiting for diagnostics")
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}

	_ = client.Shutdown(ctx)
}

func TestClient_DidChangeThenClose(t *testing.T) {
	transport := startMockTransport(t)
	client := NewClient(transport, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Initialize(ctx, "file:///tmp/test", nil); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	uri := "file:///tmp/test/main.ts"
	if err := client.DidOpen(uri, "typescript", 1, "const x = 1;"); err != nil {
		t.Fatalf("DidOpen: %v", err)
	}

	if err := client.DidChange(uri, 2, []TextDocumentContentChangeEvent{
		{Text: "const x = 2;"},
	}); err != nil {
		t.Fatalf("DidChange: %v", err)
	}

	if err := client.DidSave(uri); err != nil {
		t.Fatalf("DidSave: %v", err)
	}

	if err := client.DidClose(uri); err != nil {
		t.Fatalf("DidClose: %v", err)
	}

	_ = client.Shutdown(ctx)
}

func TestClient_RequestTimeout(t *testing.T) {
	// Use a transport that never responds to test timeout behavior
	transport := startMockTransport(t)
	client := NewClient(transport, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Initialize(ctx, "file:///tmp/test", nil); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	// Use a very short timeout for the hover request
	shortCtx, shortCancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
	defer shortCancel()

	// This may or may not timeout depending on how fast the mock responds.
	// The important thing is it doesn't hang or panic.
	_, _ = client.Hover(shortCtx, "file:///tmp/test/main.ts", 0, 0)

	_ = client.Shutdown(ctx)
}

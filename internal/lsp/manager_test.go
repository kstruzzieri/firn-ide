package lsp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// newTestManager creates a Manager with a mock transport factory.
// It overrides the registry to use the mock server for all TypeScript files.
func newTestManager(t *testing.T) (*Manager, *eventCollector) {
	t.Helper()

	collector := &eventCollector{}
	mgr := NewManager(collector.emit)

	// Override the registry to use our mock server binary
	mgr.registry = &Registry{}

	return mgr, collector
}

// eventCollector captures emitted events for test assertions.
type eventCollector struct {
	mu     sync.Mutex
	events []collectedEvent
}

type collectedEvent struct {
	name string
	data []any
}

func (ec *eventCollector) emit(event string, data ...any) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.events = append(ec.events, collectedEvent{name: event, data: data})
}

func (ec *eventCollector) eventsByName(name string) []collectedEvent {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	var result []collectedEvent
	for _, e := range ec.events {
		if e.name == name {
			result = append(result, e)
		}
	}
	return result
}

func (ec *eventCollector) hasDiagnostics() bool {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	for _, e := range ec.events {
		if e.name == "lsp:diagnostics" {
			return true
		}
	}
	return false
}

func TestRegistry_LanguageIDMapping(t *testing.T) {
	r := NewRegistry()

	tests := []struct {
		ext    string
		langID string
		family string
	}{
		{".ts", "typescript", "typescript"},
		{".tsx", "typescriptreact", "typescript"},
		{".js", "javascript", "typescript"},
		{".jsx", "javascriptreact", "typescript"},
		{".mts", "typescript", "typescript"},
		{".cts", "typescript", "typescript"},
		{".mjs", "javascript", "typescript"},
		{".cjs", "javascript", "typescript"},
		{".go", "", ""},
		{".py", "", ""},
		{".rs", "", ""},
	}

	for _, tt := range tests {
		if got := r.LanguageIDForExtension(tt.ext); got != tt.langID {
			t.Errorf("LanguageIDForExtension(%q) = %q, want %q", tt.ext, got, tt.langID)
		}
		if got := r.FamilyForExtension(tt.ext); got != tt.family {
			t.Errorf("FamilyForExtension(%q) = %q, want %q", tt.ext, got, tt.family)
		}
	}
}

func TestRegistry_CaseInsensitive(t *testing.T) {
	r := NewRegistry()
	if got := r.LanguageIDForExtension(".TS"); got != "typescript" {
		t.Errorf("LanguageIDForExtension(.TS) = %q, want typescript", got)
	}
}

func TestManager_DidOpenUnsupported(t *testing.T) {
	mgr, _ := newTestManager(t)
	mgr.SetWorkspaceRoot("/tmp/test")

	ctx := context.Background()
	// Opening an unsupported file should be a no-op
	err := mgr.DidOpen(ctx, "/tmp/test/main.go", "", 1, "package main")
	if err != nil {
		t.Errorf("DidOpen unsupported file should be no-op, got: %v", err)
	}
}

func TestManager_NoWorkspaceRoot(t *testing.T) {
	mgr, _ := newTestManager(t)
	// Don't set workspace root

	ctx := context.Background()
	err := mgr.DidOpen(ctx, "/tmp/test/main.ts", "", 1, "const x = 1;")
	if err == nil {
		t.Error("expected error when workspace root is not set")
	}
}

func TestManager_GetStatusEmpty(t *testing.T) {
	mgr, _ := newTestManager(t)
	statuses := mgr.GetStatus()
	if len(statuses) != 0 {
		t.Errorf("GetStatus on empty manager = %d servers, want 0", len(statuses))
	}
}

func TestManager_ShutdownAllEmpty(t *testing.T) {
	mgr, _ := newTestManager(t)
	// Should not panic
	mgr.ShutdownAll(time.Second)
}

// Integration test that uses the mock server via exec
func TestManager_IntegrationWithMockServer(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	// Create a temp workspace with a .ts file to trigger detection
	tmpDir := t.TempDir()
	tsFile := filepath.Join(tmpDir, "main.ts")
	os.WriteFile(tsFile, []byte("const x: number = 1;"), 0644)

	// We need to override the registry to use the mock server
	// This requires a custom manager that uses our mock binary
	collector := &eventCollector{}
	mgr := &Manager{
		registry: NewRegistry(),
		emitter:  collector.emit,
		servers:  make(map[serverKey]*serverEntry),
	}
	mgr.SetWorkspaceRoot(tmpDir)

	// Override ServerConfigFor by injecting a mock config directly
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Start the mock server manually via startServer
	key := serverKey{family: "typescript", workspace: tmpDir}
	config := &ServerConfig{
		LanguageFamily: "typescript",
		Command:        os.Args[0],
		Args:           []string{"-test.run=^TestMockServerProcess$"},
	}

	// Set env for mock
	origEnv := os.Getenv("FIRN_MOCK_LSP")
	os.Setenv("FIRN_MOCK_LSP", "1")
	defer os.Setenv("FIRN_MOCK_LSP", origEnv)

	entry, err := mgr.startServer(ctx, key, config)
	if err != nil {
		t.Fatalf("startServer: %v", err)
	}

	// Verify server is ready
	statuses := mgr.GetStatus()
	if len(statuses) != 1 {
		t.Fatalf("expected 1 server, got %d", len(statuses))
	}
	if statuses[0].State != "ready" {
		t.Errorf("server state = %q, want ready", statuses[0].State)
	}

	// Open a document
	uri, _ := FileToURI(tsFile)
	mgr.mu.Lock()
	entry.openDocs[uri] = 1
	mgr.mu.Unlock()

	if err := entry.client.DidOpen(uri, "typescript", 1, "const x: number = 1;"); err != nil {
		t.Fatalf("DidOpen: %v", err)
	}

	// Wait for diagnostics
	deadline := time.After(3 * time.Second)
	for {
		if collector.hasDiagnostics() {
			break
		}
		select {
		case <-deadline:
			t.Fatal("timed out waiting for diagnostics via manager")
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}

	// Test hover
	hover, err := entry.client.Hover(ctx, uri, 0, 0)
	if err != nil {
		t.Fatalf("Hover: %v", err)
	}
	if hover == nil {
		t.Fatal("Hover returned nil")
	}

	// Test completion
	list, err := entry.client.Complete(ctx, uri, 0, 0, "")
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if list == nil || len(list.Items) == 0 {
		t.Fatal("Complete returned no items")
	}

	// Test definition
	locs, err := entry.client.Definition(ctx, uri, 0, 0)
	if err != nil {
		t.Fatalf("Definition: %v", err)
	}
	if len(locs) == 0 {
		t.Fatal("Definition returned no locations")
	}

	// Verify document reference counting
	mgr.mu.Lock()
	docCount := len(entry.openDocs)
	mgr.mu.Unlock()
	if docCount != 1 {
		t.Errorf("open doc count = %d, want 1", docCount)
	}

	// Close the document
	delete(entry.openDocs, uri)
	entry.client.DidClose(uri)

	mgr.mu.Lock()
	docCount = len(entry.openDocs)
	mgr.mu.Unlock()
	if docCount != 0 {
		t.Errorf("open doc count after close = %d, want 0", docCount)
	}

	// Shutdown
	mgr.ShutdownAll(5 * time.Second)

	// Verify status events were emitted
	statusEvents := collector.eventsByName("lsp:status")
	if len(statusEvents) == 0 {
		t.Error("no lsp:status events emitted")
	}
}

func TestManager_ConcurrentMultiFile(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	tmpDir := t.TempDir()

	// Create multiple TS files
	files := []string{"a.ts", "b.tsx", "c.js"}
	for _, f := range files {
		os.WriteFile(filepath.Join(tmpDir, f), []byte("const x = 1;"), 0644)
	}

	collector := &eventCollector{}
	mgr := &Manager{
		registry: NewRegistry(),
		emitter:  collector.emit,
		servers:  make(map[serverKey]*serverEntry),
	}
	mgr.SetWorkspaceRoot(tmpDir)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	key := serverKey{family: "typescript", workspace: tmpDir}
	config := &ServerConfig{
		LanguageFamily: "typescript",
		Command:        os.Args[0],
		Args:           []string{"-test.run=^TestMockServerProcess$"},
	}

	origEnv := os.Getenv("FIRN_MOCK_LSP")
	os.Setenv("FIRN_MOCK_LSP", "1")
	defer os.Setenv("FIRN_MOCK_LSP", origEnv)

	entry, err := mgr.startServer(ctx, key, config)
	if err != nil {
		t.Fatalf("startServer: %v", err)
	}

	// Open 3 files concurrently
	var wg sync.WaitGroup
	for _, f := range files {
		wg.Add(1)
		go func(filename string) {
			defer wg.Done()
			path := filepath.Join(tmpDir, filename)
			uri, _ := FileToURI(path)
			ext := filepath.Ext(filename)
			langID := mgr.registry.LanguageIDForExtension(ext)

			mgr.mu.Lock()
			entry.openDocs[uri] = 1
			mgr.mu.Unlock()

			entry.client.DidOpen(uri, langID, 1, "const x = 1;")
		}(f)
	}
	wg.Wait()

	// Verify all 3 are tracked
	mgr.mu.Lock()
	docCount := len(entry.openDocs)
	mgr.mu.Unlock()
	if docCount != 3 {
		t.Fatalf("open doc count = %d, want 3", docCount)
	}

	// Edit two files concurrently
	wg = sync.WaitGroup{}
	for _, f := range files[:2] {
		wg.Add(1)
		go func(filename string) {
			defer wg.Done()
			path := filepath.Join(tmpDir, filename)
			uri, _ := FileToURI(path)

			mgr.mu.Lock()
			entry.openDocs[uri] = 2
			mgr.mu.Unlock()

			entry.client.DidChange(uri, 2, []TextDocumentContentChangeEvent{
				{Text: "const x = 2;"},
			})
		}(f)
	}
	wg.Wait()

	// Close one file — should keep server running
	closePath := filepath.Join(tmpDir, files[0])
	closeURI, _ := FileToURI(closePath)

	mgr.mu.Lock()
	delete(entry.openDocs, closeURI)
	remaining := len(entry.openDocs)
	mgr.mu.Unlock()

	entry.client.DidClose(closeURI)

	if remaining != 2 {
		t.Errorf("after closing 1 of 3: doc count = %d, want 2", remaining)
	}

	// Server should still be running
	if entry.client.State() != ClientStateReady {
		t.Errorf("server state after partial close = %d, want Ready", entry.client.State())
	}

	// Wait for diagnostics from the concurrent operations
	deadline := time.After(3 * time.Second)
	for {
		if collector.hasDiagnostics() {
			break
		}
		select {
		case <-deadline:
			t.Fatal("timed out waiting for diagnostics during concurrent test")
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}

	mgr.ShutdownAll(5 * time.Second)
}

// Test that diagnostics are routed through the notification handler
func TestManager_DiagnosticsRouting(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	tmpDir := t.TempDir()

	var diagMu sync.Mutex
	var diagnostics []PublishDiagnosticsParams

	mgr := &Manager{
		registry: NewRegistry(),
		emitter: func(event string, data ...any) {
			if event == "lsp:diagnostics" && len(data) > 0 {
				diagMu.Lock()
				defer diagMu.Unlock()
				raw, ok := data[0].(json.RawMessage)
				if ok {
					var d PublishDiagnosticsParams
					json.Unmarshal(raw, &d)
					diagnostics = append(diagnostics, d)
				}
			}
		},
		servers: make(map[serverKey]*serverEntry),
	}
	mgr.SetWorkspaceRoot(tmpDir)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	key := serverKey{family: "typescript", workspace: tmpDir}
	config := &ServerConfig{
		LanguageFamily: "typescript",
		Command:        os.Args[0],
		Args:           []string{"-test.run=^TestMockServerProcess$"},
	}

	origEnv := os.Getenv("FIRN_MOCK_LSP")
	os.Setenv("FIRN_MOCK_LSP", "1")
	defer os.Setenv("FIRN_MOCK_LSP", origEnv)

	entry, err := mgr.startServer(ctx, key, config)
	if err != nil {
		t.Fatalf("startServer: %v", err)
	}

	// Open a file — mock server emits diagnostics on didOpen
	uri := "file:///tmp/test.ts"
	mgr.mu.Lock()
	entry.openDocs[uri] = 1
	mgr.mu.Unlock()

	entry.client.DidOpen(uri, "typescript", 1, "const x = 1;")

	// Wait for diagnostics
	deadline := time.After(3 * time.Second)
	for {
		diagMu.Lock()
		count := len(diagnostics)
		diagMu.Unlock()

		if count > 0 {
			diagMu.Lock()
			first := diagnostics[0]
			diagMu.Unlock()

			if first.URI != uri {
				t.Errorf("diagnostic URI = %q, want %q", first.URI, uri)
			}
			if len(first.Diagnostics) == 0 {
				t.Error("expected at least one diagnostic")
			} else if first.Diagnostics[0].Severity != SeverityError {
				t.Errorf("diagnostic severity = %d, want %d", first.Diagnostics[0].Severity, SeverityError)
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

	mgr.ShutdownAll(5 * time.Second)
}

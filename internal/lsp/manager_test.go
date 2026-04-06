package lsp

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// newTestManager creates a Manager with a mock transport factory.
func newTestManager(t *testing.T) (*Manager, *eventCollector) {
	t.Helper()

	collector := &eventCollector{}
	mgr := NewManager(collector.emit)
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
	err := mgr.DidOpen(ctx, "/tmp/test/main.go", "", 1, "package main")
	if err != nil {
		t.Errorf("DidOpen unsupported file should be no-op, got: %v", err)
	}
}

func TestManager_NoWorkspaceRoot(t *testing.T) {
	mgr, _ := newTestManager(t)

	ctx := context.Background()
	err := mgr.DidOpen(ctx, "/tmp/test/main.ts", "", 1, "const x = 1;")
	if err == nil {
		t.Error("expected error when workspace root is not set")
	}
}

func TestHover_UnsupportedPath_ReturnsNil(t *testing.T) {
	mgr := NewManager(nil)
	mgr.SetWorkspaceRoot("/tmp/ws")
	result, err := mgr.Hover(context.Background(), "/tmp/ws/readme.md", 0, 0)
	if err != nil {
		t.Fatalf("expected nil error for unsupported path, got: %v", err)
	}
	if result != nil {
		t.Fatalf("expected nil result for unsupported path, got: %+v", result)
	}
}

func TestDefinition_UnsupportedPath_ReturnsNil(t *testing.T) {
	mgr := NewManager(nil)
	mgr.SetWorkspaceRoot("/tmp/ws")
	result, err := mgr.Definition(context.Background(), "/tmp/ws/readme.md", 0, 0)
	if err != nil {
		t.Fatalf("expected nil error for unsupported path, got: %v", err)
	}
	if result != nil {
		t.Fatalf("expected nil result for unsupported path, got: %+v", result)
	}
}

func TestComplete_UnsupportedPath_ReturnsNil(t *testing.T) {
	mgr := NewManager(nil)
	mgr.SetWorkspaceRoot("/tmp/ws")
	result, err := mgr.Complete(context.Background(), "/tmp/ws/readme.md", 0, 0, "")
	if err != nil {
		t.Fatalf("expected nil error for unsupported path, got: %v", err)
	}
	if result != nil {
		t.Fatalf("expected nil result for unsupported path, got: %+v", result)
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
	mgr.ShutdownAll(time.Second)
}

// startMockManager creates a Manager with a running mock LSP server.
// Returns the manager, event collector, and the server key.
func startMockManager(t *testing.T) (*Manager, *eventCollector, serverKey) {
	t.Helper()

	tmpDir := t.TempDir()
	collector := &eventCollector{}
	mgr := &Manager{
		registry: NewRegistry(),
		emitter:  collector.emit,
		servers:  make(map[serverKey]*serverEntry),
	}
	mgr.SetWorkspaceRoot(tmpDir)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	key := serverKey{family: "typescript", workspace: tmpDir}
	config := &ServerConfig{
		LanguageFamily: "typescript",
		Command:        os.Args[0],
		Args:           []string{"-test.run=^TestMockServerProcess$"},
	}

	t.Setenv("FIRN_MOCK_LSP", "1")

	_, err := mgr.startServer(ctx, key, config)
	if err != nil {
		t.Fatalf("startServer: %v", err)
	}

	t.Cleanup(func() {
		mgr.ShutdownAll(5 * time.Second)
	})

	return mgr, collector, key
}

func TestManager_IntegrationWithMockServer(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	mgr, collector, key := startMockManager(t)
	tmpDir := key.workspace

	// Verify server is ready
	statuses := mgr.GetStatus()
	if len(statuses) != 1 {
		t.Fatalf("expected 1 server, got %d", len(statuses))
	}
	if statuses[0].State != "ready" {
		t.Errorf("server state = %q, want ready", statuses[0].State)
	}

	// Use Manager.DidOpen (not direct client call)
	tsFile := filepath.Join(tmpDir, "main.ts")
	_ = os.WriteFile(tsFile, []byte("const x: number = 1;"), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := mgr.DidOpen(ctx, tsFile, "typescript", 1, "const x: number = 1;"); err != nil {
		t.Fatalf("DidOpen: %v", err)
	}

	// Wait for diagnostics
	waitFor(t, 3*time.Second, "diagnostics", collector.hasDiagnostics)

	// Test hover via manager
	hover, err := mgr.Hover(ctx, tsFile, 0, 0)
	if err != nil {
		t.Fatalf("Hover: %v", err)
	}
	if hover == nil {
		t.Fatal("Hover returned nil")
	}

	// Test completion via manager
	list, err := mgr.Complete(ctx, tsFile, 0, 0, "")
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if list == nil || len(list.Items) == 0 {
		t.Fatal("Complete returned no items")
	}

	// Test definition via manager
	locs, err := mgr.Definition(ctx, tsFile, 0, 0)
	if err != nil {
		t.Fatalf("Definition: %v", err)
	}
	if len(locs) == 0 {
		t.Fatal("Definition returned no locations")
	}

	// Verify document is tracked
	mgr.mu.Lock()
	entry := mgr.servers[key]
	docCount := len(entry.openDocs)
	mgr.mu.Unlock()
	if docCount != 1 {
		t.Errorf("open doc count = %d, want 1", docCount)
	}

	// Verify status events were emitted
	statusEvents := collector.eventsByName("lsp:status")
	if len(statusEvents) == 0 {
		t.Error("no lsp:status events emitted")
	}
}

func TestManager_ZeroDocTeardown(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	mgr, _, key := startMockManager(t)
	tmpDir := key.workspace

	tsFile := filepath.Join(tmpDir, "main.ts")
	_ = os.WriteFile(tsFile, []byte("const x = 1;"), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Open a file
	if err := mgr.DidOpen(ctx, tsFile, "typescript", 1, "const x = 1;"); err != nil {
		t.Fatalf("DidOpen: %v", err)
	}

	// Verify server is running
	mgr.mu.Lock()
	_, serverExists := mgr.servers[key]
	mgr.mu.Unlock()
	if !serverExists {
		t.Fatal("server should exist after DidOpen")
	}

	// Close the file — should tear down the server
	if err := mgr.DidClose(ctx, tsFile); err != nil {
		t.Fatalf("DidClose: %v", err)
	}

	// Verify server was removed
	mgr.mu.Lock()
	_, serverExists = mgr.servers[key]
	mgr.mu.Unlock()
	if serverExists {
		t.Error("server should be removed after closing last document")
	}
}

func TestManager_RefCounting(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	mgr, _, key := startMockManager(t)
	tmpDir := key.workspace

	tsFile := filepath.Join(tmpDir, "main.ts")
	_ = os.WriteFile(tsFile, []byte("const x = 1;"), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Open the same file twice (simulating two panes/tabs)
	if err := mgr.DidOpen(ctx, tsFile, "typescript", 1, "const x = 1;"); err != nil {
		t.Fatalf("DidOpen 1: %v", err)
	}
	if err := mgr.DidOpen(ctx, tsFile, "typescript", 1, "const x = 1;"); err != nil {
		t.Fatalf("DidOpen 2: %v", err)
	}

	// Verify refCount is 2
	uri, _ := FileToURI(tsFile)
	mgr.mu.Lock()
	entry := mgr.servers[key]
	ds := entry.openDocs[uri]
	mgr.mu.Unlock()
	if ds.refCount != 2 {
		t.Fatalf("refCount = %d, want 2", ds.refCount)
	}

	// Close once — server should still be running
	if err := mgr.DidClose(ctx, tsFile); err != nil {
		t.Fatalf("DidClose 1: %v", err)
	}

	mgr.mu.Lock()
	_, serverExists := mgr.servers[key]
	ds = entry.openDocs[uri]
	mgr.mu.Unlock()
	if !serverExists {
		t.Error("server should still exist after first close (refCount was 2)")
	}
	if ds.refCount != 1 {
		t.Errorf("refCount after first close = %d, want 1", ds.refCount)
	}

	// Close again — should tear down
	if err := mgr.DidClose(ctx, tsFile); err != nil {
		t.Fatalf("DidClose 2: %v", err)
	}

	mgr.mu.Lock()
	_, serverExists = mgr.servers[key]
	mgr.mu.Unlock()
	if serverExists {
		t.Error("server should be removed after closing last reference")
	}
}

func TestManager_ConcurrentMultiFile(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	mgr, collector, key := startMockManager(t)
	tmpDir := key.workspace

	// Create multiple TS files
	files := []string{"a.ts", "b.tsx", "c.js"}
	for _, f := range files {
		_ = os.WriteFile(filepath.Join(tmpDir, f), []byte("const x = 1;"), 0644)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Open 3 files concurrently via Manager API
	var wg sync.WaitGroup
	for _, f := range files {
		wg.Add(1)
		go func(filename string) {
			defer wg.Done()
			path := filepath.Join(tmpDir, filename)
			_ = mgr.DidOpen(ctx, path, "", 1, "const x = 1;")
		}(f)
	}
	wg.Wait()

	// Verify all 3 are tracked
	mgr.mu.Lock()
	entry := mgr.servers[key]
	docCount := len(entry.openDocs)
	mgr.mu.Unlock()
	if docCount != 3 {
		t.Fatalf("open doc count = %d, want 3", docCount)
	}

	// Edit two files concurrently via Manager API
	for _, f := range files[:2] {
		wg.Add(1)
		go func(filename string) {
			defer wg.Done()
			path := filepath.Join(tmpDir, filename)
			_ = mgr.DidChange(path, 2, []TextDocumentContentChangeEvent{
				{Text: "const x = 2;"},
			})
		}(f)
	}
	wg.Wait()

	// Close one file via Manager API — should keep server running
	closePath := filepath.Join(tmpDir, files[0])
	mgr.DidClose(ctx, closePath)

	mgr.mu.Lock()
	remaining := len(entry.openDocs)
	mgr.mu.Unlock()
	if remaining != 2 {
		t.Errorf("after closing 1 of 3: doc count = %d, want 2", remaining)
	}

	// Server should still be running
	if entry.client.State() != ClientStateReady {
		t.Errorf("server state after partial close = %d, want Ready", entry.client.State())
	}

	// Wait for diagnostics from the concurrent operations
	waitFor(t, 3*time.Second, "diagnostics", collector.hasDiagnostics)
}

func TestManager_DiagnosticsRouting(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	mgr, _, key := startMockManager(t)
	tmpDir := key.workspace

	var diagMu sync.Mutex
	var diagnostics []PublishDiagnosticsParams

	mgr.emitter = func(event string, data ...any) {
		if event == "lsp:diagnostics" && len(data) > 0 {
			diagMu.Lock()
			defer diagMu.Unlock()
			payload, ok := data[0].(map[string]any)
			if !ok {
				return
			}
			uri, _ := payload["uri"].(string)
			diags, _ := payload["diagnostics"].([]Diagnostic)
			version, _ := payload["version"].(int)
			diagnostics = append(diagnostics, PublishDiagnosticsParams{
				URI:         uri,
				Version:     version,
				Diagnostics: diags,
			})
		}
	}

	tsFile := filepath.Join(tmpDir, "main.ts")
	_ = os.WriteFile(tsFile, []byte("const x = 1;"), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Open via Manager API
	if err := mgr.DidOpen(ctx, tsFile, "typescript", 1, "const x = 1;"); err != nil {
		t.Fatalf("DidOpen: %v", err)
	}
	uri, _ := FileToURI(tsFile)

	// Wait for diagnostics
	waitFor(t, 3*time.Second, "diagnostics", func() bool {
		diagMu.Lock()
		defer diagMu.Unlock()
		return len(diagnostics) > 0
	})

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
}

func TestManager_CrashRestart(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	mgr, collector, key := startMockManager(t)
	tmpDir := key.workspace

	tsFile := filepath.Join(tmpDir, "main.ts")
	if err := os.WriteFile(tsFile, []byte("const x = 1;"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := mgr.DidOpen(ctx, tsFile, "typescript", 1, "const x = 1;"); err != nil {
		t.Fatalf("DidOpen: %v", err)
	}

	uri, err := FileToURI(tsFile)
	if err != nil {
		t.Fatalf("FileToURI: %v", err)
	}

	mgr.mu.Lock()
	oldEntry := mgr.servers[key]
	transport, ok := oldEntry.client.transport.(*StdioTransport)
	mgr.mu.Unlock()
	if !ok {
		t.Fatalf("transport type = %T, want *StdioTransport", oldEntry.client.transport)
	}

	if err := transport.cmd.Process.Kill(); err != nil {
		t.Fatalf("Kill: %v", err)
	}

	waitFor(t, 5*time.Second, "reconnect event", func() bool {
		return len(collector.eventsByName("lsp:reconnect")) > 0
	})

	waitFor(t, 5*time.Second, "server restart", func() bool {
		mgr.mu.Lock()
		defer mgr.mu.Unlock()
		current, ok := mgr.servers[key]
		return ok && current != oldEntry && current.client.State() == ClientStateReady
	})

	reconnectEvents := collector.eventsByName("lsp:reconnect")
	reconnect := reconnectEvents[len(reconnectEvents)-1]
	if len(reconnect.data) != 1 {
		t.Fatalf("reconnect event data len = %d, want 1", len(reconnect.data))
	}
	payload, ok := reconnect.data[0].(map[string]any)
	if !ok {
		t.Fatalf("reconnect payload type = %T, want map[string]any", reconnect.data[0])
	}

	if family, _ := payload["family"].(string); family != key.family {
		t.Errorf("reconnect family = %q, want %q", family, key.family)
	}
	if workspace, _ := payload["workspace"].(string); workspace != key.workspace {
		t.Errorf("reconnect workspace = %q, want %q", workspace, key.workspace)
	}
	docs, ok := payload["documents"].([]string)
	if !ok {
		t.Fatalf("reconnect documents type = %T, want []string", payload["documents"])
	}
	if len(docs) != 1 || docs[0] != uri {
		t.Errorf("reconnect documents = %v, want [%q]", docs, uri)
	}

	mgr.mu.Lock()
	newEntry := mgr.servers[key]
	mgr.mu.Unlock()
	if newEntry.crashCount != 1 {
		t.Fatalf("crashCount after restart = %d, want 1", newEntry.crashCount)
	}

	statusEvents := collector.eventsByName("lsp:status")
	var sawCrashStatus bool
	for _, event := range statusEvents {
		if len(event.data) == 0 {
			continue
		}
		status, ok := event.data[0].(ServerStatus)
		if ok && status.State == "error" && status.Family == key.family && status.Workspace == key.workspace {
			sawCrashStatus = true
			break
		}
	}
	if !sawCrashStatus {
		t.Error("expected crash status event before restart")
	}

	// Simulate the frontend reconnect flow by re-opening the document on the restarted server.
	if err := mgr.DidOpen(ctx, tsFile, "typescript", 2, "const x = 2;"); err != nil {
		t.Fatalf("DidOpen after restart: %v", err)
	}

	mgr.mu.Lock()
	ds := newEntry.openDocs[uri]
	mgr.mu.Unlock()
	if ds == nil {
		t.Fatal("document state missing after reconnect DidOpen")
	}
	if ds.refCount != 1 {
		t.Errorf("refCount after reconnect DidOpen = %d, want 1", ds.refCount)
	}
	if ds.version != 2 {
		t.Errorf("version after reconnect DidOpen = %d, want 2", ds.version)
	}
}

func TestManager_CrashGiveUpAfterMaxRetries(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	mgr, collector, key := startMockManager(t)
	tmpDir := key.workspace

	tsFile := filepath.Join(tmpDir, "main.ts")
	if err := os.WriteFile(tsFile, []byte("const x = 1;"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := mgr.DidOpen(ctx, tsFile, "typescript", 1, "const x = 1;"); err != nil {
		t.Fatalf("DidOpen: %v", err)
	}

	mgr.mu.Lock()
	entry := mgr.servers[key]
	entry.crashCount = maxCrashRetries
	transport, ok := entry.client.transport.(*StdioTransport)
	mgr.mu.Unlock()
	if !ok {
		t.Fatalf("transport type = %T, want *StdioTransport", entry.client.transport)
	}

	if err := transport.cmd.Process.Kill(); err != nil {
		t.Fatalf("Kill: %v", err)
	}

	waitFor(t, 3*time.Second, "lsp:error event", func() bool {
		return len(collector.eventsByName("lsp:error")) > 0
	})

	mgr.mu.Lock()
	_, serverExists := mgr.servers[key]
	mgr.mu.Unlock()
	if serverExists {
		t.Fatal("server should be removed after exceeding max crash retries")
	}

	if reconnects := collector.eventsByName("lsp:reconnect"); len(reconnects) != 0 {
		t.Fatalf("unexpected reconnect events after giving up: %d", len(reconnects))
	}

	errorEvents := collector.eventsByName("lsp:error")
	lastError := errorEvents[len(errorEvents)-1]
	if len(lastError.data) != 1 {
		t.Fatalf("lsp:error data len = %d, want 1", len(lastError.data))
	}
	payload, ok := lastError.data[0].(map[string]string)
	if !ok {
		t.Fatalf("lsp:error payload type = %T, want map[string]string", lastError.data[0])
	}
	if payload["family"] != key.family {
		t.Errorf("lsp:error family = %q, want %q", payload["family"], key.family)
	}
	if payload["workspace"] != key.workspace {
		t.Errorf("lsp:error workspace = %q, want %q", payload["workspace"], key.workspace)
	}
	if payload["message"] == "" {
		t.Error("expected non-empty lsp:error message")
	}
}

// waitFor polls a condition with a timeout, failing the test if not satisfied.
func waitFor(t *testing.T, timeout time.Duration, desc string, cond func() bool) {
	t.Helper()
	deadline := time.After(timeout)
	for {
		if cond() {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for %s", desc)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

package lsp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

func writeTestExecutable(t *testing.T, dir, name string) string {
	t.Helper()

	if runtime.GOOS == "windows" && filepath.Ext(name) == "" {
		name += ".cmd"
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", dir, err)
	}

	path := filepath.Join(dir, name)
	content := []byte("#!/bin/sh\nexit 0\n")
	if runtime.GOOS == "windows" {
		content = []byte("@echo off\r\nexit /b 0\r\n")
	}

	if err := os.WriteFile(path, content, 0755); err != nil {
		t.Fatalf("WriteFile(%s): %v", path, err)
	}
	return path
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
		{".go", "go", "go"},
		{".py", "python", "python"},
		{".pyw", "python", "python"},
		{".pyi", "python", "python"},
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

func TestRegistry_GoServerConfigUsesGoplsFromPath(t *testing.T) {
	r := NewRegistry()
	binDir := t.TempDir()
	goplsPath := writeTestExecutable(t, binDir, "gopls")
	t.Setenv("PATH", binDir)

	workspace := t.TempDir()
	config, err := r.ServerConfigFor("go", workspace)
	if err != nil {
		t.Fatalf("ServerConfigFor(go): %v", err)
	}

	if config.LanguageFamily != "go" {
		t.Errorf("LanguageFamily = %q, want go", config.LanguageFamily)
	}
	if config.Command != goplsPath {
		t.Errorf("Command = %q, want %q", config.Command, goplsPath)
	}
	if len(config.Args) != 0 {
		t.Errorf("Args = %v, want none", config.Args)
	}
	if config.Dir != workspace {
		t.Errorf("Dir = %q, want %q", config.Dir, workspace)
	}
}

func TestRegistry_GoServerConfigUsesDetectedProjectRoot(t *testing.T) {
	r := NewRegistry()
	binDir := t.TempDir()
	writeTestExecutable(t, binDir, "gopls")
	t.Setenv("PATH", binDir)

	repoRoot := t.TempDir()
	moduleRoot := filepath.Join(repoRoot, "services", "api")
	if err := os.MkdirAll(moduleRoot, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	config, err := r.ServerConfigFor("go", moduleRoot)
	if err != nil {
		t.Fatalf("ServerConfigFor(go): %v", err)
	}

	if config.Dir != moduleRoot {
		t.Errorf("Dir = %q, want detected module root %q", config.Dir, moduleRoot)
	}
}

func TestRegistry_GoServerConfigReportsMissingGopls(t *testing.T) {
	r := NewRegistry()
	t.Setenv("PATH", "")

	_, err := r.ServerConfigFor("go", t.TempDir())
	if err == nil {
		t.Fatal("expected error when gopls is not found")
	}
	if !contains(err.Error(), "go install golang.org/x/tools/gopls@latest") {
		t.Errorf("error should include install instructions, got: %s", err.Error())
	}
}

func TestRegistry_PythonServerConfigPrefersWorkspaceLocalPyright(t *testing.T) {
	r := NewRegistry()
	t.Setenv("VIRTUAL_ENV", "")
	workspace := t.TempDir()
	localBin := filepath.Join(workspace, "node_modules", ".bin")
	if err := os.MkdirAll(localBin, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	pyrightPath := writeTestExecutable(t, localBin, "pyright-langserver")
	t.Setenv("PATH", "")

	config, err := r.ServerConfigFor("python", workspace)
	if err != nil {
		t.Fatalf("ServerConfigFor(python): %v", err)
	}

	if config.LanguageFamily != "python" {
		t.Errorf("LanguageFamily = %q, want python", config.LanguageFamily)
	}
	if config.Command != pyrightPath {
		t.Errorf("Command = %q, want %q", config.Command, pyrightPath)
	}
	if len(config.Args) != 1 || config.Args[0] != "--stdio" {
		t.Errorf("Args = %v, want [--stdio]", config.Args)
	}
	if config.Dir != workspace {
		t.Errorf("Dir = %q, want %q", config.Dir, workspace)
	}
}

func TestRegistry_PythonServerConfigPrefersActiveVirtualEnvPyright(t *testing.T) {
	r := NewRegistry()
	projectRoot := t.TempDir()

	venvPath := t.TempDir()
	venvPyrightPath := writeTestExecutable(t, pythonVirtualEnvScriptDir(venvPath), "pyright-langserver")
	t.Setenv("VIRTUAL_ENV", venvPath)

	localBin := filepath.Join(projectRoot, "node_modules", ".bin")
	if err := os.MkdirAll(localBin, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	writeTestExecutable(t, localBin, "pyright-langserver")

	systemBin := t.TempDir()
	writeTestExecutable(t, systemBin, "pyright-langserver")
	t.Setenv("PATH", systemBin)

	config, err := r.ServerConfigFor("python", projectRoot)
	if err != nil {
		t.Fatalf("ServerConfigFor(python): %v", err)
	}

	if config.Command != venvPyrightPath {
		t.Errorf("Command = %q, want active virtualenv %q", config.Command, venvPyrightPath)
	}
	if config.Dir != projectRoot {
		t.Errorf("Dir = %q, want detected project root %q", config.Dir, projectRoot)
	}
}

func TestRegistry_PythonServerConfigUsesProjectVirtualEnvBeforePath(t *testing.T) {
	r := NewRegistry()
	projectRoot := t.TempDir()

	venvPath := filepath.Join(projectRoot, ".venv")
	venvPyrightPath := writeTestExecutable(t, pythonVirtualEnvScriptDir(venvPath), "pyright-langserver")

	systemBin := t.TempDir()
	writeTestExecutable(t, systemBin, "pyright-langserver")
	t.Setenv("PATH", systemBin)

	config, err := r.ServerConfigFor("python", projectRoot)
	if err != nil {
		t.Fatalf("ServerConfigFor(python): %v", err)
	}

	if config.Command != venvPyrightPath {
		t.Errorf("Command = %q, want project virtualenv %q", config.Command, venvPyrightPath)
	}
}

func TestRegistry_PythonServerConfigPrefersDetectedProjectLocalPyright(t *testing.T) {
	r := NewRegistry()
	t.Setenv("VIRTUAL_ENV", "")
	repoRoot := t.TempDir()
	projectRoot := filepath.Join(repoRoot, "services", "api")
	localBin := filepath.Join(projectRoot, "node_modules", ".bin")
	if err := os.MkdirAll(localBin, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	pyrightPath := writeTestExecutable(t, localBin, "pyright-langserver")

	systemBin := t.TempDir()
	writeTestExecutable(t, systemBin, "pyright-langserver")
	t.Setenv("PATH", systemBin)

	config, err := r.ServerConfigFor("python", projectRoot)
	if err != nil {
		t.Fatalf("ServerConfigFor(python): %v", err)
	}

	if config.Command != pyrightPath {
		t.Errorf("Command = %q, want project-local %q", config.Command, pyrightPath)
	}
	if config.Dir != projectRoot {
		t.Errorf("Dir = %q, want detected project root %q", config.Dir, projectRoot)
	}
}

func TestRegistry_PythonServerConfigReportsMissingPyright(t *testing.T) {
	r := NewRegistry()
	t.Setenv("PATH", "")
	t.Setenv("VIRTUAL_ENV", filepath.Join(t.TempDir(), "missing-venv"))

	_, err := r.ServerConfigFor("python", t.TempDir())
	if err == nil {
		t.Fatal("expected error when pyright-langserver is not found")
	}
	if !contains(err.Error(), "npm install -g pyright") {
		t.Errorf("error should include install instructions, got: %s", err.Error())
	}
}

func pythonVirtualEnvScriptDir(venvPath string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(venvPath, "Scripts")
	}
	return filepath.Join(venvPath, "bin")
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
	err := mgr.DidOpen(ctx, "/tmp/test/main.rs", "", 1, "fn main() {}")
	if err != nil {
		t.Errorf("DidOpen unsupported file should be no-op, got: %v", err)
	}
}

func TestManager_SetWorkspaceRootClearsStoppedFlag(t *testing.T) {
	mgr, _ := newTestManager(t)
	mgr.SetWorkspaceRoot("/tmp/old")
	mgr.ShutdownAll(time.Millisecond)

	mgr.mu.Lock()
	stoppedAfterShutdown := mgr.stopped
	mgr.mu.Unlock()
	if !stoppedAfterShutdown {
		t.Fatal("stopped should be true after ShutdownAll")
	}

	mgr.SetWorkspaceRoot("/tmp/new")

	mgr.mu.Lock()
	stoppedAfterSwitch := mgr.stopped
	mgr.mu.Unlock()
	if stoppedAfterSwitch {
		t.Fatal("stopped should be false after setting a new workspace root")
	}
}

func TestManager_InitializingServerAbandonedAfterWorkspaceSwitch(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	oldWorkspace := t.TempDir()
	newWorkspace := t.TempDir()
	collector := &eventCollector{}
	mgr := &Manager{
		registry: NewRegistry(),
		emitter:  collector.emit,
		servers:  make(map[serverKey]*serverEntry),
		docKeys:  make(map[string]serverKey),
	}
	mgr.SetWorkspaceRoot(oldWorkspace)

	config := &ServerConfig{
		LanguageFamily: "typescript",
		Command:        os.Args[0],
		Args:           []string{"-test.run=^TestMockServerProcess$"},
	}

	t.Setenv("FIRN_MOCK_LSP", "1")
	t.Setenv("FIRN_MOCK_LSP_INITIALIZE_DELAY_MS", "200")

	key := serverKey{family: "typescript", workspace: oldWorkspace}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	type startResult struct {
		entry *serverEntry
		err   error
	}
	resultCh := make(chan startResult, 1)
	go func() {
		entry, err := mgr.startServer(ctx, key, config)
		resultCh <- startResult{entry: entry, err: err}
	}()

	time.Sleep(50 * time.Millisecond)
	mgr.ShutdownAll(time.Second)
	mgr.SetWorkspaceRoot(newWorkspace)

	var result startResult
	select {
	case result = <-resultCh:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for delayed startServer")
	}

	if result.err == nil {
		t.Fatal("expected stale initializing server to return an error")
	}
	if result.entry != nil {
		t.Fatal("expected stale initializing server not to return an entry")
	}

	mgr.mu.Lock()
	_, oldExists := mgr.servers[key]
	serverCount := len(mgr.servers)
	mgr.mu.Unlock()
	if oldExists || serverCount != 0 {
		t.Fatalf("stale server remained registered: oldExists=%v serverCount=%d", oldExists, serverCount)
	}

	for _, event := range collector.eventsByName("lsp:status") {
		if len(event.data) == 0 {
			continue
		}
		status, ok := event.data[0].(ServerStatus)
		if ok && status.Workspace == oldWorkspace && status.State == "ready" {
			t.Fatal("stale initializing server emitted ready after workspace switch")
		}
	}
}

func TestManager_InitializeFailureStatusIncludesBoundedStderrAndCommand(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	workspace := t.TempDir()
	mgr, collector := newTestManager(t)
	mgr.SetWorkspaceRoot(workspace)

	stderrPrefix := "mock initialize failed: "
	stderrBody := strings.Repeat("x", maxStderrCapture+256) + "UNCAPTURED_TAIL"
	t.Setenv("FIRN_MOCK_LSP", "1")
	t.Setenv("FIRN_MOCK_LSP_INITIALIZE_STDERR", stderrPrefix+stderrBody)

	key := serverKey{family: "typescript", workspace: workspace}
	config := &ServerConfig{
		LanguageFamily: "typescript",
		Command:        os.Args[0],
		Args:           []string{"-test.run=^TestMockServerProcess$"},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := mgr.startServer(ctx, key, config)
	if err == nil {
		t.Fatal("expected initialize failure")
	}
	if !strings.Contains(err.Error(), stderrPrefix) {
		t.Fatalf("returned error should include stderr prefix, got: %s", err)
	}
	if strings.Contains(err.Error(), "UNCAPTURED_TAIL") {
		t.Fatalf("returned error should include bounded stderr, got tail in: %s", err)
	}

	var errorStatus *ServerStatus
	for _, event := range collector.eventsByName("lsp:status") {
		if len(event.data) == 0 {
			continue
		}
		status, ok := event.data[0].(ServerStatus)
		if ok && status.State == "error" && status.Family == key.family && status.Workspace == key.workspace {
			errorStatus = &status
		}
	}
	if errorStatus == nil {
		t.Fatal("expected error status event")
	}
	if errorStatus.Command != os.Args[0] {
		t.Fatalf("status command = %q, want %q", errorStatus.Command, os.Args[0])
	}
	if !strings.Contains(errorStatus.Error, stderrPrefix) {
		t.Fatalf("status error should include stderr prefix, got: %s", errorStatus.Error)
	}
	if strings.Contains(errorStatus.Error, "UNCAPTURED_TAIL") {
		t.Fatalf("status error should include bounded stderr, got tail in: %s", errorStatus.Error)
	}
}

func TestManager_DropsDiagnosticsAfterWorkspaceSwitch(t *testing.T) {
	oldWorkspace := t.TempDir()
	newWorkspace := t.TempDir()
	mgr, collector := newTestManager(t)
	mgr.SetWorkspaceRoot(oldWorkspace)
	mgr.SetWorkspaceRoot(newWorkspace)

	uri, err := FileToURI(filepath.Join(oldWorkspace, "main.ts"))
	if err != nil {
		t.Fatalf("FileToURI: %v", err)
	}
	paramsJSON, err := json.Marshal(PublishDiagnosticsParams{
		URI: uri,
		Diagnostics: []Diagnostic{
			{
				Range:   Range{Start: Position{Line: 0, Character: 0}, End: Position{Line: 0, Character: 1}},
				Message: "stale diagnostic",
			},
		},
	})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	mgr.handleNotification(serverKey{family: "typescript", workspace: oldWorkspace}, "textDocument/publishDiagnostics", paramsJSON)

	if diagnostics := collector.eventsByName("lsp:diagnostics"); len(diagnostics) != 0 {
		t.Fatalf("expected stale diagnostics to be dropped, got %d events", len(diagnostics))
	}
}

func TestManager_StartupFailureStatusIncludesCommandAndInstallHint(t *testing.T) {
	workspace := t.TempDir()
	mgr, collector := newTestManager(t)
	mgr.SetWorkspaceRoot(workspace)
	t.Setenv("PATH", "")

	err := mgr.DidOpen(context.Background(), filepath.Join(workspace, "main.go"), "go", 1, "package main")
	if err == nil {
		t.Fatal("expected missing gopls error")
	}

	statusEvents := collector.eventsByName("lsp:status")
	if len(statusEvents) == 0 {
		t.Fatal("expected lsp:status event")
	}

	last := statusEvents[len(statusEvents)-1]
	if len(last.data) != 1 {
		t.Fatalf("status event data len = %d, want 1", len(last.data))
	}
	status, ok := last.data[0].(ServerStatus)
	if !ok {
		t.Fatalf("status payload type = %T, want ServerStatus", last.data[0])
	}
	if status.Family != "go" {
		t.Fatalf("status family = %q, want go", status.Family)
	}
	if status.Workspace != workspace {
		t.Fatalf("status workspace = %q, want %q", status.Workspace, workspace)
	}
	if status.Command != "gopls" {
		t.Fatalf("status command = %q, want gopls", status.Command)
	}
	if status.State != "error" {
		t.Fatalf("status state = %q, want error", status.State)
	}
	if !strings.Contains(status.Error, "go install golang.org/x/tools/gopls@latest") {
		t.Fatalf("status error should include install guidance, got: %s", status.Error)
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
		docKeys:  make(map[string]serverKey),
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
	// Mock server advertises triggerCharacters: [".", ":"]
	if len(statuses[0].CompletionTriggerCharacters) != 2 {
		t.Errorf("CompletionTriggerCharacters = %v, want 2 entries", statuses[0].CompletionTriggerCharacters)
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

// --- Per-project-root routing (#20) ---

func TestManager_ProjectRootForPath_TypeScriptUsesNearestMarker(t *testing.T) {
	mgr, _ := newTestManager(t)
	ws := t.TempDir()
	touch(t, filepath.Join(ws, "package.json"))              // repo-root
	touch(t, filepath.Join(ws, "frontend", "tsconfig.json")) // package-local
	file := filepath.Join(ws, "frontend", "src", "App.tsx")
	touch(t, file)
	mgr.SetWorkspaceRoot(ws)

	root, err := mgr.projectRootForPath("typescript", file)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := filepath.Join(ws, "frontend")
	if root != want {
		t.Errorf("root = %q, want %q (nearest tsconfig.json should win)", root, want)
	}
}

func TestManager_ProjectRootForPath_GoUsesNearestGoMod(t *testing.T) {
	mgr, _ := newTestManager(t)
	ws := t.TempDir()
	touch(t, filepath.Join(ws, "go.mod"))
	touch(t, filepath.Join(ws, "cmd", "tool", "go.mod"))
	file := filepath.Join(ws, "cmd", "tool", "main.go")
	touch(t, file)
	mgr.SetWorkspaceRoot(ws)

	root, err := mgr.projectRootForPath("go", file)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := filepath.Join(ws, "cmd", "tool")
	if root != want {
		t.Errorf("Go project root = %q, want nearest go.mod root %q", root, want)
	}
}

func TestManager_ProjectRootForPath_PythonUsesNearestProjectMarker(t *testing.T) {
	for _, marker := range []string{"pyproject.toml", "requirements.txt", "setup.py"} {
		t.Run(marker, func(t *testing.T) {
			mgr, _ := newTestManager(t)
			ws := t.TempDir()
			touch(t, filepath.Join(ws, "pyproject.toml"))

			project := filepath.Join(ws, "service")
			touch(t, filepath.Join(project, marker))
			file := filepath.Join(project, "src", "app.py")
			touch(t, file)
			mgr.SetWorkspaceRoot(ws)

			root, err := mgr.projectRootForPath("python", file)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if root != project {
				t.Errorf("Python project root = %q, want nearest %s root %q", root, marker, project)
			}
		})
	}
}

func TestManager_ProjectRootForPath_PathOutsideWorkspaceReturnsError(t *testing.T) {
	mgr, _ := newTestManager(t)
	ws := t.TempDir()
	outside := t.TempDir()
	file := filepath.Join(outside, "stray.ts")
	touch(t, file)
	mgr.SetWorkspaceRoot(ws)

	_, err := mgr.projectRootForPath("typescript", file)
	if !errors.Is(err, ErrPathOutsideWorkspace) {
		t.Fatalf("got error %v, want ErrPathOutsideWorkspace", err)
	}
}

func TestManager_ProjectRootForPath_NoWorkspaceReturnsSentinel(t *testing.T) {
	mgr, _ := newTestManager(t)
	_, err := mgr.projectRootForPath("typescript", "/tmp/foo.ts")
	if !errors.Is(err, errNoWorkspaceRoot) {
		t.Fatalf("got error %v, want errNoWorkspaceRoot", err)
	}
}

func TestManager_DidOpen_PathOutsideWorkspaceIsSilentNoop(t *testing.T) {
	mgr, collector := newTestManager(t)
	ws := t.TempDir()
	outside := t.TempDir()
	file := filepath.Join(outside, "stray.ts")
	touch(t, file)
	mgr.SetWorkspaceRoot(ws)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	if err := mgr.DidOpen(ctx, file, "typescript", 1, ""); err != nil {
		t.Fatalf("DidOpen for out-of-workspace path must be a silent no-op, got %v", err)
	}
	mgr.mu.Lock()
	serverCount := len(mgr.servers)
	mgr.mu.Unlock()
	if serverCount != 0 {
		t.Errorf("expected no servers, got %d", serverCount)
	}
	if len(collector.eventsByName("lsp:status")) != 0 {
		t.Errorf("expected no status events for out-of-workspace path")
	}
}

// startMockManagerAtRoot starts a mock LSP server at the given project root
// inside the active workspace, returning the manager and the server key. The
// caller is responsible for SetWorkspaceRoot before calling.
func startMockServerAt(t *testing.T, mgr *Manager, family, root string) serverKey {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	t.Setenv("FIRN_MOCK_LSP", "1")

	key := serverKey{family: family, workspace: root}
	cfg := &ServerConfig{
		LanguageFamily: family,
		Command:        os.Args[0],
		Args:           []string{"-test.run=^TestMockServerProcess$"},
	}
	if _, err := mgr.startServer(ctx, key, cfg); err != nil {
		t.Fatalf("startServer at %s: %v", root, err)
	}
	return key
}

func TestManager_DistinctProjectRootsKeepSeparateServers(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	ws := t.TempDir()
	touch(t, filepath.Join(ws, "frontend", "tsconfig.json"))
	touch(t, filepath.Join(ws, "admin", "package.json"))
	fileA := filepath.Join(ws, "frontend", "src", "a.ts")
	fileB := filepath.Join(ws, "admin", "src", "b.ts")
	touch(t, fileA)
	touch(t, fileB)

	collector := &eventCollector{}
	mgr := &Manager{
		registry: NewRegistry(),
		emitter:  collector.emit,
		servers:  make(map[serverKey]*serverEntry),
		docKeys:  make(map[string]serverKey),
	}
	mgr.SetWorkspaceRoot(ws)
	t.Cleanup(func() { mgr.ShutdownAll(5 * time.Second) })

	rootA, err := mgr.projectRootForPath("typescript", fileA)
	if err != nil {
		t.Fatalf("rootA: %v", err)
	}
	rootB, err := mgr.projectRootForPath("typescript", fileB)
	if err != nil {
		t.Fatalf("rootB: %v", err)
	}
	if rootA == rootB {
		t.Fatalf("expected distinct project roots, got both = %q", rootA)
	}

	keyA := startMockServerAt(t, mgr, "typescript", rootA)
	keyB := startMockServerAt(t, mgr, "typescript", rootB)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := mgr.DidOpen(ctx, fileA, "typescript", 1, "// a"); err != nil {
		t.Fatalf("DidOpen A: %v", err)
	}
	if err := mgr.DidOpen(ctx, fileB, "typescript", 1, "// b"); err != nil {
		t.Fatalf("DidOpen B: %v", err)
	}

	uriA, _ := FileToURI(fileA)
	uriB, _ := FileToURI(fileB)
	mgr.mu.Lock()
	entryA, hasA := mgr.servers[keyA]
	entryB, hasB := mgr.servers[keyB]
	mgr.mu.Unlock()
	if !hasA || !hasB {
		t.Fatalf("expected two servers, got hasA=%v hasB=%v", hasA, hasB)
	}
	if entryA == entryB {
		t.Fatal("expected distinct serverEntry pointers per project root")
	}

	mgr.mu.Lock()
	_, aOwnsItsDoc := entryA.openDocs[uriA]
	_, aLeakedB := entryA.openDocs[uriB]
	_, bOwnsItsDoc := entryB.openDocs[uriB]
	_, bLeakedA := entryB.openDocs[uriA]
	mgr.mu.Unlock()
	if !aOwnsItsDoc || !bOwnsItsDoc {
		t.Errorf("server missing its own document: a=%v b=%v", aOwnsItsDoc, bOwnsItsDoc)
	}
	if aLeakedB || bLeakedA {
		t.Errorf("cross-root document leak: aLeakedB=%v bLeakedA=%v", aLeakedB, bLeakedA)
	}

	// Closing the document at root A must only tear down server A.
	if err := mgr.DidClose(ctx, fileA); err != nil {
		t.Fatalf("DidClose A: %v", err)
	}
	mgr.mu.Lock()
	_, aStillExists := mgr.servers[keyA]
	_, bStillExists := mgr.servers[keyB]
	mgr.mu.Unlock()
	if aStillExists {
		t.Error("server A should be torn down after its last document closed")
	}
	if !bStillExists {
		t.Error("server B should remain after closing only A's document")
	}
}

func TestManager_SameProjectRootSharesOneServer(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	ws := t.TempDir()
	touch(t, filepath.Join(ws, "pkg", "tsconfig.json"))
	fileA := filepath.Join(ws, "pkg", "src", "a.ts")
	fileB := filepath.Join(ws, "pkg", "src", "deeper", "b.tsx")
	touch(t, fileA)
	touch(t, fileB)

	collector := &eventCollector{}
	mgr := &Manager{
		registry: NewRegistry(),
		emitter:  collector.emit,
		servers:  make(map[serverKey]*serverEntry),
		docKeys:  make(map[string]serverKey),
	}
	mgr.SetWorkspaceRoot(ws)
	t.Cleanup(func() { mgr.ShutdownAll(5 * time.Second) })

	root, err := mgr.projectRootForPath("typescript", fileA)
	if err != nil {
		t.Fatalf("root: %v", err)
	}
	key := startMockServerAt(t, mgr, "typescript", root)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := mgr.DidOpen(ctx, fileA, "typescript", 1, "// a"); err != nil {
		t.Fatalf("DidOpen A: %v", err)
	}
	if err := mgr.DidOpen(ctx, fileB, "typescriptreact", 1, "// b"); err != nil {
		t.Fatalf("DidOpen B: %v", err)
	}

	mgr.mu.Lock()
	serverCount := len(mgr.servers)
	docCount := len(mgr.servers[key].openDocs)
	mgr.mu.Unlock()
	if serverCount != 1 {
		t.Errorf("expected 1 shared server, got %d", serverCount)
	}
	if docCount != 2 {
		t.Errorf("expected 2 documents on shared server, got %d", docCount)
	}
}

func TestManager_DocKeysCachePopulatedOnDidOpenClearedOnDidClose(t *testing.T) {
	// The cache eliminates per-keystroke filesystem walks for DidChange/
	// DidSave/Hover/Definition/Complete. Verify that DidOpen populates it,
	// DidClose tears it down, and refcount > 1 keeps it alive.
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	ws := t.TempDir()
	touch(t, filepath.Join(ws, "pkg", "tsconfig.json"))
	file := filepath.Join(ws, "pkg", "src", "main.ts")
	touch(t, file)

	collector := &eventCollector{}
	mgr := &Manager{
		registry: NewRegistry(),
		emitter:  collector.emit,
		servers:  make(map[serverKey]*serverEntry),
		docKeys:  make(map[string]serverKey),
	}
	mgr.SetWorkspaceRoot(ws)
	t.Cleanup(func() { mgr.ShutdownAll(5 * time.Second) })

	root, err := mgr.projectRootForPath("typescript", file)
	if err != nil {
		t.Fatalf("root: %v", err)
	}
	startMockServerAt(t, mgr, "typescript", root)

	uri, _ := FileToURI(file)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Before DidOpen, cache is empty.
	mgr.mu.Lock()
	_, hasBefore := mgr.docKeys[uri]
	mgr.mu.Unlock()
	if hasBefore {
		t.Fatal("docKeys should be empty before DidOpen")
	}

	// First DidOpen populates cache with the resolved project root.
	if err := mgr.DidOpen(ctx, file, "typescript", 1, "// a"); err != nil {
		t.Fatalf("DidOpen 1: %v", err)
	}
	mgr.mu.Lock()
	cachedKey, ok := mgr.docKeys[uri]
	mgr.mu.Unlock()
	if !ok {
		t.Fatal("docKeys should contain entry after DidOpen")
	}
	if cachedKey.workspace != root || cachedKey.family != "typescript" {
		t.Errorf("cached key = %+v, want {typescript, %s}", cachedKey, root)
	}

	// Second DidOpen (refcount 2) keeps cache alive.
	if err := mgr.DidOpen(ctx, file, "typescript", 1, "// a"); err != nil {
		t.Fatalf("DidOpen 2: %v", err)
	}
	mgr.mu.Lock()
	_, stillCached := mgr.docKeys[uri]
	mgr.mu.Unlock()
	if !stillCached {
		t.Fatal("docKeys entry should persist while refcount > 0")
	}

	// First DidClose (refcount 1) leaves cache in place.
	if err := mgr.DidClose(ctx, file); err != nil {
		t.Fatalf("DidClose 1: %v", err)
	}
	mgr.mu.Lock()
	_, afterFirstClose := mgr.docKeys[uri]
	mgr.mu.Unlock()
	if !afterFirstClose {
		t.Error("docKeys entry should persist after DidClose with refcount > 0")
	}

	// Final DidClose (refcount 0) clears the cache.
	if err := mgr.DidClose(ctx, file); err != nil {
		t.Fatalf("DidClose 2: %v", err)
	}
	mgr.mu.Lock()
	_, afterLastClose := mgr.docKeys[uri]
	mgr.mu.Unlock()
	if afterLastClose {
		t.Error("docKeys entry should be removed after final DidClose")
	}
}

func TestManager_DidChangeUsesCacheNotFilesystem(t *testing.T) {
	// Proves the perf invariant: once DidOpen has cached the document's
	// project root, subsequent DidChange / Hover / Definition / Complete
	// calls route through serverForPath WITHOUT walking the filesystem.
	//
	// We assert this indirectly by deleting the marker file after DidOpen.
	// If the hot path re-resolved on every call, removing the marker would
	// cause routing to fall back to workspaceRoot — a different key — and
	// the request would land on no server. With the cache, routing remains
	// pinned to the original project root.
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	ws := t.TempDir()
	marker := filepath.Join(ws, "pkg", "tsconfig.json")
	touch(t, marker)
	file := filepath.Join(ws, "pkg", "src", "main.ts")
	touch(t, file)

	collector := &eventCollector{}
	mgr := &Manager{
		registry: NewRegistry(),
		emitter:  collector.emit,
		servers:  make(map[serverKey]*serverEntry),
		docKeys:  make(map[string]serverKey),
	}
	mgr.SetWorkspaceRoot(ws)
	t.Cleanup(func() { mgr.ShutdownAll(5 * time.Second) })

	pkgRoot := filepath.Join(ws, "pkg")
	startMockServerAt(t, mgr, "typescript", pkgRoot)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := mgr.DidOpen(ctx, file, "typescript", 1, "// a"); err != nil {
		t.Fatalf("DidOpen: %v", err)
	}

	// Remove the marker — if the hot path were re-resolving, this would
	// shift the resolved root to ws and the request would miss our pkg
	// server.
	if err := os.Remove(marker); err != nil {
		t.Fatalf("remove marker: %v", err)
	}

	// serverForPath must still find the pkg-rooted server via the cache.
	uri, _ := FileToURI(file)
	entry, gotURI, key := mgr.serverForPath(file)
	if entry == nil {
		t.Fatal("serverForPath returned nil after marker removal — cache not honored on hot path")
	}
	if gotURI != uri {
		t.Errorf("uri = %q, want %q", gotURI, uri)
	}
	if key.workspace != pkgRoot {
		t.Errorf("routed to workspace %q, want cached %q", key.workspace, pkgRoot)
	}
}

func TestManager_ShutdownAllTearsDownAllRoots(t *testing.T) {
	if os.Getenv("FIRN_MOCK_LSP") == "1" {
		t.Skip("running as mock server")
	}

	ws := t.TempDir()
	touch(t, filepath.Join(ws, "a", "tsconfig.json"))
	touch(t, filepath.Join(ws, "b", "tsconfig.json"))

	collector := &eventCollector{}
	mgr := &Manager{
		registry: NewRegistry(),
		emitter:  collector.emit,
		servers:  make(map[serverKey]*serverEntry),
		docKeys:  make(map[string]serverKey),
	}
	mgr.SetWorkspaceRoot(ws)

	startMockServerAt(t, mgr, "typescript", filepath.Join(ws, "a"))
	startMockServerAt(t, mgr, "typescript", filepath.Join(ws, "b"))

	mgr.mu.Lock()
	beforeCount := len(mgr.servers)
	mgr.mu.Unlock()
	if beforeCount != 2 {
		t.Fatalf("expected 2 servers before shutdown, got %d", beforeCount)
	}

	mgr.ShutdownAll(5 * time.Second)

	mgr.mu.Lock()
	afterCount := len(mgr.servers)
	mgr.mu.Unlock()
	if afterCount != 0 {
		t.Errorf("expected 0 servers after ShutdownAll, got %d", afterCount)
	}
}

package lsp

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"sync"
	"time"
)

const (
	// serverShutdownTimeout is the time allowed for a single server to shut down gracefully.
	serverShutdownTimeout = 5 * time.Second
	// maxCrashRetries is the maximum number of crash recovery attempts before giving up.
	maxCrashRetries = 5
	// maxCrashBackoff caps the exponential backoff duration.
	maxCrashBackoff = 30 * time.Second
	// crashRestartTimeout is the timeout for a crash-recovery server restart.
	crashRestartTimeout = 30 * time.Second
)

// ServerStatus represents the current status of a language server.
type ServerStatus struct {
	Family    string `json:"family"`
	Workspace string `json:"workspace"`
	State     string `json:"state"` // "starting", "ready", "stopping", "stopped", "error"
	Error     string `json:"error,omitempty"`
}

// EventEmitter is the callback signature for emitting events to the frontend.
type EventEmitter func(event string, data ...any)

// Manager owns workspace-scoped language server instances.
type Manager struct {
	registry *Registry
	emitter  EventEmitter

	mu      sync.Mutex
	servers map[serverKey]*serverEntry

	// workspaceRoot is the active workspace root path (not URI).
	workspaceRoot string
}

// serverKey identifies a unique server instance by language family and workspace.
type serverKey struct {
	family    string
	workspace string
}

// serverEntry tracks a running server and its open documents.
type serverEntry struct {
	client     *Client
	config     *ServerConfig
	openDocs   map[string]int // URI -> version
	crashCount int
	lastCrash  time.Time
	stopping   bool
}

// NewManager creates a new LSP manager with the given event emitter.
func NewManager(emitter EventEmitter) *Manager {
	return &Manager{
		registry: NewRegistry(),
		emitter:  emitter,
		servers:  make(map[serverKey]*serverEntry),
	}
}

// SetWorkspaceRoot updates the active workspace root path.
// This does NOT shut down existing servers — call ShutdownAll first if switching workspaces.
func (m *Manager) SetWorkspaceRoot(root string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.workspaceRoot = root
}

// WorkspaceRoot returns the current workspace root path.
func (m *Manager) WorkspaceRoot() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.workspaceRoot
}

// DidOpen handles a document being opened. Starts a server if needed,
// then sends textDocument/didOpen to the appropriate server.
func (m *Manager) DidOpen(ctx context.Context, path, languageID string, version int, content string) error {
	ext := filepath.Ext(path)
	family := m.registry.FamilyForExtension(ext)
	if family == "" {
		return nil // unsupported file type — no-op
	}

	if languageID == "" {
		languageID = m.registry.LanguageIDForExtension(ext)
	}

	uri, err := FileToURI(path)
	if err != nil {
		return fmt.Errorf("invalid path %q: %w", path, err)
	}

	m.mu.Lock()
	workspace := m.workspaceRoot
	m.mu.Unlock()

	if workspace == "" {
		return fmt.Errorf("no workspace root set")
	}

	entry, err := m.ensureServer(ctx, family, workspace)
	if err != nil {
		return err
	}

	m.mu.Lock()
	entry.openDocs[uri] = version
	m.mu.Unlock()

	return entry.client.DidOpen(uri, languageID, version, content)
}

// DidChange forwards content changes to the appropriate server.
func (m *Manager) DidChange(path string, version int, changes []TextDocumentContentChangeEvent) error {
	entry, uri := m.serverForPath(path)
	if entry == nil {
		return nil
	}

	m.mu.Lock()
	entry.openDocs[uri] = version
	m.mu.Unlock()

	return entry.client.DidChange(uri, version, changes)
}

// DidSave forwards save notification to the appropriate server.
func (m *Manager) DidSave(path string) error {
	entry, uri := m.serverForPath(path)
	if entry == nil {
		return nil
	}
	return entry.client.DidSave(uri)
}

// DidClose forwards close notification and decrements the document reference count.
// Shuts down the server when no documents remain open.
func (m *Manager) DidClose(ctx context.Context, path string) error {
	ext := filepath.Ext(path)
	family := m.registry.FamilyForExtension(ext)
	if family == "" {
		return nil
	}

	uri, err := FileToURI(path)
	if err != nil {
		return fmt.Errorf("invalid path %q: %w", path, err)
	}

	m.mu.Lock()
	workspace := m.workspaceRoot
	key := serverKey{family: family, workspace: workspace}
	entry, ok := m.servers[key]
	if !ok {
		m.mu.Unlock()
		return nil
	}

	delete(entry.openDocs, uri)
	shouldShutdown := len(entry.openDocs) == 0
	m.mu.Unlock()

	// Send didClose to the server before initiating shutdown
	if err := entry.client.DidClose(uri); err != nil {
		log.Printf("lsp: didClose failed for %s: %v", uri, err)
	}

	// Shut down server if no more documents are open.
	// Re-check under lock in case a concurrent DidOpen added a document.
	if shouldShutdown {
		m.mu.Lock()
		if len(entry.openDocs) > 0 {
			// Another goroutine opened a document while we were sending didClose
			m.mu.Unlock()
			return nil
		}
		entry.stopping = true
		m.mu.Unlock()
		shutCtx, cancel := context.WithTimeout(context.Background(), serverShutdownTimeout)
		defer cancel()
		m.shutdownServer(shutCtx, key)
	}

	return nil
}

// Hover sends a hover request for the given file position.
func (m *Manager) Hover(ctx context.Context, path string, line, character int) (*Hover, error) {
	entry, uri := m.serverForPath(path)
	if entry == nil {
		return nil, fmt.Errorf("no language server for %s", path)
	}
	return entry.client.Hover(ctx, uri, line, character)
}

// Definition sends a go-to-definition request for the given file position.
func (m *Manager) Definition(ctx context.Context, path string, line, character int) ([]Location, error) {
	entry, uri := m.serverForPath(path)
	if entry == nil {
		return nil, fmt.Errorf("no language server for %s", path)
	}
	return entry.client.Definition(ctx, uri, line, character)
}

// Complete sends a completion request for the given file position.
func (m *Manager) Complete(ctx context.Context, path string, line, character int, triggerChar string) (*CompletionList, error) {
	entry, uri := m.serverForPath(path)
	if entry == nil {
		return nil, fmt.Errorf("no language server for %s", path)
	}
	return entry.client.Complete(ctx, uri, line, character, triggerChar)
}

// GetStatus returns the status of all running language servers.
func (m *Manager) GetStatus() []ServerStatus {
	m.mu.Lock()
	defer m.mu.Unlock()

	statuses := make([]ServerStatus, 0, len(m.servers))
	for key, entry := range m.servers {
		state := "ready"
		switch entry.client.State() {
		case ClientStateInitializing:
			state = "starting"
		case ClientStateShuttingDown:
			state = "stopping"
		case ClientStateStopped:
			state = "stopped"
		}
		if entry.stopping {
			state = "stopping"
		}

		statuses = append(statuses, ServerStatus{
			Family:    key.family,
			Workspace: key.workspace,
			State:     state,
		})
	}
	return statuses
}

// ShutdownAll gracefully shuts down all running language servers.
// Used during workspace switches and app close.
func (m *Manager) ShutdownAll(timeout time.Duration) {
	m.mu.Lock()
	keys := make([]serverKey, 0, len(m.servers))
	for key := range m.servers {
		keys = append(keys, key)
	}
	m.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var wg sync.WaitGroup
	for _, key := range keys {
		wg.Add(1)
		go func(k serverKey) {
			defer wg.Done()
			m.shutdownServer(ctx, k)
		}(key)
	}
	wg.Wait()
}

// --- internal ---

// ensureServer returns an existing server or starts a new one for the given family/workspace.
func (m *Manager) ensureServer(ctx context.Context, family, workspace string) (*serverEntry, error) {
	key := serverKey{family: family, workspace: workspace}

	m.mu.Lock()
	if entry, ok := m.servers[key]; ok {
		m.mu.Unlock()
		return entry, nil
	}
	m.mu.Unlock()

	// Resolve server config
	config, err := m.registry.ServerConfigFor(family, workspace)
	if err != nil {
		m.emitStatus(family, workspace, "error", err.Error())
		return nil, err
	}

	return m.startServer(ctx, key, config)
}

// startServer launches a new language server process and initializes it.
func (m *Manager) startServer(ctx context.Context, key serverKey, config *ServerConfig) (*serverEntry, error) {
	m.emitStatus(key.family, key.workspace, "starting", "")

	transport, err := NewStdioTransport(config.Command, config.Args...)
	if err != nil {
		m.emitStatus(key.family, key.workspace, "error", err.Error())
		return nil, fmt.Errorf("start server %s: %w", config.Command, err)
	}

	entry := &serverEntry{
		config:   config,
		openDocs: make(map[string]int),
	}

	client := NewClient(transport, func(method string, params json.RawMessage) {
		m.handleNotification(key, method, params)
	})
	entry.client = client

	rootURI, err := FileToURI(key.workspace)
	if err != nil {
		transport.Close()
		m.emitStatus(key.family, key.workspace, "error", err.Error())
		return nil, fmt.Errorf("invalid workspace path %q: %w", key.workspace, err)
	}
	if err := client.Initialize(ctx, rootURI); err != nil {
		transport.Close()
		m.emitStatus(key.family, key.workspace, "error", err.Error())
		return nil, fmt.Errorf("initialize %s: %w", config.Command, err)
	}

	m.mu.Lock()
	// Double-check: another goroutine may have started the server while we were initializing
	if existing, ok := m.servers[key]; ok {
		m.mu.Unlock()
		shutCtx, cancel := context.WithTimeout(context.Background(), serverShutdownTimeout)
		defer cancel()
		client.Shutdown(shutCtx)
		return existing, nil
	}
	m.servers[key] = entry
	m.mu.Unlock()

	m.emitStatus(key.family, key.workspace, "ready", "")

	// Monitor for unexpected server exit
	go m.monitorServer(key, entry)

	return entry, nil
}

// shutdownServer gracefully shuts down and removes a server.
func (m *Manager) shutdownServer(ctx context.Context, key serverKey) {
	m.mu.Lock()
	entry, ok := m.servers[key]
	if !ok {
		m.mu.Unlock()
		return
	}
	if entry.stopping {
		// Another goroutine is already shutting this server down
		m.mu.Unlock()
		return
	}
	entry.stopping = true
	delete(m.servers, key)
	m.mu.Unlock()

	m.emitStatus(key.family, key.workspace, "stopping", "")

	if err := entry.client.Shutdown(ctx); err != nil {
		log.Printf("lsp: shutdown %s/%s failed: %v", key.family, key.workspace, err)
	}

	m.emitStatus(key.family, key.workspace, "stopped", "")
}

// monitorServer watches for unexpected server process exit and attempts restart.
func (m *Manager) monitorServer(key serverKey, entry *serverEntry) {
	<-entry.client.Done()

	m.mu.Lock()
	current, ok := m.servers[key]
	if !ok || current != entry || entry.stopping {
		m.mu.Unlock()
		return
	}

	// Server crashed — check backoff
	entry.crashCount++
	entry.lastCrash = time.Now()

	if entry.crashCount > maxCrashRetries {
		delete(m.servers, key)
		m.mu.Unlock()
		m.emitStatus(key.family, key.workspace, "error",
			fmt.Sprintf("server crashed %d times, giving up", entry.crashCount))
		m.emitError(key.family, key.workspace,
			fmt.Sprintf("Language server for %s crashed repeatedly. Check that %s is installed correctly.",
				key.family, entry.config.Command))
		return
	}

	// Calculate backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s
	backoff := time.Second * time.Duration(1<<(entry.crashCount-1))
	if backoff > maxCrashBackoff {
		backoff = maxCrashBackoff
	}

	// Save open doc URIs for reconnect notification
	openDocURIs := make([]string, 0, len(entry.openDocs))
	for uri := range entry.openDocs {
		openDocURIs = append(openDocURIs, uri)
	}
	config := entry.config
	crashCount := entry.crashCount
	lastCrash := entry.lastCrash
	delete(m.servers, key)
	m.mu.Unlock()

	log.Printf("lsp: %s server crashed (attempt %d), restarting in %v", key.family, crashCount, backoff)
	m.emitStatus(key.family, key.workspace, "error",
		fmt.Sprintf("server crashed, restarting in %v (attempt %d/%d)", backoff, crashCount, maxCrashRetries))

	time.Sleep(backoff)

	// Restart
	ctx, cancel := context.WithTimeout(context.Background(), crashRestartTimeout)
	defer cancel()

	newEntry, err := m.startServer(ctx, key, config)
	if err != nil {
		log.Printf("lsp: restart %s failed: %v", key.family, err)
		return
	}

	// Carry over crash count
	m.mu.Lock()
	newEntry.crashCount = crashCount
	newEntry.lastCrash = lastCrash
	m.mu.Unlock()

	// Emit lsp:reconnect so the frontend re-sends document content.
	// Do NOT re-open documents with empty content — let the frontend handle it.
	if m.emitter != nil {
		m.emitter("lsp:reconnect", map[string]any{
			"family":    key.family,
			"workspace": key.workspace,
			"documents": openDocURIs,
		})
	}
}

// serverForPath finds the server entry responsible for the given file path.
func (m *Manager) serverForPath(path string) (*serverEntry, string) {
	ext := filepath.Ext(path)
	family := m.registry.FamilyForExtension(ext)
	if family == "" {
		return nil, ""
	}

	uri, err := FileToURI(path)
	if err != nil {
		return nil, ""
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	key := serverKey{family: family, workspace: m.workspaceRoot}
	entry, ok := m.servers[key]
	if !ok {
		return nil, ""
	}
	return entry, uri
}

// handleNotification processes server notifications and emits events.
func (m *Manager) handleNotification(key serverKey, method string, params json.RawMessage) {
	switch method {
	case "textDocument/publishDiagnostics":
		if m.emitter != nil {
			m.emitter("lsp:diagnostics", params)
		}
	}
}

// emitStatus emits an lsp:status event.
func (m *Manager) emitStatus(family, workspace, state, errMsg string) {
	if m.emitter == nil {
		return
	}
	m.emitter("lsp:status", ServerStatus{
		Family:    family,
		Workspace: workspace,
		State:     state,
		Error:     errMsg,
	})
}

// emitError emits an lsp:error event with a user-facing message.
func (m *Manager) emitError(family, workspace, message string) {
	if m.emitter == nil {
		return
	}
	m.emitter("lsp:error", map[string]string{
		"family":    family,
		"workspace": workspace,
		"message":   message,
	})
}

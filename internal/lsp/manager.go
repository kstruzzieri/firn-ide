package lsp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// errNoWorkspaceRoot signals that an LSP method was called before
// SetWorkspaceRoot. Only DidOpen surfaces this to the caller; other entry
// points treat it as a silent no-op.
var errNoWorkspaceRoot = errors.New("no workspace root set")

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
	Family                      string   `json:"family"`
	Workspace                   string   `json:"workspace"`
	Command                     string   `json:"command,omitempty"`
	State                       string   `json:"state"` // "starting", "ready", "stopping", "stopped", "error"
	Error                       string   `json:"error,omitempty"`
	CompletionTriggerCharacters []string `json:"completionTriggerCharacters,omitempty"`
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

	// stopped is set by ShutdownAll to prevent crash-recovery restarts
	// from resurrecting servers after intentional teardown.
	stopped bool
}

// serverKey identifies a unique server instance by language family and workspace.
type serverKey struct {
	family    string
	workspace string
}

// docState tracks an open document's reference count and latest version.
type docState struct {
	refCount int
	version  int
}

// serverEntry tracks a running server and its open documents.
type serverEntry struct {
	client     *Client
	config     *ServerConfig
	openDocs   map[string]*docState // URI -> state
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
//
// The stored root is cleaned and made absolute. This invariant lets later
// boundary comparisons (e.g. pathContains for crash-recovery guards) treat
// the workspace prefix consistently regardless of whether the caller passed
// a trailing separator or a relative path.
func (m *Manager) SetWorkspaceRoot(root string) {
	cleaned := root
	if root != "" {
		if abs, err := filepath.Abs(root); err == nil {
			cleaned = filepath.Clean(abs)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.workspaceRoot = cleaned
	m.stopped = false
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

	workspace, err := m.projectRootForPath(family, path)
	if err != nil {
		if errors.Is(err, errNoWorkspaceRoot) {
			return fmt.Errorf("no workspace root set")
		}
		// Path outside the active workspace or otherwise unresolvable: skip
		// silently so files opened transiently outside the LSP scope (e.g.,
		// preview of a sibling repo) do not surface noisy errors.
		return nil
	}

	entry, err := m.ensureServer(ctx, family, workspace)
	if err != nil {
		return err
	}

	m.mu.Lock()
	ds, exists := entry.openDocs[uri]
	if exists {
		ds.refCount++
		ds.version = version
	} else {
		entry.openDocs[uri] = &docState{refCount: 1, version: version}
	}
	m.mu.Unlock()

	// Only send didOpen to the server on the first open
	if !exists {
		return entry.client.DidOpen(uri, languageID, version, content)
	}
	return nil
}

// DidChange forwards content changes to the appropriate server.
// Returns early if the document has not been opened via DidOpen (e.g., during
// the gap between crash recovery and frontend reconnect).
func (m *Manager) DidChange(path string, version int, changes []TextDocumentContentChangeEvent) error {
	entry, uri, _ := m.serverForPath(path)
	if entry == nil {
		return nil
	}

	m.mu.Lock()
	ds, ok := entry.openDocs[uri]
	if !ok {
		m.mu.Unlock()
		return nil // document not tracked — skip to avoid LSP sequencing violation
	}
	ds.version = version
	m.mu.Unlock()

	return entry.client.DidChange(uri, version, changes)
}

// DidSave forwards save notification to the appropriate server.
// Returns early if the document has not been opened via DidOpen.
func (m *Manager) DidSave(path string) error {
	entry, uri, _ := m.serverForPath(path)
	if entry == nil {
		return nil
	}

	m.mu.Lock()
	_, ok := entry.openDocs[uri]
	m.mu.Unlock()
	if !ok {
		return nil // document not tracked — skip
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

	workspace, rerr := m.projectRootForPath(family, path)
	if rerr != nil {
		// No workspace, or path outside workspace — no server to close against.
		return nil
	}

	m.mu.Lock()
	key := serverKey{family: family, workspace: workspace}
	entry, ok := m.servers[key]
	if !ok {
		m.mu.Unlock()
		return nil
	}

	ds, docExists := entry.openDocs[uri]
	if !docExists {
		m.mu.Unlock()
		return nil
	}

	ds.refCount--
	if ds.refCount <= 0 {
		delete(entry.openDocs, uri)
	}
	shouldShutdown := len(entry.openDocs) == 0
	m.mu.Unlock()

	// Only send didClose to the server when the last reference is removed
	if ds.refCount <= 0 {
		if err := entry.client.DidClose(uri); err != nil {
			log.Printf("lsp: didClose failed for %s: %v", uri, err)
		}
	}

	// Shut down server if no more documents are open.
	// shutdownServerIfEmpty re-checks under lock in case a concurrent DidOpen added a document.
	if shouldShutdown {
		shutCtx, cancel := context.WithTimeout(context.Background(), serverShutdownTimeout)
		defer cancel()
		m.shutdownServerIfEmpty(shutCtx, key)
	}

	return nil
}

// Hover sends a hover request for the given file position.
func (m *Manager) Hover(ctx context.Context, path string, line, character int) (*Hover, error) {
	entry, uri, key := m.serverForPath(path)
	if entry == nil {
		return nil, nil
	}
	result, err := entry.client.Hover(ctx, uri, line, character)
	if err != nil {
		m.logRequestFailure(key, "textDocument/hover", err)
	}
	return result, err
}

// Definition sends a go-to-definition request for the given file position.
func (m *Manager) Definition(ctx context.Context, path string, line, character int) ([]Location, error) {
	entry, uri, key := m.serverForPath(path)
	if entry == nil {
		return nil, nil
	}
	result, err := entry.client.Definition(ctx, uri, line, character)
	if err != nil {
		m.logRequestFailure(key, "textDocument/definition", err)
	}
	return result, err
}

// Complete sends a completion request for the given file position.
func (m *Manager) Complete(ctx context.Context, path string, line, character int, triggerChar string) (*CompletionList, error) {
	entry, uri, key := m.serverForPath(path)
	if entry == nil {
		return nil, nil
	}
	result, err := entry.client.Complete(ctx, uri, line, character, triggerChar)
	if err != nil {
		m.logRequestFailure(key, "textDocument/completion", err)
	}
	return result, err
}

// ResolveCompletionItem resolves additional metadata for a completion item.
func (m *Manager) ResolveCompletionItem(ctx context.Context, path string, item CompletionItem) (*CompletionItem, error) {
	entry, _, key := m.serverForPath(path)
	if entry == nil {
		return nil, nil
	}
	result, err := entry.client.ResolveCompletionItem(ctx, item)
	if err != nil {
		m.logRequestFailure(key, "completionItem/resolve", err)
	}
	return result, err
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

		status := ServerStatus{
			Family:    key.family,
			Workspace: key.workspace,
			Command:   entry.config.Command,
			State:     state,
		}
		if state == "ready" {
			status.CompletionTriggerCharacters = completionTriggerChars(entry)
		}
		statuses = append(statuses, status)
	}
	return statuses
}

// ShutdownAll gracefully shuts down all running language servers.
// Used during workspace switches and app close.
func (m *Manager) ShutdownAll(timeout time.Duration) {
	m.mu.Lock()
	m.stopped = true
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
		m.emitStatus(family, workspace, "error", err.Error(), defaultServerCommand(family))
		return nil, err
	}

	return m.startServer(ctx, key, config)
}

// startServer launches a new language server process and initializes it.
func (m *Manager) startServer(ctx context.Context, key serverKey, config *ServerConfig) (*serverEntry, error) {
	m.emitStatus(key.family, key.workspace, "starting", "", config.Command)

	transport, err := NewStdioTransport(config.Command, config.Dir, config.Args...)
	if err != nil {
		m.emitStatus(key.family, key.workspace, "error", err.Error(), config.Command)
		return nil, fmt.Errorf("start server %s: %w", config.Command, err)
	}

	entry := &serverEntry{
		config:   config,
		openDocs: make(map[string]*docState),
	}

	client := NewClient(transport, func(method string, params json.RawMessage) {
		m.handleNotification(key, method, params)
	})
	entry.client = client

	rootURI, err := FileToURI(key.workspace)
	if err != nil {
		transport.Close()
		m.emitStatus(key.family, key.workspace, "error", err.Error(), config.Command)
		return nil, fmt.Errorf("invalid workspace path %q: %w", key.workspace, err)
	}
	if err := client.Initialize(ctx, rootURI, config.InitOptions); err != nil {
		// Close waits for the child process and stderr copier so diagnostics are complete.
		transport.Close()
		errMsg := err.Error()
		if stderr := transport.Stderr(); stderr != "" {
			errMsg = fmt.Sprintf("%s (server stderr: %s)", errMsg, strings.TrimSpace(stderr))
		}
		m.emitStatus(key.family, key.workspace, "error", errMsg, config.Command)
		return nil, fmt.Errorf("initialize %s: %s", config.Command, errMsg)
	}

	m.mu.Lock()
	if m.stopped || !pathContains(m.workspaceRoot, key.workspace) {
		m.mu.Unlock()
		shutCtx, cancel := context.WithTimeout(context.Background(), serverShutdownTimeout)
		defer cancel()
		m.doShutdown(shutCtx, key, entry)
		return nil, fmt.Errorf("server start abandoned for %s/%s: workspace changed or manager stopped", key.family, key.workspace)
	}
	// Double-check: another goroutine may have started the server while we were initializing
	if existing, ok := m.servers[key]; ok {
		m.mu.Unlock()
		shutCtx, cancel := context.WithTimeout(context.Background(), serverShutdownTimeout)
		defer cancel()
		_ = client.Shutdown(shutCtx)
		return existing, nil
	}
	m.servers[key] = entry
	m.mu.Unlock()

	m.emitStatus(key.family, key.workspace, "ready", "", config.Command)

	// Monitor for unexpected server exit
	go m.monitorServer(key, entry)

	return entry, nil
}

// shutdownServerIfEmpty shuts down a server only if it still has no open documents.
// Used by DidClose to guard against a concurrent DidOpen that reopened a document
// between the DidClose unlock and this call.
func (m *Manager) shutdownServerIfEmpty(ctx context.Context, key serverKey) {
	m.mu.Lock()
	entry, ok := m.servers[key]
	if !ok || entry.stopping || len(entry.openDocs) > 0 {
		m.mu.Unlock()
		return
	}
	entry.stopping = true
	delete(m.servers, key)
	m.mu.Unlock()

	m.doShutdown(ctx, key, entry)
}

// shutdownServer unconditionally shuts down a server.
// Used by ShutdownAll and workspace switching.
func (m *Manager) shutdownServer(ctx context.Context, key serverKey) {
	m.mu.Lock()
	entry, ok := m.servers[key]
	if !ok {
		m.mu.Unlock()
		return
	}
	if entry.stopping {
		m.mu.Unlock()
		return
	}
	entry.stopping = true
	delete(m.servers, key)
	m.mu.Unlock()

	m.doShutdown(ctx, key, entry)
}

// doShutdown performs the actual client shutdown and emits status events.
func (m *Manager) doShutdown(ctx context.Context, key serverKey, entry *serverEntry) {

	m.emitStatus(key.family, key.workspace, "stopping", "", entry.config.Command)

	if err := entry.client.Shutdown(ctx); err != nil {
		log.Printf("lsp: shutdown %s/%s failed: %v", key.family, key.workspace, err)
	}

	m.emitStatus(key.family, key.workspace, "stopped", "", entry.config.Command)
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
			fmt.Sprintf("server crashed %d times, giving up", entry.crashCount), entry.config.Command)
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
		fmt.Sprintf("server crashed, restarting in %v (attempt %d/%d)", backoff, crashCount, maxCrashRetries), config.Command)

	time.Sleep(backoff)

	// After backoff, verify the manager hasn't been shut down and the project
	// root is still inside the active workspace. Without this check, a
	// ShutdownAll or a workspace switch during the sleep would still result in
	// a stray server being resurrected.
	m.mu.Lock()
	if m.stopped || !pathContains(m.workspaceRoot, key.workspace) {
		m.mu.Unlock()
		log.Printf("lsp: skipping %s restart — manager stopped or workspace changed", key.family)
		return
	}
	m.mu.Unlock()

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
// For TypeScript-family files the lookup is keyed by the detected project
// root, so nested packages route to their own server instance.
func (m *Manager) serverForPath(path string) (*serverEntry, string, serverKey) {
	ext := filepath.Ext(path)
	family := m.registry.FamilyForExtension(ext)
	if family == "" {
		return nil, "", serverKey{}
	}

	uri, err := FileToURI(path)
	if err != nil {
		return nil, "", serverKey{}
	}

	workspace, rerr := m.projectRootForPath(family, path)
	if rerr != nil {
		return nil, "", serverKey{}
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	key := serverKey{family: family, workspace: workspace}
	entry, ok := m.servers[key]
	if !ok {
		return nil, "", key
	}
	return entry, uri, key
}

// projectRootForPath returns the workspace key for the given file path.
// For TypeScript-family files this is the nearest project root found by
// upward walk (tsconfig.json > jsconfig.json > package.json), bounded by the
// active workspace. For other families it returns the active workspace root
// unchanged.
//
// Must be called WITHOUT the manager lock held — it performs filesystem
// stat calls during marker probing.
//
// Returns errNoWorkspaceRoot if SetWorkspaceRoot has not been called, or
// ErrPathOutsideWorkspace (wrapped via ResolveProjectRoot) if the file is
// outside the active workspace.
func (m *Manager) projectRootForPath(family, path string) (string, error) {
	m.mu.Lock()
	workspace := m.workspaceRoot
	m.mu.Unlock()

	if workspace == "" {
		return "", errNoWorkspaceRoot
	}

	markers := projectRootMarkers(family)
	if len(markers) == 0 {
		return workspace, nil
	}
	return ResolveProjectRoot(path, workspace, markers, projectRootSkipDirs(family))
}

// projectRootMarkers returns the marker filenames used to detect a project
// root for the given language family. Returning an empty slice means root
// detection is disabled for the family and callers should use the active
// workspace root directly. Go and Python are intentionally not wired up here
// yet — see issues #75 and #76.
func projectRootMarkers(family string) []string {
	switch family {
	case "typescript":
		return []string{"tsconfig.json", "jsconfig.json", "package.json"}
	}
	return nil
}

// projectRootSkipDirs returns directory segments whose marker matches must
// be ignored during project-root resolution for the given family.
//
// For TypeScript this returns ["node_modules"] so that navigating into a
// dependency (e.g. via go-to-definition) does NOT spawn a per-dependency
// LSP server rooted at node_modules/<dep>/package.json. Instead the walk
// continues through node_modules until it finds the consuming package's
// project root above.
func projectRootSkipDirs(family string) []string {
	switch family {
	case "typescript":
		return []string{"node_modules"}
	}
	return nil
}

func (m *Manager) logRequestFailure(key serverKey, method string, err error) {
	log.Printf("lsp: request failed method=%s family=%s workspace=%q error=%v", method, key.family, key.workspace, err)
}

func defaultServerCommand(family string) string {
	switch family {
	case "typescript":
		return "typescript-language-server"
	case "go":
		return "gopls"
	case "python":
		return "pyright-langserver"
	default:
		return ""
	}
}

// handleNotification processes server notifications and emits events.
func (m *Manager) handleNotification(key serverKey, method string, params json.RawMessage) {
	switch method {
	case "textDocument/publishDiagnostics":
		if m.emitter == nil {
			return
		}
		// Drop stale diagnostics: if the server sends diagnostics with a version
		// older than what we've tracked, the frontend has already moved past them.
		var diagParams PublishDiagnosticsParams
		if err := json.Unmarshal(params, &diagParams); err != nil {
			log.Printf("lsp: failed to parse diagnostics: %v", err)
			return
		}

		m.mu.Lock()
		if m.stopped || !pathContains(m.workspaceRoot, key.workspace) {
			m.mu.Unlock()
			return
		}
		m.mu.Unlock()

		if diagParams.Version > 0 {
			m.mu.Lock()
			entry, ok := m.servers[key]
			if ok {
				if ds, docOk := entry.openDocs[diagParams.URI]; docOk && diagParams.Version < ds.version {
					m.mu.Unlock()
					return // stale diagnostics — drop
				}
			}
			m.mu.Unlock()
		}
		// Wrap diagnostics with workspace context so the frontend can
		// filter stale events after workspace switches.
		m.emitter("lsp:diagnostics", map[string]any{
			"workspace":   key.workspace,
			"uri":         diagParams.URI,
			"version":     diagParams.Version,
			"diagnostics": diagParams.Diagnostics,
		})
	}
}

// emitStatus emits an lsp:status event.
func (m *Manager) emitStatus(family, workspace, state, errMsg string, command ...string) {
	if m.emitter == nil {
		return
	}
	status := ServerStatus{
		Family:    family,
		Workspace: workspace,
		State:     state,
		Error:     errMsg,
	}
	if len(command) > 0 {
		status.Command = command[0]
	}
	if state == "ready" {
		m.mu.Lock()
		key := serverKey{family: family, workspace: workspace}
		if entry, ok := m.servers[key]; ok {
			status.CompletionTriggerCharacters = completionTriggerChars(entry)
		}
		m.mu.Unlock()
	}
	m.emitter("lsp:status", status)
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

// completionTriggerChars extracts trigger characters from a server's completion capabilities.
func completionTriggerChars(entry *serverEntry) []string {
	raw := entry.client.ServerCapabilities().CompletionProvider
	if len(raw) == 0 {
		return nil
	}
	var opts CompletionProviderOptions
	if err := json.Unmarshal(raw, &opts); err != nil {
		return nil
	}
	return opts.TriggerCharacters
}

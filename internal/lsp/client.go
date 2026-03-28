package lsp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// DefaultRequestTimeout is the default timeout for LSP requests (hover, completion, definition).
const DefaultRequestTimeout = 10 * time.Second

// NotificationHandler is called when the server sends a notification.
type NotificationHandler func(method string, params json.RawMessage)

// ClientState represents the lifecycle state of the LSP client.
type ClientState int

const (
	ClientStateUninitialized ClientState = iota
	ClientStateInitializing
	ClientStateReady
	ClientStateShuttingDown
	ClientStateStopped
)

// Client manages a single LSP server connection.
type Client struct {
	transport Transport
	handler   NotificationHandler

	nextID    atomic.Int64
	pending   map[int64]chan *JSONRPCMessage
	pendingMu sync.Mutex

	capabilities ServerCapabilities
	capsMu       sync.RWMutex

	state   ClientState
	stateMu sync.RWMutex

	readDone chan struct{}
}

// NewClient creates a Client that communicates over the given transport.
// The handler is called for all server-initiated notifications (e.g., publishDiagnostics).
func NewClient(transport Transport, handler NotificationHandler) *Client {
	c := &Client{
		transport: transport,
		handler:   handler,
		pending:   make(map[int64]chan *JSONRPCMessage),
		readDone:  make(chan struct{}),
	}
	go c.readLoop()
	return c
}

// Initialize sends the initialize request and the initialized notification.
// rootURI should be a file:// URI for the workspace root.
func (c *Client) Initialize(ctx context.Context, rootURI string) error {
	c.stateMu.Lock()
	if c.state != ClientStateUninitialized {
		c.stateMu.Unlock()
		return fmt.Errorf("client already initialized (state: %d)", c.state)
	}
	c.state = ClientStateInitializing
	c.stateMu.Unlock()

	params := InitializeParams{
		ProcessID: nil, // null per LSP spec — we manage server lifecycle ourselves
		RootURI:   rootURI,
		Capabilities: ClientCapabilities{
			TextDocument: &TextDocumentClientCapabilities{
				Synchronization: &TextDocumentSyncClientCapabilities{
					DynamicRegistration: false,
					DidSave:             true,
				},
				Completion: &CompletionClientCapabilities{
					CompletionItem: &CompletionItemClientCapabilities{
						SnippetSupport:      true,
						DocumentationFormat: []string{"markdown", "plaintext"},
					},
				},
				Hover: &HoverClientCapabilities{
					ContentFormat: []string{"markdown", "plaintext"},
				},
				Definition: &DefinitionClientCapabilities{
					LinkSupport: false,
				},
				PublishDiag: &PublishDiagnosticsCapabilities{
					VersionSupport: true,
				},
			},
		},
	}

	var result InitializeResult
	if err := c.call(ctx, "initialize", params, &result); err != nil {
		c.stateMu.Lock()
		c.state = ClientStateStopped
		c.stateMu.Unlock()
		return fmt.Errorf("initialize: %w", err)
	}

	c.capsMu.Lock()
	c.capabilities = result.Capabilities
	c.capsMu.Unlock()

	// Send initialized notification
	if err := c.notify("initialized", struct{}{}); err != nil {
		c.stateMu.Lock()
		c.state = ClientStateStopped
		c.stateMu.Unlock()
		return fmt.Errorf("initialized notification: %w", err)
	}

	c.stateMu.Lock()
	c.state = ClientStateReady
	c.stateMu.Unlock()

	return nil
}

// Shutdown sends the shutdown request followed by exit notification.
func (c *Client) Shutdown(ctx context.Context) error {
	c.stateMu.Lock()
	if c.state != ClientStateReady {
		state := c.state
		c.stateMu.Unlock()
		if state == ClientStateStopped || state == ClientStateShuttingDown {
			return nil
		}
		return fmt.Errorf("cannot shutdown: client not ready (state: %d)", state)
	}
	c.state = ClientStateShuttingDown
	c.stateMu.Unlock()

	// Send shutdown request
	if err := c.call(ctx, "shutdown", nil, nil); err != nil {
		// Even if shutdown request fails, send exit to clean up
		log.Printf("lsp: shutdown request failed: %v", err)
	}

	// Send exit notification
	_ = c.notify("exit", nil)

	c.stateMu.Lock()
	c.state = ClientStateStopped
	c.stateMu.Unlock()

	return c.transport.Close()
}

// State returns the current client lifecycle state.
func (c *Client) State() ClientState {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.state
}

// ServerCapabilities returns the capabilities reported by the server after initialization.
func (c *Client) ServerCapabilities() ServerCapabilities {
	c.capsMu.RLock()
	defer c.capsMu.RUnlock()
	return c.capabilities
}

// DidOpen sends a textDocument/didOpen notification.
func (c *Client) DidOpen(uri, languageID string, version int, text string) error {
	return c.notify("textDocument/didOpen", DidOpenTextDocumentParams{
		TextDocument: TextDocumentItem{
			URI:        uri,
			LanguageID: languageID,
			Version:    version,
			Text:       text,
		},
	})
}

// DidChange sends a textDocument/didChange notification.
func (c *Client) DidChange(uri string, version int, changes []TextDocumentContentChangeEvent) error {
	return c.notify("textDocument/didChange", DidChangeTextDocumentParams{
		TextDocument: VersionedTextDocumentIdentifier{
			URI:     uri,
			Version: version,
		},
		ContentChanges: changes,
	})
}

// DidSave sends a textDocument/didSave notification.
func (c *Client) DidSave(uri string) error {
	return c.notify("textDocument/didSave", DidSaveTextDocumentParams{
		TextDocument: TextDocumentIdentifier{URI: uri},
	})
}

// DidClose sends a textDocument/didClose notification.
func (c *Client) DidClose(uri string) error {
	return c.notify("textDocument/didClose", DidCloseTextDocumentParams{
		TextDocument: TextDocumentIdentifier{URI: uri},
	})
}

// Hover sends a textDocument/hover request.
func (c *Client) Hover(ctx context.Context, uri string, line, character int) (*Hover, error) {
	params := TextDocumentPositionParams{
		TextDocument: TextDocumentIdentifier{URI: uri},
		Position:     Position{Line: line, Character: character},
	}
	var result Hover
	if err := c.call(ctx, "textDocument/hover", params, &result); err != nil {
		return nil, err
	}
	// Server returns null for no hover info
	if result.Contents == nil {
		return nil, nil
	}
	return &result, nil
}

// Definition sends a textDocument/definition request.
func (c *Client) Definition(ctx context.Context, uri string, line, character int) ([]Location, error) {
	params := TextDocumentPositionParams{
		TextDocument: TextDocumentIdentifier{URI: uri},
		Position:     Position{Line: line, Character: character},
	}

	var raw json.RawMessage
	if err := c.call(ctx, "textDocument/definition", params, &raw); err != nil {
		return nil, err
	}
	if raw == nil || string(raw) == "null" {
		return nil, nil
	}

	// Definition can return Location | Location[] — normalize to slice
	var locations []Location
	if err := json.Unmarshal(raw, &locations); err != nil {
		var single Location
		if err2 := json.Unmarshal(raw, &single); err2 != nil {
			return nil, fmt.Errorf("unmarshal definition result: %w", err)
		}
		locations = []Location{single}
	}
	return locations, nil
}

// Complete sends a textDocument/completion request.
func (c *Client) Complete(ctx context.Context, uri string, line, character int, triggerChar string) (*CompletionList, error) {
	params := CompletionParams{
		TextDocument: TextDocumentIdentifier{URI: uri},
		Position:     Position{Line: line, Character: character},
	}
	if triggerChar != "" {
		params.Context = &CompletionContext{
			TriggerKind:      CompletionTriggerCharacter,
			TriggerCharacter: triggerChar,
		}
	} else {
		params.Context = &CompletionContext{
			TriggerKind: CompletionTriggerInvoked,
		}
	}

	var raw json.RawMessage
	if err := c.call(ctx, "textDocument/completion", params, &raw); err != nil {
		return nil, err
	}
	if raw == nil || string(raw) == "null" {
		return nil, nil
	}

	// Completion can return CompletionList | CompletionItem[] — normalize
	var list CompletionList
	if err := json.Unmarshal(raw, &list); err == nil && (list.Items != nil || list.IsIncomplete) {
		return &list, nil
	}

	var items []CompletionItem
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("unmarshal completion result: %w", err)
	}
	return &CompletionList{Items: items}, nil
}

// Done returns a channel that is closed when the read loop exits
// (transport closed or server process exited).
func (c *Client) Done() <-chan struct{} {
	return c.readDone
}

// --- internal ---

// call sends a JSON-RPC request and waits for the response.
// If the caller does not set a deadline, DefaultRequestTimeout is applied.
func (c *Client) call(ctx context.Context, method string, params any, result any) error {
	// Apply default timeout if caller provided no deadline
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, DefaultRequestTimeout)
		defer cancel()
	}

	id := c.nextID.Add(1)

	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("marshal params: %w", err)
	}

	idJSON, _ := json.Marshal(id)

	msg := &JSONRPCMessage{
		JSONRPC: "2.0",
		ID:      idJSON,
		Method:  method,
		Params:  paramsJSON,
	}

	ch := make(chan *JSONRPCMessage, 1)
	c.pendingMu.Lock()
	c.pending[id] = ch
	c.pendingMu.Unlock()

	if err := c.transport.Send(msg); err != nil {
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return fmt.Errorf("send %s: %w", method, err)
	}

	select {
	case resp := <-ch:
		return c.handleResponse(resp, result)
	case <-ctx.Done():
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		_ = c.notify("$/cancelRequest", map[string]any{"id": id})
		return ctx.Err()
	case <-c.readDone:
		// Check if a response arrived before readDone
		select {
		case resp := <-ch:
			return c.handleResponse(resp, result)
		default:
		}
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return fmt.Errorf("server connection closed while waiting for %s", method)
	}
}

// handleResponse extracts the result or error from a JSON-RPC response.
func (c *Client) handleResponse(resp *JSONRPCMessage, result any) error {
	if resp.Error != nil {
		return resp.Error
	}
	if result == nil {
		return nil
	}
	if resp.Result == nil || string(resp.Result) == "null" {
		return nil
	}
	return json.Unmarshal(resp.Result, result)
}

// notify sends a JSON-RPC notification (no ID, no response expected).
func (c *Client) notify(method string, params any) error {
	var paramsJSON json.RawMessage
	if params != nil {
		var err error
		paramsJSON, err = json.Marshal(params)
		if err != nil {
			return fmt.Errorf("marshal params: %w", err)
		}
	}

	return c.transport.Send(&JSONRPCMessage{
		JSONRPC: "2.0",
		Method:  method,
		Params:  paramsJSON,
	})
}

// readLoop continuously reads messages from the transport and dispatches them.
func (c *Client) readLoop() {
	defer close(c.readDone)

	for {
		msg, err := c.transport.Receive()
		if err != nil {
			if err == io.EOF {
				return
			}
			log.Printf("lsp: read error: %v", err)
			return
		}

		if msg.IsResponse() {
			c.dispatchResponse(msg)
		} else if msg.IsNotification() {
			c.dispatchNotification(msg.Method, msg.Params)
		} else if msg.IsRequest() {
			c.respondToServerRequest(msg)
		}
	}
}

// dispatchNotification handles server notifications asynchronously to avoid
// blocking the read loop. Panics in the handler are recovered.
func (c *Client) dispatchNotification(method string, params json.RawMessage) {
	if c.handler == nil {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("lsp: panic in notification handler for %s: %v", method, r)
			}
		}()
		c.handler(method, params)
	}()
}

// dispatchResponse routes a response to the waiting caller.
func (c *Client) dispatchResponse(msg *JSONRPCMessage) {
	var id int64
	if err := json.Unmarshal(msg.ID, &id); err != nil {
		log.Printf("lsp: cannot parse response ID: %v", err)
		return
	}

	c.pendingMu.Lock()
	ch, ok := c.pending[id]
	if ok {
		delete(c.pending, id)
	}
	c.pendingMu.Unlock()

	if ok {
		ch <- msg
	}
}

// respondToServerRequest handles server-to-client requests with a generic response.
func (c *Client) respondToServerRequest(msg *JSONRPCMessage) {
	resp := &JSONRPCMessage{
		JSONRPC: "2.0",
		ID:      msg.ID,
		Error: &JSONRPCError{
			Code:    -32601,
			Message: "method not found",
		},
	}
	if err := c.transport.Send(resp); err != nil {
		log.Printf("lsp: failed to respond to server request %s: %v", msg.Method, err)
	}
}

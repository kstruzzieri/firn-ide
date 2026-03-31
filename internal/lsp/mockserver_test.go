package lsp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

// mockServerMain is the entry point for the mock LSP server subprocess.
// It reads JSON-RPC messages from stdin and responds appropriately.
// Invoked via: go test -run TestMockServerProcess
func mockServerMain() {
	reader := bufio.NewReaderSize(os.Stdin, 64*1024)
	writer := os.Stdout
	codec := NewCodec(reader, writer)

	var initialized bool

	for {
		msg, err := codec.ReadMessage()
		if err != nil {
			if err == io.EOF {
				os.Exit(0)
			}
			fmt.Fprintf(os.Stderr, "mock: read error: %v\n", err)
			os.Exit(1)
		}

		if msg.IsNotification() {
			handleMockNotification(msg, &initialized)
			continue
		}

		if msg.IsRequest() {
			resp := handleMockRequest(msg, initialized)
			if err := codec.WriteMessage(resp); err != nil {
				fmt.Fprintf(os.Stderr, "mock: write error: %v\n", err)
				os.Exit(1)
			}
			continue
		}
	}
}

func handleMockNotification(msg *JSONRPCMessage, initialized *bool) {
	switch msg.Method {
	case "initialized":
		*initialized = true
	case "exit":
		os.Exit(0)
	case "textDocument/didOpen", "textDocument/didChange", "textDocument/didSave", "textDocument/didClose":
		// Process document notifications — for the mock we emit diagnostics on didOpen/didChange
		if msg.Method == "textDocument/didOpen" || msg.Method == "textDocument/didChange" {
			emitMockDiagnostics(msg)
		}
	}
}

func handleMockRequest(msg *JSONRPCMessage, initialized bool) *JSONRPCMessage {
	switch msg.Method {
	case "initialize":
		return respondWithResult(msg.ID, InitializeResult{
			Capabilities: ServerCapabilities{
				TextDocumentSync:   mustJSON(TextDocumentSyncOptions{OpenClose: true, Change: TextDocumentSyncFull}),
				CompletionProvider: mustJSON(map[string]any{"triggerCharacters": []string{".", ":"}}),
				HoverProvider:      mustJSON(true),
				DefinitionProvider: mustJSON(true),
			},
		})

	case "shutdown":
		return respondWithResult(msg.ID, nil)

	case "textDocument/hover":
		return respondWithResult(msg.ID, Hover{
			Contents: mustJSON(MarkupContent{Kind: "markdown", Value: "**mock hover**"}),
		})

	case "textDocument/definition":
		var params TextDocumentPositionParams
		_ = json.Unmarshal(msg.Params, &params)
		return respondWithResult(msg.ID, Location{
			URI:   params.TextDocument.URI,
			Range: Range{Start: Position{Line: 0, Character: 0}, End: Position{Line: 0, Character: 10}},
		})

	case "textDocument/completion":
		return respondWithResult(msg.ID, CompletionList{
			IsIncomplete: false,
			Items: []CompletionItem{
				{Label: "mockFunction", Kind: 3, Detail: "mock detail"},  // Function
				{Label: "mockVariable", Kind: 6, Detail: "mock var"},     // Variable
			},
		})

	default:
		return &JSONRPCMessage{
			JSONRPC: "2.0",
			ID:      msg.ID,
			Error:   &JSONRPCError{Code: -32601, Message: "method not found: " + msg.Method},
		}
	}
}

func emitMockDiagnostics(msg *JSONRPCMessage) {
	// Extract the document URI from the notification
	var uri string
	if strings.Contains(msg.Method, "didOpen") {
		var params DidOpenTextDocumentParams
		if err := json.Unmarshal(msg.Params, &params); err == nil {
			uri = params.TextDocument.URI
		}
	} else {
		var params DidChangeTextDocumentParams
		if err := json.Unmarshal(msg.Params, &params); err == nil {
			uri = params.TextDocument.URI
		}
	}
	if uri == "" {
		return
	}

	// Write a publishDiagnostics notification to stdout
	diag := PublishDiagnosticsParams{
		URI: uri,
		Diagnostics: []Diagnostic{
			{
				Range:    Range{Start: Position{Line: 0, Character: 0}, End: Position{Line: 0, Character: 5}},
				Severity: SeverityError,
				Message:  "mock error diagnostic",
				Source:   "mock",
			},
		},
	}

	paramsJSON, _ := json.Marshal(diag)
	notification := &JSONRPCMessage{
		JSONRPC: "2.0",
		Method:  "textDocument/publishDiagnostics",
		Params:  paramsJSON,
	}

	// Write directly to stdout with Content-Length framing
	data, _ := json.Marshal(notification)
	fmt.Fprintf(os.Stdout, "Content-Length: %d\r\n\r\n%s", len(data), data)
}

func respondWithResult(id json.RawMessage, result any) *JSONRPCMessage {
	var resultJSON json.RawMessage
	if result != nil {
		resultJSON, _ = json.Marshal(result)
	} else {
		resultJSON = json.RawMessage("null")
	}
	return &JSONRPCMessage{
		JSONRPC: "2.0",
		ID:      id,
		Result:  resultJSON,
	}
}

func mustJSON(v any) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}

// Package lsp provides a language-agnostic LSP client for Firn IDE.
package lsp

import "encoding/json"

// Position in a text document expressed as zero-based line and character offset.
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

// Range in a text document expressed as start and end positions.
type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

// Location represents a location inside a resource.
type Location struct {
	URI   string `json:"uri"`
	Range Range  `json:"range"`
}

// TextDocumentIdentifier identifies a text document using a URI.
type TextDocumentIdentifier struct {
	URI string `json:"uri"`
}

// VersionedTextDocumentIdentifier identifies a specific version of a text document.
type VersionedTextDocumentIdentifier struct {
	URI     string `json:"uri"`
	Version int    `json:"version"`
}

// TextDocumentItem is an item to transfer a text document from the client to the server.
type TextDocumentItem struct {
	URI        string `json:"uri"`
	LanguageID string `json:"languageId"`
	Version    int    `json:"version"`
	Text       string `json:"text"`
}

// TextDocumentContentChangeEvent describes textual changes to a document.
type TextDocumentContentChangeEvent struct {
	Range *Range `json:"range,omitempty"`
	Text  string `json:"text"`
}

// DiagnosticSeverity represents the severity of a diagnostic.
type DiagnosticSeverity int

const (
	SeverityError       DiagnosticSeverity = 1
	SeverityWarning     DiagnosticSeverity = 2
	SeverityInformation DiagnosticSeverity = 3
	SeverityHint        DiagnosticSeverity = 4
)

// Diagnostic represents a diagnostic, such as a compiler error or warning.
type Diagnostic struct {
	Range    Range              `json:"range"`
	Severity DiagnosticSeverity `json:"severity,omitempty"`
	Code     json.RawMessage    `json:"code,omitempty"` // integer or string per LSP spec
	Source   string             `json:"source,omitempty"`
	Message  string             `json:"message"`
}

// PublishDiagnosticsParams are the parameters for the textDocument/publishDiagnostics notification.
type PublishDiagnosticsParams struct {
	URI         string       `json:"uri"`
	Version     int          `json:"version,omitempty"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

// CompletionTriggerKind defines how a completion was triggered.
type CompletionTriggerKind int

const (
	CompletionTriggerInvoked   CompletionTriggerKind = 1
	CompletionTriggerCharacter CompletionTriggerKind = 2
)

// CompletionContext contains additional information about the context in which
// a completion request was triggered.
type CompletionContext struct {
	TriggerKind      CompletionTriggerKind `json:"triggerKind"`
	TriggerCharacter string                `json:"triggerCharacter,omitempty"`
}

// CompletionItemKind defines the kind of a completion entry.
// The backend passes these through as integers; the frontend maps them to icons/styles.
type CompletionItemKind int

// InsertTextFormat defines whether the insert text is plain text or a snippet.
// The backend passes these through as integers.
type InsertTextFormat int

// CompletionItem represents a completion suggestion.
type CompletionItem struct {
	Label            string             `json:"label"`
	Kind             CompletionItemKind `json:"kind,omitempty"`
	Detail           string             `json:"detail,omitempty"`
	Documentation    json.RawMessage    `json:"documentation,omitempty"`
	InsertText       string             `json:"insertText,omitempty"`
	InsertTextFormat InsertTextFormat    `json:"insertTextFormat,omitempty"`
	TextEdit         *TextEdit          `json:"textEdit,omitempty"`
	FilterText       string             `json:"filterText,omitempty"`
	SortText         string             `json:"sortText,omitempty"`
}

// CompletionList represents a collection of completion items.
type CompletionList struct {
	IsIncomplete bool             `json:"isIncomplete"`
	Items        []CompletionItem `json:"items"`
}

// TextEdit represents a textual edit applicable to a text document.
type TextEdit struct {
	Range   Range  `json:"range"`
	NewText string `json:"newText"`
}

// MarkupContent represents a string value with a specific content type.
type MarkupContent struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

// Hover is the result of a hover request.
type Hover struct {
	Contents json.RawMessage `json:"contents"`
	Range    *Range          `json:"range,omitempty"`
}

// --- Initialize types ---

// InitializeParams are sent as the first request from client to server.
type InitializeParams struct {
	ProcessID             *int            `json:"processId"`
	RootURI               string          `json:"rootUri"`
	Capabilities          json.RawMessage `json:"capabilities"`
	InitializationOptions any             `json:"initializationOptions,omitempty"`
}

// InitializeResult is the server's response to the initialize request.
type InitializeResult struct {
	Capabilities ServerCapabilities `json:"capabilities"`
}

// ServerCapabilities describe the capabilities provided by the language server.
type ServerCapabilities struct {
	TextDocumentSync   json.RawMessage `json:"textDocumentSync,omitempty"`
	CompletionProvider json.RawMessage `json:"completionProvider,omitempty"`
	HoverProvider      json.RawMessage `json:"hoverProvider,omitempty"`
	DefinitionProvider json.RawMessage `json:"definitionProvider,omitempty"`
}

// TextDocumentSyncKind defines how the host (editor) should sync document changes.
type TextDocumentSyncKind int

const (
	TextDocumentSyncFull TextDocumentSyncKind = 1
)

// TextDocumentSyncOptions describe how text document syncing works.
type TextDocumentSyncOptions struct {
	OpenClose bool                 `json:"openClose,omitempty"`
	Change    TextDocumentSyncKind `json:"change,omitempty"`
	Save      json.RawMessage      `json:"save,omitempty"`
}

// --- Request/notification parameter types ---

// DidOpenTextDocumentParams are the parameters for textDocument/didOpen.
type DidOpenTextDocumentParams struct {
	TextDocument TextDocumentItem `json:"textDocument"`
}

// DidChangeTextDocumentParams are the parameters for textDocument/didChange.
type DidChangeTextDocumentParams struct {
	TextDocument   VersionedTextDocumentIdentifier  `json:"textDocument"`
	ContentChanges []TextDocumentContentChangeEvent `json:"contentChanges"`
}

// DidSaveTextDocumentParams are the parameters for textDocument/didSave.
type DidSaveTextDocumentParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
}

// DidCloseTextDocumentParams are the parameters for textDocument/didClose.
type DidCloseTextDocumentParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
}

// TextDocumentPositionParams is used for hover, definition, and completion requests.
type TextDocumentPositionParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Position     Position               `json:"position"`
}

// CompletionParams extends TextDocumentPositionParams with completion context.
type CompletionParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Position     Position               `json:"position"`
	Context      *CompletionContext     `json:"context,omitempty"`
}

// --- JSON-RPC types ---

// JSONRPCMessage is a raw JSON-RPC 2.0 message.
type JSONRPCMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *JSONRPCError   `json:"error,omitempty"`
}

// JSONRPCError represents a JSON-RPC 2.0 error.
type JSONRPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *JSONRPCError) Error() string {
	return e.Message
}

// IsRequest returns true if the message is a request (has an ID and a method).
func (m *JSONRPCMessage) IsRequest() bool {
	return m.ID != nil && m.Method != ""
}

// IsResponse returns true if the message is a response (has an ID, no method).
func (m *JSONRPCMessage) IsResponse() bool {
	return m.ID != nil && m.Method == ""
}

// IsNotification returns true if the message is a notification (no ID, has method).
func (m *JSONRPCMessage) IsNotification() bool {
	return m.ID == nil && m.Method != ""
}

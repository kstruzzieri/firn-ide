// Package ai provides the backend-authoritative identity layer for Firn's
// Golem chat: canonical repository binding with epochs, workspace resolution,
// and deterministic conversation IDs.
//
// Public identity types cross the Wails boundary as JSON and must never carry
// filesystem roots or paths; backend-only fields are excluded from marshaling.
package ai

// RepositoryIdentity names one incarnation of a bound repository. RepoKey is
// the full SHA-256 hex digest of the canonical repository root; RepoEpoch
// advances on every new incarnation and is never reused within a process.
type RepositoryIdentity struct {
	RepoKey   string `json:"repoKey"`
	RepoEpoch uint64 `json:"repoEpoch"`
}

// ConversationIdentity names one conversation within a bound repository.
type ConversationIdentity struct {
	RepoEpoch      uint64 `json:"repoEpoch"`
	WorkspaceID    string `json:"workspaceId"`
	ConversationID string `json:"conversationId"`
}

// RunIdentity names one run within a conversation.
type RunIdentity struct {
	RepoEpoch      uint64 `json:"repoEpoch"`
	WorkspaceID    string `json:"workspaceId"`
	ConversationID string `json:"conversationId"`
	RunID          string `json:"runId"`
}

// ResolvedWorkspace is the backend-only result of resolving a request identity
// against the current binding. RepoRoot and ToolRoot are filesystem paths and
// must never serialize.
type ResolvedWorkspace struct {
	RepositoryIdentity
	WorkspaceID   string
	WorkspaceName string
	WorkspaceRel  string
	RepoRoot      string `json:"-"` // backend-only
	ToolRoot      string `json:"-"` // backend-only
}

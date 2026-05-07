// Package search provides workspace-wide text search by invoking ripgrep.
//
// The package owns process management, JSON parsing, request lifecycle, and
// bounded result collection. It exposes typed request and response shapes that
// are stable for Wails consumers (the Firn IDE frontend).
//
// Design rules:
//   - No shell invocation. Always exec.CommandContext with explicit args.
//   - Preserve ripgrep's UTF-8 byte offsets in match ranges. The frontend is
//     responsible for converting bytes to JS string offsets/editor columns.
//   - Distinguish typed status values: Success, NoMatches, MissingTool,
//     InvalidRegex, Canceled, Failed. "No data" is never silently mapped to
//     "no matches".
//   - Bound results with a configurable cap. Mark Truncated true when hit.
package search

// SearchStatus is a typed enumeration of terminal states for a search request.
//
// The frontend uses this value to render distinct UI states. We intentionally
// avoid surfacing a generic "error" status: each failure mode that the user
// can act on has a dedicated value.
type SearchStatus string

const (
	// StatusSuccess indicates ripgrep ran successfully and at least one match
	// was returned (or zero matches but ripgrep itself succeeded — see also
	// StatusNoMatches for the explicit empty case).
	StatusSuccess SearchStatus = "success"

	// StatusNoMatches indicates ripgrep ran successfully and produced no
	// matches. This is exit code 1 from ripgrep, which is a successful empty
	// response, not a failure.
	StatusNoMatches SearchStatus = "no_matches"

	// StatusMissingTool indicates the ripgrep binary could not be located on
	// PATH. The UI should show an actionable message ("install ripgrep")
	// rather than treating this as zero results.
	StatusMissingTool SearchStatus = "missing_tool"

	// StatusInvalidRegex indicates ripgrep rejected the supplied query as a
	// malformed regular expression. The UI should surface the message and
	// ask the user to fix the query.
	StatusInvalidRegex SearchStatus = "invalid_regex"

	// StatusCanceled indicates the request was canceled by the caller (for
	// example because a newer search request superseded it).
	StatusCanceled SearchStatus = "canceled"

	// StatusFailed indicates a real failure: ripgrep exited with code 2,
	// emitted malformed JSON, or the runner could not start the process.
	// The Message field on SearchResponse carries diagnostic detail.
	StatusFailed SearchStatus = "failed"
)

// SearchRequest is the input shape for SearchWorkspace.
//
// RequestID is supplied by the caller (the frontend) so concurrent searches
// can be tracked and canceled deterministically. It must be non-empty.
//
// Root must be a non-empty absolute path that exists and is a directory.
//
// Query is the user-entered search string. With Options.Regex == false it is
// treated as a literal via ripgrep's --fixed-strings flag, so regex
// metacharacters are safe.
type SearchRequest struct {
	RequestID string        `json:"requestId"`
	Root      string        `json:"root"`
	Query     string        `json:"query"`
	Options   SearchOptions `json:"options"`
}

// SearchOptions toggles ripgrep behavior. They map directly to ripgrep flags
// in runner.go; they are not interpolated into a command string.
type SearchOptions struct {
	// Regex when true treats Query as a regular expression. When false, Query
	// is treated as a literal string (--fixed-strings).
	Regex bool `json:"regex"`

	// CaseSensitive when true enforces --case-sensitive. When false enforces
	// --ignore-case. ripgrep's default smart-case behavior is intentionally
	// not exposed: the IDE always sends a deterministic choice.
	CaseSensitive bool `json:"caseSensitive"`

	// WholeWord when true adds --word-regexp.
	WholeWord bool `json:"wholeWord"`
}

// MatchRange is a half-open byte range [Start, End) inside the matched line's
// raw bytes, exactly as reported by ripgrep. The frontend converts these to
// JS string offsets before rendering. We do not pre-convert in Go because
// ripgrep already speaks bytes and the editor needs character offsets.
type MatchRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// LineMatch is a single matching line within a file.
//
// Line is 1-based to match user-visible line numbering and the existing
// navigateToEditorLocation contract.
//
// Column is the 1-based byte column of the first match on the line as
// reported by ripgrep. Frontend converts to a character column before
// passing to the editor.
//
// Submatches are ordered by Start ascending and never overlap each other
// (ripgrep guarantees this).
type LineMatch struct {
	Line       int          `json:"line"`
	Column     int          `json:"column"`
	Text       string       `json:"text"`
	Submatches []MatchRange `json:"submatches"`
}

// FileResult groups all matching lines for a single file.
//
// Path is the absolute path. RelativePath is the path relative to the search
// root, using forward slashes regardless of host OS so the frontend can
// render and compare it consistently.
type FileResult struct {
	Path         string      `json:"path"`
	RelativePath string      `json:"relativePath"`
	Matches      []LineMatch `json:"matches"`
}

// SearchResponse is the terminal result of a search request.
//
// Status is always set. When Status is StatusFailed, StatusMissingTool, or
// StatusInvalidRegex, Message contains an actionable description. For other
// statuses Message is empty.
//
// Truncated is true when the runner stopped collecting results because the
// configured cap was reached. The Files slice is a prefix of all matches in
// that case.
//
// MatchCap is the cap that was in effect for this request, surfaced so the
// UI can explain "showing first N of many" without hard-coding a value.
//
// DurationMs is the wall-clock duration of the run in milliseconds, useful
// for surfacing search latency.
type SearchResponse struct {
	RequestID  string       `json:"requestId"`
	Status     SearchStatus `json:"status"`
	Message    string       `json:"message,omitempty"`
	Files      []FileResult `json:"files"`
	TotalFiles int          `json:"totalFiles"`
	TotalLines int          `json:"totalLines"`
	Truncated  bool         `json:"truncated"`
	MatchCap   int          `json:"matchCap"`
	DurationMs int64        `json:"durationMs"`
}

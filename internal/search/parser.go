package search

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

// rgEvent is the envelope ripgrep emits for each --json line.
type rgEvent struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// rgText represents ripgrep's text-or-bytes union. ripgrep emits either
// {"text": "..."} for valid UTF-8 or {"bytes": "<base64>"} for invalid UTF-8.
type rgText struct {
	Text  *string `json:"text,omitempty"`
	Bytes *string `json:"bytes,omitempty"`
}

// decode returns the raw bytes regardless of which variant ripgrep used.
// For invalid UTF-8 byte payloads we still return them verbatim; the consumer
// may convert with strings.ToValidUTF8 before sending to the frontend.
func (t rgText) decode() ([]byte, error) {
	if t.Text != nil {
		return []byte(*t.Text), nil
	}
	if t.Bytes != nil {
		return base64.StdEncoding.DecodeString(*t.Bytes)
	}
	return nil, nil
}

// rgBeginEnd is the body of begin/end events. Only "path" is needed.
type rgBeginEnd struct {
	Path rgText `json:"path"`
}

// rgSubmatch is a single highlighted span within a matching line.
type rgSubmatch struct {
	Match rgText `json:"match"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

// rgMatch is the body of a "match" event.
type rgMatch struct {
	Path           rgText       `json:"path"`
	Lines          rgText       `json:"lines"`
	LineNumber     int          `json:"line_number"`
	AbsoluteOffset int          `json:"absolute_offset"`
	Submatches     []rgSubmatch `json:"submatches"`
}

// parseEvents reads ripgrep --json output from r, calls onMatch for every
// match event (in order, grouped per file via separate begin/end events), and
// returns the first malformed-JSON or unrecoverable error.
//
// onMatch returns false to signal the caller has hit its result cap. parseEvents
// then drains the rest of r without invoking onMatch again, but does not stop
// reading because draining stdout prevents ripgrep from blocking on a full
// pipe before context cancelation reaches it.
//
// Any line whose top-level "type" field cannot be parsed as JSON is returned
// as an error; the callsite uses this to distinguish runner failures from a
// successful "no matches" run.
func parseEvents(r io.Reader, onMatch func(filePath string, m LineMatch) bool) error {
	scanner := bufio.NewScanner(r)
	// ripgrep can emit very long lines (a single match line can exceed the
	// default 64KB scanner limit). Allow up to 16MB per line, which matches
	// ripgrep's default max-columns ceiling comfortably.
	const maxLineBytes = 16 * 1024 * 1024
	scanner.Buffer(make([]byte, 0, 64*1024), maxLineBytes)

	var currentPath string
	collecting := true

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var evt rgEvent
		if err := json.Unmarshal(line, &evt); err != nil {
			return fmt.Errorf("malformed ripgrep JSON event: %w", err)
		}

		switch evt.Type {
		case "begin":
			var be rgBeginEnd
			if err := json.Unmarshal(evt.Data, &be); err != nil {
				return fmt.Errorf("malformed ripgrep begin event: %w", err)
			}
			pathBytes, err := be.Path.decode()
			if err != nil {
				return fmt.Errorf("decode begin path: %w", err)
			}
			currentPath = string(pathBytes)
		case "match":
			if !collecting {
				continue
			}
			var rm rgMatch
			if err := json.Unmarshal(evt.Data, &rm); err != nil {
				return fmt.Errorf("malformed ripgrep match event: %w", err)
			}
			path := currentPath
			if path == "" {
				pathBytes, err := rm.Path.decode()
				if err != nil {
					return fmt.Errorf("decode match path: %w", err)
				}
				path = string(pathBytes)
			}

			lineBytes, err := rm.Lines.decode()
			if err != nil {
				return fmt.Errorf("decode match line text: %w", err)
			}
			text := strings.TrimRight(string(lineBytes), "\n")
			text = strings.TrimRight(text, "\r")
			// Replace any invalid UTF-8 bytes so downstream JSON encoding to
			// the frontend remains valid. Match offsets are byte-based and
			// continue to refer to the original ripgrep bytes; the frontend
			// performs its own byte-to-char mapping using its own copy of
			// the line text it loads from disk for highlighting.
			text = strings.ToValidUTF8(text, "�")

			submatches := make([]MatchRange, 0, len(rm.Submatches))
			column := 1 // 1-based byte column; defaults to start of line when
			// no submatches are reported, which is unusual but lets the
			// frontend treat the column as "navigate to line start".
			for i, sm := range rm.Submatches {
				submatches = append(submatches, MatchRange{Start: sm.Start, End: sm.End})
				if i == 0 {
					// 1-based byte column of the first submatch.
					column = sm.Start + 1
				}
			}

			lm := LineMatch{
				Line:       rm.LineNumber,
				Column:     column,
				Text:       text,
				Submatches: submatches,
			}
			if !onMatch(path, lm) {
				collecting = false
			}
		case "end":
			currentPath = ""
		case "context", "summary":
			// Context lines are not requested in the runner args; summary is
			// informational. Ignore both for now.
		default:
			// Unknown event types are ignored to stay forward-compatible with
			// future ripgrep additions. We do not error on unknown types.
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read ripgrep output: %w", err)
	}
	return nil
}

// toRelativeForwardSlash returns p relative to root with forward-slash
// separators, suitable for stable display in the frontend across platforms.
// If the relative path computation fails it falls back to the absolute path
// so the user always sees something they can act on.
func toRelativeForwardSlash(root, p string) string {
	rel, err := filepath.Rel(root, p)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return filepath.ToSlash(p)
	}
	return filepath.ToSlash(rel)
}

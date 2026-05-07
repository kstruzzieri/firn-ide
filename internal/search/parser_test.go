package search

import (
	"errors"
	"strings"
	"testing"
)

// TestParseEvents_BasicMatch covers the happy path: begin -> match -> end ->
// summary. The parser must call onMatch once with the right path, line,
// column, text, and submatches.
func TestParseEvents_BasicMatch(t *testing.T) {
	stream := strings.Join([]string{
		`{"type":"begin","data":{"path":{"text":"/abs/file.go"}}}`,
		`{"type":"match","data":{"path":{"text":"/abs/file.go"},"lines":{"text":"hello world\n"},"line_number":3,"absolute_offset":0,"submatches":[{"match":{"text":"world"},"start":6,"end":11}]}}`,
		`{"type":"end","data":{"path":{"text":"/abs/file.go"}}}`,
		`{"type":"summary","data":{"elapsed_total":{"secs":0,"nanos":1,"human":"0s"},"stats":{"matches":1,"matched_lines":1,"searches":1,"searches_with_match":1,"bytes_searched":12,"bytes_printed":120,"elapsed":{"secs":0,"nanos":0,"human":"0s"}}}}`,
	}, "\n")

	var (
		gotPath  string
		gotLine  int
		gotCol   int
		gotText  string
		gotSubs  []MatchRange
		callOnce int
	)
	err := parseEvents(strings.NewReader(stream), func(p string, m LineMatch) bool {
		callOnce++
		gotPath = p
		gotLine = m.Line
		gotCol = m.Column
		gotText = m.Text
		gotSubs = m.Submatches
		return true
	})
	if err != nil {
		t.Fatalf("parseEvents: %v", err)
	}
	if callOnce != 1 {
		t.Fatalf("onMatch called %d times, want 1", callOnce)
	}
	if gotPath != "/abs/file.go" {
		t.Errorf("path = %q, want %q", gotPath, "/abs/file.go")
	}
	if gotLine != 3 {
		t.Errorf("line = %d, want 3", gotLine)
	}
	if gotCol != 7 {
		// Submatch start is 6 -> 1-based column is 7.
		t.Errorf("column = %d, want 7", gotCol)
	}
	if gotText != "hello world" {
		t.Errorf("text = %q, want %q", gotText, "hello world")
	}
	if len(gotSubs) != 1 || gotSubs[0].Start != 6 || gotSubs[0].End != 11 {
		t.Errorf("submatches = %+v, want [{6 11}]", gotSubs)
	}
}

// TestParseEvents_MultipleMatchesPerFile checks that all match events between
// begin/end are forwarded with the correct path.
func TestParseEvents_MultipleMatchesPerFile(t *testing.T) {
	stream := strings.Join([]string{
		`{"type":"begin","data":{"path":{"text":"/x/a.txt"}}}`,
		`{"type":"match","data":{"path":{"text":"/x/a.txt"},"lines":{"text":"foo\n"},"line_number":1,"absolute_offset":0,"submatches":[{"match":{"text":"foo"},"start":0,"end":3}]}}`,
		`{"type":"match","data":{"path":{"text":"/x/a.txt"},"lines":{"text":"foofoo\n"},"line_number":2,"absolute_offset":4,"submatches":[{"match":{"text":"foo"},"start":0,"end":3},{"match":{"text":"foo"},"start":3,"end":6}]}}`,
		`{"type":"end","data":{"path":{"text":"/x/a.txt"}}}`,
	}, "\n")

	var matches []LineMatch
	var paths []string
	err := parseEvents(strings.NewReader(stream), func(p string, m LineMatch) bool {
		paths = append(paths, p)
		matches = append(matches, m)
		return true
	})
	if err != nil {
		t.Fatalf("parseEvents: %v", err)
	}
	if len(matches) != 2 {
		t.Fatalf("got %d matches, want 2", len(matches))
	}
	for _, p := range paths {
		if p != "/x/a.txt" {
			t.Errorf("path = %q, want /x/a.txt", p)
		}
	}
	if matches[1].Line != 2 || len(matches[1].Submatches) != 2 {
		t.Errorf("second match unexpected: %+v", matches[1])
	}
}

// TestParseEvents_NoMatches checks that a stream with no match events does
// not invoke onMatch and does not return an error.
func TestParseEvents_NoMatches(t *testing.T) {
	stream := strings.Join([]string{
		`{"type":"summary","data":{}}`,
	}, "\n")
	called := 0
	err := parseEvents(strings.NewReader(stream), func(p string, m LineMatch) bool {
		called++
		return true
	})
	if err != nil {
		t.Fatalf("parseEvents: %v", err)
	}
	if called != 0 {
		t.Errorf("onMatch called %d times, want 0", called)
	}
}

// TestParseEvents_MalformedJSON ensures malformed event lines are reported
// as errors and not silently swallowed.
func TestParseEvents_MalformedJSON(t *testing.T) {
	stream := `{"type":"begin","data":{"path":{"text":"/x/a"}}}` + "\n" + `not json` + "\n"
	err := parseEvents(strings.NewReader(stream), func(p string, m LineMatch) bool { return true })
	if err == nil {
		t.Fatalf("expected malformed JSON error")
	}
}

// TestParseEvents_StopsCollectingOnCap ensures returning false from onMatch
// suppresses subsequent forwards but does not error.
func TestParseEvents_StopsCollectingOnCap(t *testing.T) {
	stream := strings.Join([]string{
		`{"type":"begin","data":{"path":{"text":"/x/a"}}}`,
		`{"type":"match","data":{"path":{"text":"/x/a"},"lines":{"text":"a\n"},"line_number":1,"submatches":[{"match":{"text":"a"},"start":0,"end":1}]}}`,
		`{"type":"match","data":{"path":{"text":"/x/a"},"lines":{"text":"b\n"},"line_number":2,"submatches":[{"match":{"text":"b"},"start":0,"end":1}]}}`,
		`{"type":"match","data":{"path":{"text":"/x/a"},"lines":{"text":"c\n"},"line_number":3,"submatches":[{"match":{"text":"c"},"start":0,"end":1}]}}`,
	}, "\n")
	count := 0
	err := parseEvents(strings.NewReader(stream), func(p string, m LineMatch) bool {
		count++
		return count < 2 // accept first, reject from second onward
	})
	if err != nil {
		t.Fatalf("parseEvents: %v", err)
	}
	if count != 2 {
		// We accept once (count becomes 1, returns true), reject once (count
		// becomes 2, returns false), and remaining events are skipped without
		// invoking onMatch again.
		t.Errorf("count = %d, want 2", count)
	}
}

// TestParseEvents_BytesPathFallback exercises the base64 "bytes" branch in
// rgText.decode. ripgrep emits this when a path is not valid UTF-8.
func TestParseEvents_BytesPathFallback(t *testing.T) {
	// "/x/a.txt" base64-encoded.
	stream := `{"type":"begin","data":{"path":{"bytes":"L3gvYS50eHQ="}}}` + "\n" +
		`{"type":"match","data":{"path":{"bytes":"L3gvYS50eHQ="},"lines":{"text":"hi\n"},"line_number":1,"submatches":[{"match":{"text":"h"},"start":0,"end":1}]}}` + "\n"
	var gotPath string
	err := parseEvents(strings.NewReader(stream), func(p string, m LineMatch) bool {
		gotPath = p
		return true
	})
	if err != nil {
		t.Fatalf("parseEvents: %v", err)
	}
	if gotPath != "/x/a.txt" {
		t.Errorf("path = %q, want /x/a.txt", gotPath)
	}
}

// TestParseEvents_TrimsTrailingNewlines verifies that "\r\n" and "\n" are
// stripped from the matched line text but the byte ranges are not modified.
func TestParseEvents_TrimsTrailingNewlines(t *testing.T) {
	stream := `{"type":"match","data":{"path":{"text":"/x/a"},"lines":{"text":"hi\r\n"},"line_number":1,"submatches":[{"match":{"text":"hi"},"start":0,"end":2}]}}` + "\n"
	var got LineMatch
	err := parseEvents(strings.NewReader(stream), func(p string, m LineMatch) bool {
		got = m
		return true
	})
	if err != nil {
		t.Fatalf("parseEvents: %v", err)
	}
	if got.Text != "hi" {
		t.Errorf("text = %q, want %q", got.Text, "hi")
	}
	if got.Submatches[0].End != 2 {
		t.Errorf("submatch end = %d, want 2 (unchanged)", got.Submatches[0].End)
	}
}

// TestParseEvents_LongLineExceedsDefault ensures the scanner buffer is sized
// for lines beyond the bufio.Scanner default of 64KB.
func TestParseEvents_LongLineExceedsDefault(t *testing.T) {
	// Build a single match event larger than 64KB.
	long := strings.Repeat("x", 200_000)
	stream := `{"type":"match","data":{"path":{"text":"/x/a"},"lines":{"text":"` + long + `"},"line_number":1,"submatches":[{"match":{"text":"x"},"start":0,"end":1}]}}` + "\n"
	var got LineMatch
	err := parseEvents(strings.NewReader(stream), func(p string, m LineMatch) bool {
		got = m
		return true
	})
	if err != nil {
		t.Fatalf("parseEvents: %v", err)
	}
	if len(got.Text) != len(long) {
		t.Errorf("text length = %d, want %d", len(got.Text), len(long))
	}
}

// TestParseEvents_ContextEventsIgnored verifies that "context" events are
// ignored: parser does not invoke onMatch for them.
func TestParseEvents_ContextEventsIgnored(t *testing.T) {
	stream := `{"type":"context","data":{"path":{"text":"/x/a"},"lines":{"text":"around\n"},"line_number":2,"submatches":[]}}` + "\n"
	called := false
	err := parseEvents(strings.NewReader(stream), func(p string, m LineMatch) bool {
		called = true
		return true
	})
	if err != nil {
		t.Fatalf("parseEvents: %v", err)
	}
	if called {
		t.Error("onMatch called for a context event")
	}
}

// TestToRelativeForwardSlash exercises the path normalization helper.
func TestToRelativeForwardSlash(t *testing.T) {
	root := "/abs/root"
	cases := []struct {
		in   string
		want string
	}{
		{"/abs/root/a.txt", "a.txt"},
		{"/abs/root/sub/b.go", "sub/b.go"},
		{"/abs/other/c.go", "/abs/other/c.go"}, // Not under root: keep absolute.
	}
	for _, tc := range cases {
		got := toRelativeForwardSlash(root, tc.in)
		if got != tc.want {
			t.Errorf("toRelativeForwardSlash(%q, %q) = %q, want %q", root, tc.in, got, tc.want)
		}
	}
}

// TestParseEvents_ScannerError ensures non-EOF errors from the underlying
// reader propagate. We use an io.Reader that returns a non-EOF error after
// some valid bytes.
func TestParseEvents_ScannerError(t *testing.T) {
	r := &errReader{data: []byte(`{"type":"summary","data":{}}` + "\n")}
	err := parseEvents(r, func(p string, m LineMatch) bool { return true })
	if err == nil {
		t.Fatalf("expected scanner error")
	}
	if !errors.Is(err, errInjected) {
		// We do not require errors.Is, but the wrapped message should at
		// least mention "read".
		if !strings.Contains(err.Error(), "read") && !strings.Contains(err.Error(), "ripgrep") {
			t.Errorf("error %v does not mention reader failure", err)
		}
	}
}

var errInjected = errors.New("injected reader failure")

type errReader struct {
	data []byte
	off  int
}

func (e *errReader) Read(p []byte) (int, error) {
	if e.off < len(e.data) {
		n := copy(p, e.data[e.off:])
		e.off += n
		return n, nil
	}
	return 0, errInjected
}

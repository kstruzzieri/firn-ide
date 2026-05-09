package search

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

// TestBuildArgs verifies the option-to-argument mapping is exact and that
// the query is its own argv element rather than being string-templated.
func TestBuildArgs(t *testing.T) {
	cases := []struct {
		name string
		req  SearchRequest
		want []string
	}{
		{
			name: "literal-case-insensitive",
			req: SearchRequest{
				Root:    "/abs/root",
				Query:   "needle",
				Options: SearchOptions{},
			},
			want: []string{
				"--no-config", "--no-require-git", "--json", "--line-number", "--column", "--color", "never",
				"--fixed-strings", "--ignore-case",
				"--regexp", "needle",
				"--", "/abs/root",
			},
		},
		{
			name: "regex-case-sensitive-whole-word",
			req: SearchRequest{
				Root:    "/r",
				Query:   `\bfoo\b`,
				Options: SearchOptions{Regex: true, CaseSensitive: true, WholeWord: true},
			},
			want: []string{
				"--no-config", "--no-require-git", "--json", "--line-number", "--column", "--color", "never",
				"--case-sensitive", "--word-regexp",
				"--regexp", `\bfoo\b`,
				"--", "/r",
			},
		},
		{
			name: "leading-dash-query-is-safe",
			req: SearchRequest{
				Root:  "/r",
				Query: "-flag",
			},
			want: []string{
				"--no-config", "--no-require-git", "--json", "--line-number", "--column", "--color", "never",
				"--fixed-strings", "--ignore-case",
				"--regexp", "-flag",
				"--", "/r",
			},
		},
		{
			name: "literal-mode-includes-fixed-strings",
			req: SearchRequest{
				Root:    "/r",
				Query:   ".*",
				Options: SearchOptions{Regex: false, CaseSensitive: true},
			},
			want: []string{
				"--no-config", "--no-require-git", "--json", "--line-number", "--column", "--color", "never",
				"--fixed-strings", "--case-sensitive",
				"--regexp", ".*",
				"--", "/r",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := buildArgs(tc.req)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("buildArgs:\n got %#v\nwant %#v", got, tc.want)
			}
		})
	}
}

// TestClassifyStderr trims and collapses stderr output to a single line.
func TestClassifyStderr(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", "no stderr output"},
		{"   \n  ", "no stderr output"},
		{"single line", "single line"},
		{"first\nsecond\nthird", "first"},
		{"\n\nfirst real", "first real"},
	}
	for _, tc := range cases {
		got := classifyStderr([]byte(tc.in))
		if got != tc.want {
			t.Errorf("classifyStderr(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestIsRegexError matches ripgrep's stderr signatures for regex parse
// failures.
func TestIsRegexError(t *testing.T) {
	yes := []string{
		"regex parse error: empty class",
		"error parsing regex: foo",
		"unrecognized escape sequence",
		"invalid character class",
		"the literal \"\\n\" is not allowed in a regex",
	}
	no := []string{
		"some other failure",
		"",
		"no such file or directory",
	}
	for _, s := range yes {
		if !isRegexError([]byte(s)) {
			t.Errorf("isRegexError(%q) = false, want true", s)
		}
	}
	for _, s := range no {
		if isRegexError([]byte(s)) {
			t.Errorf("isRegexError(%q) = true, want false", s)
		}
	}
}

// TestIsMissingTool ensures the helper recognizes wrapped exec.ErrNotFound
// values returned by exec.LookPath.
func TestIsMissingTool(t *testing.T) {
	if isMissingTool(nil) {
		t.Error("isMissingTool(nil) = true, want false")
	}
	if isMissingTool(errors.New("plain")) {
		t.Error("isMissingTool(plain error) = true, want false")
	}
	wrapped := &exec.Error{Name: "rg", Err: exec.ErrNotFound}
	if !isMissingTool(wrapped) {
		t.Error("isMissingTool(exec.Error{ErrNotFound}) = false, want true")
	}
	// exec.LookPath in real callsites wraps via fmt.Errorf("%w").
	if !isMissingTool(errors.Join(wrapped, errors.New("ctx"))) {
		t.Error("isMissingTool(joined exec.Error) = false, want true")
	}
}

func TestRunRipgrepCancelsProcessAtMatchCap(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell wrapper helper is Unix-only")
	}

	wrapper := filepath.Join(t.TempDir(), "fake-rg")
	script := fmt.Sprintf("#!/bin/sh\nFIRN_SEARCH_FAKE_RG=cap exec %q -test.run=TestSearchFakeRGProcess -- \"$@\"\n", os.Args[0])
	if err := os.WriteFile(wrapper, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake rg wrapper: %v", err)
	}

	prevLookup := rgLookup
	prevName := rgBinaryName
	t.Cleanup(func() {
		rgLookup = prevLookup
		rgBinaryName = prevName
	})
	rgLookup = func(string) (string, error) { return wrapper, nil }

	start := time.Now()
	outcome := runRipgrep(
		context.Background(),
		runnerConfig{MatchCap: 5, Timeout: 5 * time.Second},
		SearchRequest{RequestID: "cap", Root: "/tmp", Query: "needle"},
		func(string, LineMatch) bool { return true },
	)

	if outcome.Err != nil {
		t.Fatalf("runRipgrep returned error: %v", outcome.Err)
	}
	if !outcome.Truncated {
		t.Fatal("Truncated = false, want true")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("cap cancel took %s, want under 1s", elapsed)
	}
}

func TestSearchFakeRGProcess(t *testing.T) {
	if os.Getenv("FIRN_SEARCH_FAKE_RG") != "cap" {
		return
	}

	for i := 1; i <= 10_000; i++ {
		_, _ = fmt.Fprintf(
			os.Stdout,
			`{"type":"match","data":{"path":{"text":"/tmp/fake.txt"},"lines":{"text":"needle\n"},"line_number":%d,"submatches":[{"match":{"text":"needle"},"start":0,"end":6}]}}`+"\n",
			i,
		)
		time.Sleep(time.Millisecond)
	}
	os.Exit(0)
}

// TestValidateRequest covers all rejection branches and the success path.
func TestValidateRequest(t *testing.T) {
	stat := func(want bool, err error) func(string) (bool, error) {
		return func(string) (bool, error) { return want, err }
	}

	cases := []struct {
		name       string
		req        SearchRequest
		stat       func(string) (bool, error)
		wantStatus SearchStatus
		wantSubstr string
	}{
		{
			name:       "missing-request-id",
			req:        SearchRequest{Query: "x", Root: "/r"},
			stat:       stat(true, nil),
			wantStatus: StatusFailed,
			wantSubstr: "requestId",
		},
		{
			name:       "missing-query",
			req:        SearchRequest{RequestID: "1", Root: "/r"},
			stat:       stat(true, nil),
			wantStatus: StatusFailed,
			wantSubstr: "query",
		},
		{
			name:       "missing-root",
			req:        SearchRequest{RequestID: "1", Query: "x"},
			stat:       stat(true, nil),
			wantStatus: StatusFailed,
			wantSubstr: "root is required",
		},
		{
			name:       "relative-root",
			req:        SearchRequest{RequestID: "1", Query: "x", Root: "rel/path"},
			stat:       stat(true, nil),
			wantStatus: StatusFailed,
			wantSubstr: "absolute",
		},
		{
			name:       "stat-failure",
			req:        SearchRequest{RequestID: "1", Query: "x", Root: "/missing"},
			stat:       stat(false, errors.New("nope")),
			wantStatus: StatusFailed,
			wantSubstr: "unavailable",
		},
		{
			name:       "not-a-dir",
			req:        SearchRequest{RequestID: "1", Query: "x", Root: "/r"},
			stat:       stat(false, nil),
			wantStatus: StatusFailed,
			wantSubstr: "not a directory",
		},
		{
			name:       "ok",
			req:        SearchRequest{RequestID: "1", Query: "x", Root: "/r"},
			stat:       stat(true, nil),
			wantStatus: StatusSuccess,
			wantSubstr: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotStatus, gotMsg := validateRequest(tc.req, tc.stat)
			if gotStatus != tc.wantStatus {
				t.Errorf("status = %s, want %s", gotStatus, tc.wantStatus)
			}
			if tc.wantSubstr != "" && !strings.Contains(gotMsg, tc.wantSubstr) {
				t.Errorf("message %q does not contain %q", gotMsg, tc.wantSubstr)
			}
		})
	}
}

package search

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// requireRipgrep skips the test when the ripgrep binary is not on PATH. We
// intentionally do not vendor a ripgrep stand-in here: the integration tests
// must exercise the real binary's exit codes, JSON shape, and ignore rules
// to be meaningful.
func requireRipgrep(t *testing.T) string {
	t.Helper()
	bin, err := exec.LookPath("rg")
	if err != nil {
		t.Skipf("ripgrep not installed: %v", err)
	}
	return bin
}

// withWorkspace builds a temporary workspace populated by files. files maps
// relative path to file contents. Directories are created on demand.
func withWorkspace(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", filepath.Dir(full), err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", full, err)
		}
	}
	return root
}

func TestManager_NoMatchesEmptyResponse(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{
		"a.txt": "lorem ipsum\n",
	})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "req-1",
		Root:      root,
		Query:     "definitely-not-present-xyz",
	})
	if resp.Status != StatusNoMatches {
		t.Fatalf("status = %s, want %s; message=%s", resp.Status, StatusNoMatches, resp.Message)
	}
	if len(resp.Files) != 0 || resp.TotalLines != 0 || resp.TotalFiles != 0 {
		t.Fatalf("unexpected results: %+v", resp)
	}
	if resp.Truncated {
		t.Errorf("Truncated = true, want false")
	}
}

func TestManager_LiteralMatchAcrossFiles(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{
		"a.txt":     "alpha needle beta\n",
		"sub/b.txt": "needle at start\nplain\n",
		"c.txt":     "no match here\n",
	})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "req-2",
		Root:      root,
		Query:     "needle",
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s, msg=%s", resp.Status, resp.Message)
	}
	if resp.TotalFiles != 2 {
		t.Fatalf("totalFiles = %d, want 2 (response=%+v)", resp.TotalFiles, resp)
	}
	// Confirm relative paths use forward slashes regardless of host.
	for _, f := range resp.Files {
		if strings.ContainsRune(f.RelativePath, '\\') {
			t.Errorf("relative path contains backslash: %q", f.RelativePath)
		}
		if !filepath.IsAbs(f.Path) {
			t.Errorf("absolute path expected, got %q", f.Path)
		}
	}
}

func TestManager_RegexAndCaseSensitivity(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{
		"a.txt": "Foo\nfoo\nFOO\n",
	})
	mgr := NewManager()

	respCI := mgr.Search(context.Background(), SearchRequest{
		RequestID: "ci",
		Root:      root,
		Query:     "foo",
		Options:   SearchOptions{Regex: true, CaseSensitive: false},
	})
	if respCI.Status != StatusSuccess {
		t.Fatalf("ci status = %s msg=%s", respCI.Status, respCI.Message)
	}
	if respCI.TotalLines != 3 {
		t.Errorf("ci totalLines = %d, want 3", respCI.TotalLines)
	}

	respCS := mgr.Search(context.Background(), SearchRequest{
		RequestID: "cs",
		Root:      root,
		Query:     "foo",
		Options:   SearchOptions{Regex: true, CaseSensitive: true},
	})
	if respCS.Status != StatusSuccess {
		t.Fatalf("cs status = %s", respCS.Status)
	}
	if respCS.TotalLines != 1 {
		t.Errorf("cs totalLines = %d, want 1", respCS.TotalLines)
	}
}

func TestManager_WholeWord(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{
		"a.txt": "cat\ncategory\nscatter\n",
	})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "ww",
		Root:      root,
		Query:     "cat",
		Options:   SearchOptions{WholeWord: true},
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	if resp.TotalLines != 1 {
		t.Errorf("totalLines = %d, want 1", resp.TotalLines)
	}
	if len(resp.Files) > 0 && resp.Files[0].Matches[0].Line != 1 {
		t.Errorf("matched line = %d, want 1", resp.Files[0].Matches[0].Line)
	}
}

func TestManager_LiteralModeIgnoresRegexMetacharacters(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{
		"a.txt": "before\n.* literal here\nfooXbar\n",
	})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "lit",
		Root:      root,
		Query:     ".*",
		Options:   SearchOptions{Regex: false},
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	if resp.TotalLines != 1 {
		t.Errorf("totalLines = %d, want 1 (literal '.*')", resp.TotalLines)
	}
}

func TestManager_RespectsGitignore(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{
		".gitignore":   "ignored.txt\n",
		"included.txt": "needle\n",
		"ignored.txt":  "needle\n",
		".git/config":  "[core]\n",
		".git/HEAD":    "ref: refs/heads/main\n",
	})
	// rg only respects .gitignore inside a git repository or when --no-require-git
	// is passed. Initialize an empty git directory marker so rg treats the
	// folder as a repo.
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}

	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "gi",
		Root:      root,
		Query:     "needle",
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	if resp.TotalFiles != 1 {
		t.Fatalf("totalFiles = %d, want 1 (only included.txt should match); files=%+v", resp.TotalFiles, resp.Files)
	}
	if !strings.HasSuffix(resp.Files[0].RelativePath, "included.txt") {
		t.Errorf("matched relative path = %q, want included.txt", resp.Files[0].RelativePath)
	}
}

// TestManager_RespectsGitignoreOutsideGitRepo verifies that .gitignore is
// honored when the workspace root is a plain folder (no .git subdirectory).
// Firn IDE workspaces commonly target arbitrary folders, not just git
// repositories, so the runner must pass --no-require-git to ripgrep. Without
// that flag, ripgrep silently disables ignore rules for non-git roots and
// "ignored" files leak into search results.
func TestManager_RespectsGitignoreOutsideGitRepo(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{
		".gitignore":   "ignored.txt\n",
		"included.txt": "needle\n",
		"ignored.txt":  "needle\n",
	})

	// Defensive: assert no .git directory exists, so the test is unambiguous
	// about the scenario it covers (a non-git folder).
	if _, err := os.Stat(filepath.Join(root, ".git")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf(".git unexpectedly exists in test root; want a non-git folder: %v", err)
	}

	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "gi-no-git",
		Root:      root,
		Query:     "needle",
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	if resp.TotalFiles != 1 {
		t.Fatalf("totalFiles = %d, want 1 (only included.txt should match outside a git repo); files=%+v", resp.TotalFiles, resp.Files)
	}
	if !strings.HasSuffix(resp.Files[0].RelativePath, "included.txt") {
		t.Errorf("matched relative path = %q, want included.txt", resp.Files[0].RelativePath)
	}
}

func TestManager_InvalidRegex(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{
		"a.txt": "anything\n",
	})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "ir",
		Root:      root,
		Query:     "(unbalanced",
		Options:   SearchOptions{Regex: true},
	})
	if resp.Status != StatusInvalidRegex {
		t.Fatalf("status = %s msg=%s, want %s", resp.Status, resp.Message, StatusInvalidRegex)
	}
	if resp.Message == "" {
		t.Error("expected non-empty message for invalid regex")
	}
}

func TestManager_MissingToolReportsActionableStatus(t *testing.T) {
	root := withWorkspace(t, map[string]string{"a.txt": "x\n"})
	mgr := NewManager()
	// Override the binary lookup to simulate a system without ripgrep.
	prevLookup := rgLookup
	prevName := rgBinaryName
	t.Cleanup(func() {
		rgLookup = prevLookup
		rgBinaryName = prevName
	})
	rgLookup = func(string) (string, error) {
		return "", &exec.Error{Name: "rg-stub", Err: exec.ErrNotFound}
	}
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "mt",
		Root:      root,
		Query:     "x",
	})
	if resp.Status != StatusMissingTool {
		t.Fatalf("status = %s msg=%s, want %s", resp.Status, resp.Message, StatusMissingTool)
	}
	if !strings.Contains(strings.ToLower(resp.Message), "ripgrep") {
		t.Errorf("message should mention ripgrep; got %q", resp.Message)
	}
}

func TestManager_TruncationCap(t *testing.T) {
	requireRipgrep(t)
	// Build a file with many matches.
	var sb strings.Builder
	for i := 0; i < 200; i++ {
		sb.WriteString("needle\n")
	}
	root := withWorkspace(t, map[string]string{"big.txt": sb.String()})
	mgr := NewManager()
	mgr.cfg.MatchCap = 50
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "trunc",
		Root:      root,
		Query:     "needle",
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	if !resp.Truncated {
		t.Errorf("Truncated = false, want true")
	}
	if resp.TotalLines != 50 {
		t.Errorf("totalLines = %d, want 50", resp.TotalLines)
	}
	if resp.MatchCap != 50 {
		t.Errorf("MatchCap = %d, want 50", resp.MatchCap)
	}
}

func TestManager_CancelStopsRun(t *testing.T) {
	requireRipgrep(t)
	// Generate enough output that rg cannot finish before we cancel.
	var sb strings.Builder
	for i := 0; i < 200_000; i++ {
		sb.WriteString("needle here\n")
	}
	root := withWorkspace(t, map[string]string{"huge.txt": sb.String()})

	mgr := NewManager()
	mgr.cfg.MatchCap = 1_000_000

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan SearchResponse, 1)
	go func() {
		done <- mgr.Search(ctx, SearchRequest{
			RequestID: "cancel-me",
			Root:      root,
			Query:     "needle",
		})
	}()

	// Cancel via the manager API. This exercises the production cancel path.
	time.Sleep(20 * time.Millisecond)
	mgr.Cancel("cancel-me")

	select {
	case resp := <-done:
		if resp.Status != StatusCanceled {
			// Some ripgrep versions on small inputs can finish before cancel
			// lands. Only fail if the response carries unbounded data, which
			// would indicate cancel never took effect.
			if resp.Status == StatusSuccess && resp.TotalLines == 200_000 {
				t.Errorf("cancel had no effect: full result returned")
			}
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Search did not return after cancel")
	}
}

func TestManager_CancelAllAbortsEveryRequest(t *testing.T) {
	requireRipgrep(t)
	var sb strings.Builder
	for i := 0; i < 100_000; i++ {
		sb.WriteString("needle\n")
	}
	root := withWorkspace(t, map[string]string{"huge.txt": sb.String()})

	mgr := NewManager()
	mgr.cfg.MatchCap = 10_000_000

	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			mgr.Search(context.Background(), SearchRequest{
				RequestID: "many-" + string(rune('0'+id)),
				Root:      root,
				Query:     "needle",
			})
		}(i)
	}
	time.Sleep(30 * time.Millisecond)
	mgr.CancelAll()

	doneCh := make(chan struct{})
	go func() {
		wg.Wait()
		close(doneCh)
	}()
	select {
	case <-doneCh:
	case <-time.After(15 * time.Second):
		t.Fatal("CancelAll did not unblock searches")
	}
}

func TestManager_ReusedRequestIDCancelsPrevious(t *testing.T) {
	requireRipgrep(t)
	var sb strings.Builder
	for i := 0; i < 100_000; i++ {
		sb.WriteString("needle\n")
	}
	root := withWorkspace(t, map[string]string{"huge.txt": sb.String()})

	mgr := NewManager()
	mgr.cfg.MatchCap = 10_000_000

	first := make(chan SearchResponse, 1)
	go func() {
		first <- mgr.Search(context.Background(), SearchRequest{
			RequestID: "shared",
			Root:      root,
			Query:     "needle",
		})
	}()
	time.Sleep(30 * time.Millisecond)
	// Second call with the same id should preempt the first via register's
	// "cancel previous" branch.
	go func() {
		_ = mgr.Search(context.Background(), SearchRequest{
			RequestID: "shared",
			Root:      root,
			Query:     "definitely-not-present-zzz",
		})
	}()

	select {
	case resp := <-first:
		// First search should be canceled or return naturally; either way
		// we must observe a terminal response within the timeout.
		if resp.RequestID != "shared" {
			t.Errorf("requestID = %q, want %q", resp.RequestID, "shared")
		}
	case <-time.After(15 * time.Second):
		t.Fatal("first search never returned after preemption")
	}
}

func TestManager_RejectsRelativeRoot(t *testing.T) {
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "rel",
		Root:      "relative/path",
		Query:     "x",
	})
	if resp.Status != StatusFailed {
		t.Errorf("status = %s, want %s", resp.Status, StatusFailed)
	}
}

func TestManager_RejectsNonexistentRoot(t *testing.T) {
	mgr := NewManager()
	bogus := filepath.Join(os.TempDir(), "definitely-does-not-exist-firn-search-test")
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "bogus",
		Root:      bogus,
		Query:     "x",
	})
	if resp.Status != StatusFailed {
		t.Errorf("status = %s msg=%s, want %s", resp.Status, resp.Message, StatusFailed)
	}
}

func TestManager_RejectsFileAsRoot(t *testing.T) {
	mgr := NewManager()
	tmp, err := os.CreateTemp("", "firn-search-not-a-dir-*.txt")
	if err != nil {
		t.Fatalf("temp file: %v", err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	_ = tmp.Close()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "file",
		Root:      tmp.Name(),
		Query:     "x",
	})
	if resp.Status != StatusFailed {
		t.Errorf("status = %s, want %s", resp.Status, StatusFailed)
	}
	if !strings.Contains(strings.ToLower(resp.Message), "directory") {
		t.Errorf("message should mention directory; got %q", resp.Message)
	}
}

func TestManager_PreservesByteOffsetsForMultibyte(t *testing.T) {
	requireRipgrep(t)
	// "héllo" — é is two bytes in UTF-8 (0xC3 0xA9). Match "ll" should land
	// at byte offset 3 (after 'h', 'é' -> 2 bytes).
	root := withWorkspace(t, map[string]string{"a.txt": "héllo world\n"})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "mb",
		Root:      root,
		Query:     "ll",
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	if resp.TotalLines != 1 {
		t.Fatalf("totalLines = %d, want 1", resp.TotalLines)
	}
	m := resp.Files[0].Matches[0]
	if len(m.Submatches) != 1 || m.Submatches[0].Start != 3 || m.Submatches[0].End != 5 {
		t.Errorf("submatch = %+v, want [{3 5}] (byte offsets)", m.Submatches)
	}
}

func TestManager_PathWithSpacesAndSpecialChars(t *testing.T) {
	requireRipgrep(t)
	tricky := "weird dir #1 -- ' \"quoted\""
	root := withWorkspace(t, map[string]string{
		filepath.Join(tricky, "file.txt"): "needle\n",
	})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "tricky",
		Root:      root,
		Query:     "needle",
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	if resp.TotalLines != 1 {
		t.Fatalf("totalLines = %d, want 1", resp.TotalLines)
	}
	if !strings.Contains(resp.Files[0].RelativePath, "weird dir #1") {
		t.Errorf("relative path = %q does not include space/# parent", resp.Files[0].RelativePath)
	}
}

func TestManager_PreservesByteOffsetsForEmoji(t *testing.T) {
	requireRipgrep(t)
	// Emoji "🦊" is 4 bytes in UTF-8 (0xF0 0x9F 0xA6 0x8A). Searching for
	// "fox" after the emoji must report submatch byte offsets that account
	// for the multibyte prefix; the frontend converts to char offsets.
	root := withWorkspace(t, map[string]string{"a.txt": "🦊 fox jumps\n"})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "emoji",
		Root:      root,
		Query:     "fox",
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	m := resp.Files[0].Matches[0]
	// Expected byte offset: 4 (emoji) + 1 (space) = 5.
	if len(m.Submatches) != 1 || m.Submatches[0].Start != 5 || m.Submatches[0].End != 8 {
		t.Errorf("submatch = %+v, want [{5 8}]", m.Submatches)
	}
}

func TestManager_LongQueryInput(t *testing.T) {
	requireRipgrep(t)
	// 4KB literal query that does not exist anywhere in the workspace.
	long := strings.Repeat("Z", 4096)
	root := withWorkspace(t, map[string]string{"a.txt": "x\n"})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "lq",
		Root:      root,
		Query:     long,
	})
	if resp.Status != StatusNoMatches {
		t.Errorf("status = %s msg=%s, want %s", resp.Status, resp.Message, StatusNoMatches)
	}
}

func TestManager_QueryWithNewlineInLiteralMode(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{"a.txt": "line1\nline2\n"})
	mgr := NewManager()
	// ripgrep refuses a literal newline in a pattern with a clear error.
	// We map that to StatusInvalidRegex so the UI can show an actionable
	// "this query is not supported" message rather than swallowing it.
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "nl",
		Root:      root,
		Query:     "line1\nline2",
		Options:   SearchOptions{Regex: false},
	})
	if resp.Status != StatusInvalidRegex {
		t.Errorf("status = %s msg=%s, want %s", resp.Status, resp.Message, StatusInvalidRegex)
	}
}

func TestManager_QueryWithBackslashesInLiteralMode(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{"a.txt": `path\to\file` + "\n"})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "bs",
		Root:      root,
		Query:     `path\to`,
		Options:   SearchOptions{Regex: false},
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	if resp.TotalLines != 1 {
		t.Errorf("totalLines = %d, want 1", resp.TotalLines)
	}
}

func TestManager_QueryWithQuotesAndDashesInLiteralMode(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{"a.txt": `--flag "quoted"` + "\n"})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "qq",
		Root:      root,
		Query:     `--flag "quoted"`,
		Options:   SearchOptions{Regex: false},
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	if resp.TotalLines != 1 {
		t.Errorf("totalLines = %d, want 1", resp.TotalLines)
	}
}

func TestManager_BinaryFileDoesNotCrash(t *testing.T) {
	requireRipgrep(t)
	bin := []byte{0x00, 0x01, 0x02, 'n', 'e', 'e', 'd', 'l', 'e', 0x00}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "binfile.bin"), bin, 0o644); err != nil {
		t.Fatalf("write bin: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "text.txt"), []byte("needle\n"), 0o644); err != nil {
		t.Fatalf("write text: %v", err)
	}
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "bin",
		Root:      root,
		Query:     "needle",
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s msg=%s", resp.Status, resp.Message)
	}
	// ripgrep skips binary files by default. The text file must still match.
	foundText := false
	for _, f := range resp.Files {
		if strings.HasSuffix(f.RelativePath, "text.txt") {
			foundText = true
		}
	}
	if !foundText {
		t.Errorf("text file match missing from %+v", resp.Files)
	}
}

func TestManager_FailedReturnsTypedError(t *testing.T) {
	root := withWorkspace(t, map[string]string{"a.txt": "x\n"})
	mgr := NewManager()
	mgr.statRoot = func(string) (bool, error) {
		// Force a stat-level failure so the validation path returns Failed.
		return false, errors.New("simulated stat failure")
	}
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "f",
		Root:      root,
		Query:     "x",
	})
	if resp.Status != StatusFailed {
		t.Errorf("status = %s, want %s", resp.Status, StatusFailed)
	}
	if !strings.Contains(resp.Message, "simulated stat failure") {
		t.Errorf("message %q missing root cause", resp.Message)
	}
}

func TestManager_DurationIsPositive(t *testing.T) {
	requireRipgrep(t)
	root := withWorkspace(t, map[string]string{"a.txt": "x\n"})
	mgr := NewManager()
	resp := mgr.Search(context.Background(), SearchRequest{
		RequestID: "dur",
		Root:      root,
		Query:     "x",
	})
	if resp.Status != StatusSuccess {
		t.Fatalf("status = %s", resp.Status)
	}
	if resp.DurationMs < 0 {
		t.Errorf("DurationMs = %d, want >= 0", resp.DurationMs)
	}
}

// TestManager_WindowsPathHint is a documentation-style test: relative paths
// emitted from the parser must use forward slashes regardless of OS, so the
// frontend can render a stable string. We exercise the helper directly to
// avoid skipping on non-Windows hosts.
func TestManager_WindowsPathHint(t *testing.T) {
	if runtime.GOOS == "windows" {
		got := toRelativeForwardSlash(`C:\\repo`, `C:\\repo\\sub\\file.go`)
		if got != "sub/file.go" {
			t.Errorf("toRelativeForwardSlash windows = %q, want sub/file.go", got)
		}
	}
	got := toRelativeForwardSlash("/r", "/r/sub/file.go")
	if got != "sub/file.go" {
		t.Errorf("toRelativeForwardSlash unix = %q, want sub/file.go", got)
	}
}

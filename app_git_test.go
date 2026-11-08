package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"firn/internal/git"
	"firn/internal/git/gittest"
	"firn/internal/search"
)

// isolatedGitEnv strips the repository-local GIT_* variables (so an inherited
// GIT_DIR or GIT_CONFIG cannot redirect these test git commands into the real
// repo) and pins config to /dev/null.
func isolatedGitEnv() []string {
	return append(git.ScrubGitEnv(os.Environ()),
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
}

func initGitRepoForApp(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "-b", "main"},
		{"config", "user.name", "Test"},
		{"config", "user.email", "test@example.com"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = isolatedGitEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestGitTestHelpers_KeepConfigWritesInTempRepo guards the helpers against the
// leak that left user.name=Test in the real repo's .git/config: a test git
// command that inherits a redirecting variable (a hook's GIT_DIR, a GIT_CONFIG
// file) writes wherever it points instead of into the temp repo.
func TestGitTestHelpers_KeepConfigWritesInTempRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	sentinel := t.TempDir()
	cmd := exec.Command("git", "init", "-b", "main")
	cmd.Dir = sentinel
	cmd.Env = isolatedGitEnv()
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	read := func(path string) []byte {
		t.Helper()
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return contents
	}
	gitDir := filepath.Join(sentinel, ".git")
	configPath := filepath.Join(gitDir, "config")
	before := read(configPath)
	// Checked in cleanup so a helper that fails fast on a redirected repo
	// still reports whether it wrote the sentinel first.
	t.Cleanup(func() {
		if after := read(configPath); !bytes.Equal(after, before) {
			t.Errorf("sentinel .git/config changed:\n%s", after)
		}
	})

	t.Setenv("GIT_DIR", gitDir)
	t.Setenv("GIT_WORK_TREE", sentinel)
	t.Setenv("GIT_COMMON_DIR", gitDir)
	t.Setenv("GIT_CONFIG", configPath)
	dir := initGitRepoForApp(t)
	makeAppConflict(t)

	if own := read(filepath.Join(dir, ".git", "config")); !bytes.Contains(own, []byte("email = test@example.com")) {
		t.Errorf("temp repo config lacks the test identity:\n%s", own)
	}
}

func TestGitCommitMessageAvailable_UsesEmbeddedRuntime(t *testing.T) {
	if !NewApp().GitCommitMessageAvailable() {
		t.Fatal("GitCommitMessageAvailable() = false, want true without a binary")
	}
}

func TestGitGenerateCommitMessage_Binding(t *testing.T) {
	dir := initGitRepoForApp(t)
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("TOKEN=hunter2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	app := newGolemApp(t) // startup wires the staged-path policy source (#384)
	provider := gittest.Start(t, "feat: add f.txt", nil)
	if _, err := app.GetWorkspaceInfo(dir); err != nil {
		t.Fatal(err)
	}
	if err := app.GitStage(dir, []string{"f.txt", ".env"}); err != nil {
		t.Fatal(err)
	}

	result, err := app.GitGenerateCommitMessage(dir)

	if err != nil {
		t.Fatalf("GitGenerateCommitMessage() error = %v", err)
	}
	if result.Message != "feat: add f.txt" {
		t.Errorf("Message = %q", result.Message)
	}
	if !slices.Equal(result.Withheld, []string{".env"}) {
		t.Errorf("Withheld = %q, want [.env]", result.Withheld)
	}
	if request := string(<-provider.Requests); strings.Contains(request, "hunter2") || strings.Contains(request, "a/.env") {
		t.Errorf("provider request carries the withheld file:\n%s", request)
	}
}

// Without a bound repository there is no chat policy to apply, so nothing is
// sent (#384).
func TestGitGenerateCommitMessage_UnboundRepositoryMakesNoRequest(t *testing.T) {
	dir := initGitRepoForApp(t)
	app := newGolemApp(t)
	provider := gittest.Start(t, "feat: add f.txt", nil)
	if err := app.GitStage(dir, []string{"f.txt"}); err != nil {
		t.Fatal(err)
	}

	if _, err := app.GitGenerateCommitMessage(dir); err == nil {
		t.Fatal("GitGenerateCommitMessage() without a bound repository returned no error")
	}
	if len(provider.Requests) != 0 {
		t.Errorf("provider requests = %d, want 0", len(provider.Requests))
	}
}

func TestGitStatus_Binding(t *testing.T) {
	dir := initGitRepoForApp(t)
	app := NewApp()

	st, err := app.GitStatus(dir)

	if err != nil {
		t.Fatalf("GitStatus() error = %v", err)
	}
	if !st.IsRepo || st.Branch != "main" {
		t.Errorf("status = %+v, want IsRepo=true Branch=main", st)
	}
	if len(st.Files) != 1 || st.Files[0].Index != "?" {
		t.Errorf("Files = %+v, want one untracked entry", st.Files)
	}
}

func TestGitStageAndCommit_Binding(t *testing.T) {
	dir := initGitRepoForApp(t)
	app := NewApp()

	if err := app.GitStage(dir, []string{"f.txt"}); err != nil {
		t.Fatalf("GitStage() error = %v", err)
	}
	if _, err := app.GitCommit(dir, "first commit", false); err != nil {
		t.Fatalf("GitCommit() error = %v", err)
	}

	st, _ := app.GitStatus(dir)
	if len(st.Files) != 0 {
		t.Errorf("Files after commit = %+v, want empty", st.Files)
	}
}

func TestGitFileHunksAndApply_Binding(t *testing.T) {
	dir := initGitRepoForApp(t)
	app := NewApp()
	_ = app.GitStage(dir, []string{"f.txt"})
	if _, err := app.GitCommit(dir, "init", false); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\ny\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	fh, err := app.GitFileHunks(dir, "f.txt", false)
	if err != nil {
		t.Fatalf("GitFileHunks() error = %v", err)
	}
	if len(fh.Hunks) != 1 {
		t.Fatalf("hunks = %d, want 1 (%+v)", len(fh.Hunks), fh.Hunks)
	}

	if err := app.GitApplyHunk(dir, fh.Hunks[0].Patch, false); err != nil {
		t.Fatalf("GitApplyHunk() error = %v", err)
	}

	st, _ := app.GitStatus(dir)
	if len(st.Files) != 1 || st.Files[0].Index != "M" {
		t.Errorf("Files = %+v, want f.txt staged-modified", st.Files)
	}
}

func TestGitBranchesAndCheckout_Binding(t *testing.T) {
	dir := initGitRepoForApp(t)
	app := NewApp()
	_ = app.GitStage(dir, []string{"f.txt"})
	if _, err := app.GitCommit(dir, "init", false); err != nil {
		t.Fatal(err)
	}

	if err := app.GitCheckout(dir, "feature/y", true); err != nil {
		t.Fatalf("GitCheckout(create) error = %v", err)
	}
	branches, err := app.GitBranches(dir)
	if err != nil {
		t.Fatalf("GitBranches() error = %v", err)
	}
	if len(branches) != 2 {
		t.Errorf("branches = %v, want 2", branches)
	}
}

// makeAppConflict builds a real merge conflict in a temp repo and returns dir.
func makeAppConflict(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	dir := t.TempDir()
	run := func(allowFail bool, args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = isolatedGitEnv()
		if out, err := cmd.CombinedOutput(); err != nil && !allowFail {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	write := func(s string) {
		if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	run(false, "init", "-b", "main")
	run(false, "config", "user.name", "Test")
	run(false, "config", "user.email", "test@example.com")
	write("base\n")
	run(false, "add", ".")
	run(false, "commit", "-m", "base")
	run(false, "checkout", "-b", "feature")
	write("theirs\n")
	run(false, "commit", "-am", "theirs")
	run(false, "checkout", "main")
	write("ours\n")
	run(false, "commit", "-am", "ours")
	run(true, "merge", "feature") // conflicts
	return dir
}

func TestGitMergeBindings_SnapshotStagesHeadsResolve(t *testing.T) {
	dir := makeAppConflict(t)
	app := NewApp()

	snap, err := app.GitConflictSnapshot(dir, "f.txt")
	if err != nil {
		t.Fatalf("GitConflictSnapshot() error = %v", err)
	}
	if len(snap.Regions) != 1 {
		t.Fatalf("regions = %d, want 1", len(snap.Regions))
	}

	heads, err := app.GitMergeHeads(dir)
	if err != nil {
		t.Fatalf("GitMergeHeads() error = %v", err)
	}
	if heads.Operation != "merge" {
		t.Errorf("Operation = %q, want merge", heads.Operation)
	}

	stages, err := app.GitConflictStages(dir, "f.txt")
	if err != nil {
		t.Fatalf("GitConflictStages() error = %v", err)
	}
	if stages.Ours == nil || stages.Theirs == nil {
		t.Errorf("stages incomplete: %+v", stages)
	}

	if err := app.GitResolveConflictSide(dir, "f.txt", "ours"); err != nil {
		t.Fatalf("GitResolveConflictSide() error = %v", err)
	}
	st, _ := app.GitStatus(dir)
	for _, f := range st.Files {
		if f.Unmerged {
			t.Errorf("f.txt still unmerged after resolve: %+v", f)
		}
	}
}

func TestApp_GitConflictState_Binding(t *testing.T) {
	dir := makeAppConflict(t)
	app := NewApp()

	state, err := app.GitConflictState(dir, "f.txt")

	if err != nil {
		t.Fatalf("GitConflictState() error = %v", err)
	}
	if state.SourceVersion == "" {
		t.Error("SourceVersion is empty")
	}
	if state.Snapshot == nil || len(state.Snapshot.Regions) != 1 {
		t.Errorf("Snapshot = %+v, want one region", state.Snapshot)
	}
	if state.Heads == nil || state.Heads.Operation != "merge" {
		t.Errorf("Heads = %+v, want a merge operation", state.Heads)
	}
}

func TestApp_GitConflictGuards_MismatchIsNotAnError(t *testing.T) {
	dir := makeAppConflict(t)
	app := NewApp()
	state, err := app.GitConflictState(dir, "f.txt")
	if err != nil {
		t.Fatal(err)
	}
	stale := state.SourceVersion + "-stale"

	write, err := app.GitWriteConflictResult(dir, "f.txt", stale, "resolved\n", "utf-8", "lf")
	if err != nil {
		t.Fatalf("GitWriteConflictResult() error = %v, want a clean mismatch", err)
	}
	if write.Applied {
		t.Error("write Applied = true, want false")
	}

	stage, err := app.GitStageConflictResult(dir, "f.txt", stale)
	if err != nil {
		t.Fatalf("GitStageConflictResult() error = %v, want a clean mismatch", err)
	}
	if stage.Applied {
		t.Error("stage Applied = true, want false")
	}

	side, err := app.GitApplyConflictSide(dir, "f.txt", "ours", stale)
	if err != nil {
		t.Fatalf("GitApplyConflictSide() error = %v, want a clean mismatch", err)
	}
	if side.Applied {
		t.Error("side Applied = true, want false")
	}

	st, _ := app.GitStatus(dir)
	unmerged := false
	for _, f := range st.Files {
		if f.Unmerged {
			unmerged = true
		}
	}
	if !unmerged {
		t.Error("f.txt is no longer unmerged, want every refused mutation to be a no-op")
	}
}

func TestApp_GitConflictGuards_SucceedWithTheLiveVersion(t *testing.T) {
	dir := makeAppConflict(t)
	app := NewApp()
	state, err := app.GitConflictState(dir, "f.txt")
	if err != nil {
		t.Fatal(err)
	}

	write, err := app.GitWriteConflictResult(dir, "f.txt", state.SourceVersion, "resolved\n", "utf-8", "lf")
	if err != nil || !write.Applied {
		t.Fatalf("GitWriteConflictResult() = %+v, err = %v, want applied", write, err)
	}
	stage, err := app.GitStageConflictResult(dir, "f.txt", write.SourceVersion)
	if err != nil || !stage.Applied {
		t.Fatalf("GitStageConflictResult() = %+v, err = %v, want applied", stage, err)
	}

	st, _ := app.GitStatus(dir)
	for _, f := range st.Files {
		if f.Unmerged {
			t.Errorf("f.txt still unmerged after guarded write and stage: %+v", f)
		}
	}
	got, _ := os.ReadFile(filepath.Join(dir, "f.txt"))
	if string(got) != "resolved\n" {
		t.Errorf("worktree content = %q, want the resolved result", got)
	}
}

func TestApp_GitConflictState_OperationalErrorStillErrors(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	app := NewApp()

	// Not a repository at all: an operational failure must remain an error and
	// never be reported as a benign version mismatch.
	if _, err := app.GitConflictState(t.TempDir(), "f.txt"); err == nil {
		t.Fatal("GitConflictState(non-repo) error = nil, want an operational error")
	}
}

// TestGitStatus_RefreshesTrackedIgnoredFiles (#536): git applies .gitignore
// only to untracked files, so the tree and search list a tracked file a rule
// matches. Each git status refresh re-reads that set, and when it moves the
// app names the tree folders whose listings changed.
func TestGitStatus_RefreshesTrackedIgnoredFiles(t *testing.T) {
	dir := initGitRepoForApp(t)
	gitRun := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = isolatedGitEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	write := func(rel, content string) {
		t.Helper()
		path := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("CLAUDE.md", "needle\n")
	write("data/kaggle/a.csv", "needle\n")
	gitRun("add", "CLAUDE.md", "data")
	gitRun("commit", "-m", "track")
	write(".gitignore", "**/CLAUDE.md\ndata/\n")
	write("data/kaggle/u.csv", "needle\n")

	app := NewApp()
	var stale [][]string
	app.emitFn = func(event string, data any) {
		if event == "filetree:stale" {
			stale = append(stale, data.([]string))
		}
	}
	names := func(path string) []string {
		t.Helper()
		entries, err := app.ReadDirectoryShallow(path, dir)
		if err != nil {
			t.Fatalf("ReadDirectoryShallow(%q): %v", path, err)
		}
		var out []string
		for _, entry := range entries {
			out = append(out, entry.Name)
		}
		return out
	}

	if _, err := app.GitStatus(dir); err != nil {
		t.Fatalf("GitStatus: %v", err)
	}
	if got, want := names(dir), []string{"data", ".gitignore", "CLAUDE.md", "f.txt"}; !slices.Equal(got, want) {
		t.Fatalf("root = %v, want %v", got, want)
	}
	if got, want := names(filepath.Join(dir, "data", "kaggle")), []string{"a.csv"}; !slices.Equal(got, want) {
		t.Fatalf("data/kaggle = %v, want %v", got, want)
	}
	wantStale := []string{dir, filepath.Join(dir, "data"), filepath.Join(dir, "data", "kaggle")}
	if len(stale) != 1 || !slices.Equal(stale[0], wantStale) {
		t.Fatalf("filetree:stale = %v, want one event naming %v", stale, wantStale)
	}

	t.Run("search finds the tracked files", func(t *testing.T) {
		if _, err := exec.LookPath("rg"); err != nil {
			t.Skipf("ripgrep not installed: %v", err)
		}
		resp := app.SearchWorkspace(search.SearchRequest{RequestID: "536", Root: dir, Query: "needle"})
		var got []string
		for _, file := range resp.Files {
			got = append(got, file.RelativePath)
		}
		slices.Sort(got)
		if want := []string{"CLAUDE.md", "data/kaggle/a.csv"}; !slices.Equal(got, want) {
			t.Fatalf("search files = %v (status %s %s), want %v", got, resp.Status, resp.Message, want)
		}
	})

	// An unchanged set names nothing; untracking a file takes it back out.
	if _, err := app.GitStatus(dir); err != nil {
		t.Fatalf("GitStatus: %v", err)
	}
	if len(stale) != 1 {
		t.Fatalf("an unchanged set must not emit, got %v", stale)
	}
	gitRun("rm", "--cached", "-q", "CLAUDE.md")
	if _, err := app.GitStatus(dir); err != nil {
		t.Fatalf("GitStatus: %v", err)
	}
	if len(stale) != 2 || !slices.Equal(stale[1], []string{dir}) {
		t.Fatalf("filetree:stale after git rm --cached = %v, want a second event naming %v", stale, dir)
	}
	if got, want := names(dir), []string{"data", ".gitignore", "f.txt"}; !slices.Equal(got, want) {
		t.Fatalf("root after git rm --cached = %v, want %v", got, want)
	}
}

// TestRefreshTrackedIgnored_FailedListingKeepsLastSet: a failed listing says
// nothing about what git tracks, so the tree keeps the last set it had rather
// than hiding the files #536 brought back.
func TestRefreshTrackedIgnored_FailedListingKeepsLastSet(t *testing.T) {
	dir := initGitRepoForApp(t)
	for _, args := range [][]string{{"add", "f.txt"}, {"commit", "-m", "track"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = isolatedGitEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("f.txt\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	stale := 0
	app.emitFn = func(event string, _ any) {
		if event == "filetree:stale" {
			stale++
		}
	}
	if _, err := app.GitStatus(dir); err != nil {
		t.Fatalf("GitStatus: %v", err)
	}

	// A cancelled context makes git fail before it lists anything.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	app.refreshTrackedIgnored(ctx, dir, true)

	if stale != 1 {
		t.Fatalf("filetree:stale events = %d, want only the first refresh's", stale)
	}
	entries, err := app.ReadDirectoryShallow(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[1].Name != "f.txt" {
		t.Fatalf("entries = %+v, want .gitignore and the tracked f.txt", entries)
	}
}

// TestGitStatus_OutsideRepoLeavesGitignoreAsIs: with no index nothing is
// tracked, so .gitignore hides what it matches, as before #536.
func TestGitStatus_OutsideRepoLeavesGitignoreAsIs(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string]string{".gitignore": "CLAUDE.md\n", "CLAUDE.md": "x\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	app := NewApp()
	app.emitFn = func(event string, _ any) {
		if event == "filetree:stale" {
			t.Errorf("a folder outside git must not emit %s", event)
		}
	}
	if st, err := app.GitStatus(dir); err != nil || st.IsRepo {
		t.Fatalf("GitStatus = %+v, %v; want a non-repo status", st, err)
	}
	entries, err := app.ReadDirectoryShallow(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != ".gitignore" {
		t.Fatalf("entries = %+v, want only .gitignore", entries)
	}
}

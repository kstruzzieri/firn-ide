package git

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Integration tests drive a real git binary against throwaway repos in
// t.TempDir(). Pull/push tests use a local bare repo as origin, so everything
// runs offline.

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
}

// gitCmd runs git in dir with identity/config isolated from the host user.
// Automatic maintenance is off: `git commit` otherwise starts a detached
// `git maintenance run --auto` that can still be writing .git/objects when
// t.TempDir's cleanup removes the repository.
func gitCmd(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(ScrubGitEnv(os.Environ()),
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_SYSTEM=/dev/null",
		"GIT_CONFIG_COUNT=2",
		"GIT_CONFIG_KEY_0=maintenance.auto", "GIT_CONFIG_VALUE_0=false",
		"GIT_CONFIG_KEY_1=gc.auto", "GIT_CONFIG_VALUE_1=0",
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

// initRepo creates a repo on branch main with one committed file.
func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	gitCmd(t, dir, "config", "user.name", "Test")
	gitCmd(t, dir, "config", "user.email", "test@example.com")
	writeFile(t, dir, "README.md", "hello\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "initial")
	return dir
}

// initRepoWithRemote returns a working repo whose origin is a local bare repo.
func initRepoWithRemote(t *testing.T) (work, bare string) {
	t.Helper()
	work = initRepo(t)
	bare = t.TempDir()
	gitCmd(t, bare, "init", "--bare", "-b", "main")
	gitCmd(t, work, "remote", "add", "origin", bare)
	gitCmd(t, work, "push", "-u", "origin", "main")
	return work, bare
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func ctx() context.Context { return context.Background() }

func TestGitCmd_ScrubsRepositoryEnvironment(t *testing.T) {
	requireGit(t)
	sentinel := initRepo(t)
	intended := initRepo(t)
	for _, repo := range []struct {
		dir, content string
	}{
		{sentinel, "sentinel target\n"},
		{intended, "intended target\n"},
	} {
		gitCmd(t, repo.dir, "checkout", "-b", "target")
		writeFile(t, repo.dir, "README.md", repo.content)
		gitCmd(t, repo.dir, "commit", "-am", "target")
		gitCmd(t, repo.dir, "checkout", "main")
	}

	read := func(path string) []byte {
		t.Helper()
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return contents
	}
	headPath := filepath.Join(sentinel, ".git", "HEAD")
	indexPath := filepath.Join(sentinel, ".git", "index")
	readmePath := filepath.Join(sentinel, "README.md")
	headBefore := read(headPath)
	refsBefore := gitCmd(t, sentinel, "show-ref")
	indexBefore := read(indexPath)
	worktreeBefore := gitCmd(t, sentinel, "status", "--porcelain=v2", "--untracked-files=all")
	filesBefore := read(readmePath)

	t.Setenv("GIT_DIR", filepath.Join(sentinel, ".git"))
	t.Setenv("GIT_WORK_TREE", sentinel)
	t.Setenv("GIT_INDEX_FILE", indexPath)
	t.Setenv("GIT_COMMON_DIR", filepath.Join(sentinel, ".git"))
	t.Setenv("GIT_PREFIX", filepath.Base(sentinel)+"/")
	gitCmd(t, intended, "checkout", "-b", "checked", "target")

	if got := read(headPath); !bytes.Equal(got, headBefore) {
		t.Errorf("sentinel HEAD changed from %q to %q", headBefore, got)
	}
	if got := gitCmd(t, sentinel, "show-ref"); got != refsBefore {
		t.Errorf("sentinel refs changed from %q to %q", refsBefore, got)
	}
	if got := read(indexPath); !bytes.Equal(got, indexBefore) {
		t.Error("sentinel index changed")
	}
	if got := gitCmd(t, sentinel, "status", "--porcelain=v2", "--untracked-files=all"); got != worktreeBefore {
		t.Errorf("sentinel worktree status changed from %q to %q", worktreeBefore, got)
	}
	if got := read(readmePath); !bytes.Equal(got, filesBefore) {
		t.Errorf("sentinel README.md changed from %q to %q", filesBefore, got)
	}
	if got := string(read(filepath.Join(intended, ".git", "HEAD"))); got != "ref: refs/heads/checked\n" {
		t.Errorf("intended HEAD = %q, want checked branch", got)
	}
}

// Windows environment names are case-insensitive, so an inherited git_dir is
// GIT_DIR to Git for Windows and must be scrubbed there. On Unix it is a
// distinct variable a user's hook may read, so it must survive.
func TestScrubGitEnv_FoldsCaseOnlyWhenNamesAreCaseInsensitive(t *testing.T) {
	env := []string{"git_dir=/x", "Git_Config=/y", "GIT_INDEX_FILE=/z", "PATH=/bin", "GIT_EDITOR=vi"}

	if got, want := scrubGitEnv(env, false), []string{"git_dir=/x", "Git_Config=/y", "PATH=/bin", "GIT_EDITOR=vi"}; !slices.Equal(got, want) {
		t.Errorf("scrubGitEnv(foldCase=false) = %q, want %q", got, want)
	}
	if got, want := scrubGitEnv(env, true), []string{"PATH=/bin", "GIT_EDITOR=vi"}; !slices.Equal(got, want) {
		t.Errorf("scrubGitEnv(foldCase=true) = %q, want %q", got, want)
	}
}

func TestService_Status_NotARepo(t *testing.T) {
	requireGit(t)
	svc := NewService()

	got, err := svc.Status(ctx(), t.TempDir())

	if err != nil {
		t.Fatalf("Status() error = %v, want nil for non-repo", err)
	}
	if got.IsRepo {
		t.Error("IsRepo = true, want false")
	}
	if got.Detail != "" {
		t.Errorf("Detail = %q, want empty for a plain non-repo", got.Detail)
	}
}

func TestService_Status_BareMisconfigured(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	// A normal project repo wrongly marked bare: git refuses worktree ops.
	gitCmd(t, dir, "config", "core.bare", "true")
	svc := NewService()

	got, err := svc.Status(ctx(), dir)

	if err != nil {
		t.Fatalf("Status() error = %v, want nil", err)
	}
	if got.IsRepo {
		t.Error("IsRepo = true, want false (no usable working tree)")
	}
	if !strings.Contains(got.Detail, "core.bare") {
		t.Errorf("Detail = %q, want a hint mentioning core.bare", got.Detail)
	}
}

func TestService_Status_CleanRepo(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	svc := NewService()

	got, err := svc.Status(ctx(), dir)

	if err != nil {
		t.Fatalf("Status() error = %v", err)
	}
	if !got.IsRepo {
		t.Fatal("IsRepo = false, want true")
	}
	if got.Branch != "main" {
		t.Errorf("Branch = %q, want main", got.Branch)
	}
	if len(got.Files) != 0 {
		t.Errorf("Files = %+v, want empty", got.Files)
	}
	// RepoRoot must resolve symlinks consistently (macOS /tmp → /private/tmp)
	// so frontend path joins match watcher/tree paths.
	if want, _ := filepath.EvalSymlinks(dir); got.RepoRoot != want {
		t.Errorf("RepoRoot = %q, want %q", got.RepoRoot, want)
	}
}

func TestService_Status_FromSubdirectory(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "sub/inner.txt", "x\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "add sub")
	writeFile(t, dir, "sub/inner.txt", "changed\n")
	svc := NewService()

	got, err := svc.Status(ctx(), filepath.Join(dir, "sub"))

	if err != nil {
		t.Fatalf("Status() error = %v", err)
	}
	if want, _ := filepath.EvalSymlinks(dir); got.RepoRoot != want {
		t.Errorf("RepoRoot = %q, want repo top-level %q", got.RepoRoot, want)
	}
	if len(got.Files) != 1 || got.Files[0].Path != "sub/inner.txt" {
		t.Errorf("Files = %+v, want [sub/inner.txt] repo-root-relative", got.Files)
	}
}

func TestService_Status_UntrackedDirectoryReportsFiles(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "nested/a.txt", "x\n")
	svc := NewService()

	got, err := svc.Status(ctx(), dir)

	if err != nil {
		t.Fatalf("Status() error = %v", err)
	}
	if len(got.Files) != 1 || got.Files[0].Path != "nested/a.txt" {
		t.Errorf("Files = %+v, want [nested/a.txt]", got.Files)
	}
}

func TestService_StageAndUnstage(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "a\n")
	writeFile(t, dir, "b.txt", "b\n")
	svc := NewService()

	if err := svc.Stage(ctx(), dir, []string{"a.txt", "b.txt"}); err != nil {
		t.Fatalf("Stage() error = %v", err)
	}
	st, _ := svc.Status(ctx(), dir)
	if n := countWhere(st.Files, func(f FileChange) bool { return f.Index == "A" }); n != 2 {
		t.Fatalf("staged added = %d, want 2 (files: %+v)", n, st.Files)
	}

	if err := svc.Unstage(ctx(), dir, []string{"a.txt"}); err != nil {
		t.Fatalf("Unstage() error = %v", err)
	}
	st, _ = svc.Status(ctx(), dir)
	if n := countWhere(st.Files, func(f FileChange) bool { return f.Index == "A" }); n != 1 {
		t.Errorf("staged added after unstage = %d, want 1 (files: %+v)", n, st.Files)
	}
}

func TestService_IntentToAdd(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "new.txt", "content\n")
	svc := NewService()

	if err := svc.IntentToAdd(ctx(), dir, []string{"new.txt"}); err != nil {
		t.Fatalf("IntentToAdd() error = %v", err)
	}

	// Intent-to-add records the path in the index as an empty blob: the file
	// is tracked (no longer "?") but its content stays unstaged (".A").
	st, _ := svc.Status(ctx(), dir)
	if len(st.Files) != 1 {
		t.Fatalf("Files = %+v, want single entry", st.Files)
	}
	if st.Files[0].Index != "." || st.Files[0].Worktree != "A" {
		t.Errorf("XY = %s%s, want .A (intent-to-add)", st.Files[0].Index, st.Files[0].Worktree)
	}
}

func TestService_IntentToAdd_RejectsTraversal(t *testing.T) {
	requireGit(t)
	svc := NewService()

	if err := svc.IntentToAdd(ctx(), t.TempDir(), []string{"../evil.txt"}); err == nil {
		t.Error("IntentToAdd() with traversal path = nil error, want error")
	}
}

func TestService_Unstage_BeforeFirstCommit(t *testing.T) {
	requireGit(t)
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	gitCmd(t, dir, "config", "user.name", "Test")
	gitCmd(t, dir, "config", "user.email", "test@example.com")
	writeFile(t, dir, "first.txt", "x\n")
	svc := NewService()

	if err := svc.Stage(ctx(), dir, []string{"first.txt"}); err != nil {
		t.Fatalf("Stage() error = %v", err)
	}
	if err := svc.Unstage(ctx(), dir, []string{"first.txt"}); err != nil {
		t.Fatalf("Unstage() on unborn HEAD error = %v", err)
	}

	st, _ := svc.Status(ctx(), dir)
	if len(st.Files) != 1 || st.Files[0].Index != "?" {
		t.Errorf("Files = %+v, want single untracked entry", st.Files)
	}
}

func TestService_Commit(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "a\n")
	svc := NewService()
	_ = svc.Stage(ctx(), dir, []string{"a.txt"})

	out, err := svc.Commit(ctx(), dir, "add a.txt", false)

	if err != nil {
		t.Fatalf("Commit() error = %v", err)
	}
	if !strings.Contains(out, "add a.txt") {
		t.Errorf("Commit output %q missing subject", out)
	}
	st, _ := svc.Status(ctx(), dir)
	if len(st.Files) != 0 {
		t.Errorf("Files after commit = %+v, want empty", st.Files)
	}
}

func TestService_Commit_Amend(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "a\n")
	svc := NewService()
	_ = svc.Stage(ctx(), dir, []string{"a.txt"})
	if _, err := svc.Commit(ctx(), dir, "wip", false); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Commit(ctx(), dir, "better subject", true); err != nil {
		t.Fatalf("Commit(amend) error = %v", err)
	}

	log := gitCmd(t, dir, "log", "--format=%s")
	if strings.Contains(log, "wip") || !strings.Contains(log, "better subject") {
		t.Errorf("log after amend = %q, want subject replaced", log)
	}
	if got := strings.Count(strings.TrimSpace(log), "\n"); got != 1 {
		t.Errorf("commit count = %d lines-1, want exactly 2 commits", got+1)
	}
}

func TestService_Commit_EmptyStage_ReturnsGitError(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	svc := NewService()

	_, err := svc.Commit(ctx(), dir, "nothing", false)

	if err == nil {
		t.Fatal("Commit() with nothing staged: error = nil, want git failure surfaced")
	}
}

func TestService_Branches_And_Checkout(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	gitCmd(t, dir, "branch", "feature/x")
	svc := NewService()

	branches, err := svc.Branches(ctx(), dir)
	if err != nil {
		t.Fatalf("Branches() error = %v", err)
	}
	if len(branches) != 2 || !slices.Contains(branches, "main") || !slices.Contains(branches, "feature/x") {
		t.Fatalf("Branches = %v, want [feature/x main]", branches)
	}

	if err := svc.Checkout(ctx(), dir, "feature/x", false); err != nil {
		t.Fatalf("Checkout() error = %v", err)
	}
	st, _ := svc.Status(ctx(), dir)
	if st.Branch != "feature/x" {
		t.Errorf("Branch after checkout = %q, want feature/x", st.Branch)
	}
}

func TestService_Checkout_Create(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	svc := NewService()

	if err := svc.Checkout(ctx(), dir, "feature/new", true); err != nil {
		t.Fatalf("Checkout(create) error = %v", err)
	}

	st, _ := svc.Status(ctx(), dir)
	if st.Branch != "feature/new" {
		t.Errorf("Branch = %q, want feature/new", st.Branch)
	}
}

func TestService_Checkout_DirtyConflict_SurfacesError(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	gitCmd(t, dir, "checkout", "-b", "other")
	writeFile(t, dir, "README.md", "other version\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "other change")
	gitCmd(t, dir, "checkout", "main")
	writeFile(t, dir, "README.md", "dirty local edit\n")
	svc := NewService()

	err := svc.Checkout(ctx(), dir, "other", false)

	if err == nil {
		t.Fatal("Checkout() over conflicting dirty file: error = nil, want overwrite error")
	}
	if !strings.Contains(err.Error(), "README.md") {
		t.Errorf("error %q should name the conflicting file", err)
	}
}

func TestService_PushPull_WithLocalRemote(t *testing.T) {
	requireGit(t)
	work, _ := initRepoWithRemote(t)
	writeFile(t, work, "new.txt", "n\n")
	svc := NewService()
	_ = svc.Stage(ctx(), work, []string{"new.txt"})
	if _, err := svc.Commit(ctx(), work, "add new", false); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Push(ctx(), work); err != nil {
		t.Fatalf("Push() error = %v", err)
	}
	if out, err := svc.Pull(ctx(), work); err != nil {
		t.Fatalf("Pull() error = %v (out %q)", err, out)
	}

	st, _ := svc.Status(ctx(), work)
	if st.Ahead != 0 || st.Behind != 0 {
		t.Errorf("Ahead/Behind = %d/%d, want 0/0 after push+pull", st.Ahead, st.Behind)
	}
}

func TestService_Push_NoUpstream_SetsUpstream(t *testing.T) {
	requireGit(t)
	work, _ := initRepoWithRemote(t)
	svc := NewService()
	if err := svc.Checkout(ctx(), work, "feature/pr", true); err != nil {
		t.Fatal(err)
	}
	writeFile(t, work, "f.txt", "f\n")
	_ = svc.Stage(ctx(), work, []string{"f.txt"})
	if _, err := svc.Commit(ctx(), work, "feature commit", false); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Push(ctx(), work); err != nil {
		t.Fatalf("Push() on branch without upstream error = %v, want auto -u origin", err)
	}

	st, _ := svc.Status(ctx(), work)
	if st.Upstream != "origin/feature/pr" {
		t.Errorf("Upstream = %q, want origin/feature/pr", st.Upstream)
	}
}

func TestService_Pull_Conflict_SurfacesError(t *testing.T) {
	requireGit(t)
	work, bare := initRepoWithRemote(t)

	// Second clone pushes a conflicting change to the same line.
	other := t.TempDir()
	gitCmd(t, other, "clone", bare, ".")
	gitCmd(t, other, "config", "user.name", "Test")
	gitCmd(t, other, "config", "user.email", "test@example.com")
	writeFile(t, other, "README.md", "their version\n")
	gitCmd(t, other, "add", ".")
	gitCmd(t, other, "commit", "-m", "theirs")
	gitCmd(t, other, "push", "origin", "main")

	// Local diverges on the same file.
	writeFile(t, work, "README.md", "our version\n")
	gitCmd(t, work, "add", ".")
	gitCmd(t, work, "commit", "-m", "ours")

	svc := NewService()
	_, err := svc.Pull(ctx(), work)

	if err == nil {
		t.Fatal("Pull() with divergent same-file edits: error = nil, want conflict error")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "conflict") &&
		!strings.Contains(strings.ToLower(err.Error()), "divergent") {
		t.Errorf("error %q should mention conflict/divergence", err)
	}
}

func TestService_FileAtRev(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "README.md", "staged version\n")
	svc := NewService()
	_ = svc.Stage(ctx(), dir, []string{"README.md"})
	writeFile(t, dir, "README.md", "worktree version\n")

	head, err := svc.FileAtRev(ctx(), dir, "HEAD", "README.md")
	if err != nil {
		t.Fatalf("FileAtRev(HEAD) error = %v", err)
	}
	if head.Content != "hello\n" {
		t.Errorf("HEAD content = %q, want %q", head.Content, "hello\n")
	}
	if head.Binary || head.Truncated {
		t.Errorf("flags = %+v, want plain text", head)
	}

	index, err := svc.FileAtRev(ctx(), dir, ":0", "README.md")
	if err != nil {
		t.Fatalf("FileAtRev(:0) error = %v", err)
	}
	if index.Content != "staged version\n" {
		t.Errorf("index content = %q, want %q", index.Content, "staged version\n")
	}
}

func TestService_FileAtRev_MissingAtRev_ReturnsEmpty(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "brand-new.txt", "new\n")
	svc := NewService()

	// A file that does not exist at HEAD (new file) diffs against empty.
	got, err := svc.FileAtRev(ctx(), dir, "HEAD", "brand-new.txt")

	if err != nil {
		t.Fatalf("FileAtRev() for path missing at rev: error = %v, want nil", err)
	}
	if got.Content != "" {
		t.Errorf("content = %q, want empty string", got.Content)
	}
}

func TestService_FileAtRev_UnbornHead_ReturnsEmpty(t *testing.T) {
	requireGit(t)
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	writeFile(t, dir, "first.txt", "first\n")
	gitCmd(t, dir, "add", "first.txt")
	svc := NewService()

	got, err := svc.FileAtRev(ctx(), dir, "HEAD", "first.txt")

	if err != nil {
		t.Fatalf("FileAtRev() on unborn HEAD: error = %v, want nil", err)
	}
	if got.Content != "" {
		t.Errorf("content = %q, want empty string", got.Content)
	}
}

func TestService_FileAtRev_BinaryDetected(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	bin := append([]byte("PNG"), 0x00, 0x01, 0x02)
	if err := os.WriteFile(filepath.Join(dir, "img.png"), bin, 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", "img.png")
	gitCmd(t, dir, "commit", "-m", "binary")
	svc := NewService()

	got, err := svc.FileAtRev(ctx(), dir, "HEAD", "img.png")

	if err != nil {
		t.Fatalf("FileAtRev(binary) error = %v", err)
	}
	if !got.Binary {
		t.Error("Binary = false, want true for NUL-containing content")
	}
	if got.Content != "" {
		t.Error("binary content should not be shipped to the frontend")
	}
}

func TestService_FileAtRev_LargeFileTruncated(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	big := strings.Repeat("line of generated output\n", 60_000) // ~1.5MB
	writeFile(t, dir, "big.txt", big)
	gitCmd(t, dir, "add", "big.txt")
	gitCmd(t, dir, "commit", "-m", "big")
	svc := NewService()

	got, err := svc.FileAtRev(ctx(), dir, "HEAD", "big.txt")

	if err != nil {
		t.Fatalf("FileAtRev(large) error = %v", err)
	}
	if !got.Truncated {
		t.Error("Truncated = false, want true past the size cap")
	}
	if got.Content != "" {
		t.Error("truncated content should not be shipped; the UI shows a too-large state")
	}
}

func TestService_StagedDiff_ExcludesPaths(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "README.md", "hello\nmore\n")
	writeFile(t, dir, "other.txt", "other content\n")
	svc := NewService()
	_ = svc.Stage(ctx(), dir, []string{"README.md", "other.txt"})

	diff, err := svc.StagedDiff(ctx(), dir, []string{"other.txt"})

	if err != nil {
		t.Fatalf("StagedDiff() error = %v", err)
	}
	if !strings.Contains(diff, "+more") {
		t.Errorf("diff %q missing +more hunk line", diff)
	}
	if strings.Contains(diff, "other") {
		t.Errorf("diff %q includes an excluded path", diff)
	}
}

func TestService_StagedDiff_ExcludeIsLiteral(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "a[1].txt", "bracketed\n")
	writeFile(t, dir, "a1.txt", "plain\n")
	svc := NewService()
	_ = svc.Stage(ctx(), dir, []string{"a[1].txt", "a1.txt"})

	diff, err := svc.StagedDiff(ctx(), dir, []string{"a[1].txt"})

	if err != nil {
		t.Fatalf("StagedDiff() error = %v", err)
	}
	if strings.Contains(diff, "+bracketed") || !strings.Contains(diff, "+plain") {
		t.Errorf("diff %q, want only the literally named file excluded", diff)
	}
}

// A file replaced by a directory: excluding the withheld descendant keeps it
// out while the deletion stays, whatever the caller's pathspec environment.
func TestService_StagedDiff_ExcludesWithheldDescendants(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "config", "plain config\n")
	gitCmd(t, dir, "add", "config")
	gitCmd(t, dir, "commit", "-m", "add config")
	gitCmd(t, dir, "rm", "-q", "config")
	writeFile(t, dir, "config/.env", "TOKEN=descendant\n")
	gitCmd(t, dir, "add", "config/.env")
	svc := NewService()

	for _, env := range []string{"", "GIT_LITERAL_PATHSPECS", "GIT_ICASE_PATHSPECS"} {
		if env != "" {
			t.Setenv(env, "1")
		}
		diff, err := svc.StagedDiff(ctx(), dir, []string{"config/.env"})

		if err != nil {
			t.Fatalf("StagedDiff() with %s error = %v", env, err)
		}
		if !strings.Contains(diff, "-plain config") || strings.Contains(diff, "descendant") || strings.Contains(diff, ".env") {
			t.Errorf("StagedDiff() with %s = %q, want the deletion without the excluded descendant", env, diff)
		}
	}
}

// An unmodified file the caller names as a copy source is checked directly,
// whatever diff.renameLimit says; other unmodified files are not sources.
func TestService_StagedChanges_ReportsCopyOfNamedUnmodifiedSource(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "notes.txt", "one\ntwo\nthree\nfour\n")
	gitCmd(t, dir, "add", "notes.txt")
	gitCmd(t, dir, "commit", "-m", "add notes")
	writeFile(t, dir, "copy.txt", "one\ntwo\nthree\nFOUR\n")
	gitCmd(t, dir, "add", "copy.txt")
	gitCmd(t, dir, "config", "diff.renameLimit", "1")
	svc := NewService()

	changes, err := svc.StagedChanges(ctx(), dir, func(path string) bool { return path == "notes.txt" })

	want := []StagedChange{{Status: 'C', Path: "copy.txt", OldPath: "notes.txt"}}
	if err != nil || !slices.Equal(changes, want) {
		t.Errorf("StagedChanges(notes.txt as source) = %+v, %v, want %+v", changes, err, want)
	}

	changes, err = svc.StagedChanges(ctx(), dir, nil)

	want = []StagedChange{{Status: 'A', Path: "copy.txt"}}
	if err != nil || !slices.Equal(changes, want) {
		t.Errorf("StagedChanges(no sources) = %+v, %v, want %+v", changes, err, want)
	}
}

func TestService_StagedChanges(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "old.txt", "moved content\n")
	gitCmd(t, dir, "add", "old.txt")
	gitCmd(t, dir, "commit", "-m", "add old")
	gitCmd(t, dir, "config", "diff.renames", "false") // renames are still reported
	gitCmd(t, dir, "mv", "old.txt", "moved.txt")
	writeFile(t, dir, "README.md", "hello\nmore\n")
	writeFile(t, dir, "new file.txt", "spaced name\n")
	gitCmd(t, dir, "add", "README.md", "new file.txt")
	svc := NewService()

	changes, err := svc.StagedChanges(ctx(), filepath.Join(dir), nil) // from the root

	if err != nil {
		t.Fatalf("StagedChanges() error = %v", err)
	}
	slices.SortFunc(changes, func(a, b StagedChange) int { return strings.Compare(a.Path, b.Path) })
	want := []StagedChange{
		{Status: 'M', Path: "README.md"},
		{Status: 'R', Path: "moved.txt", OldPath: "old.txt"},
		{Status: 'A', Path: "new file.txt"},
	}
	if !slices.Equal(changes, want) {
		t.Errorf("StagedChanges() = %+v, want %+v", changes, want)
	}

	// Paths stay repo-relative from a subdirectory.
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	fromSub, err := svc.StagedChanges(ctx(), filepath.Join(dir, "sub"), nil)
	if err != nil {
		t.Fatalf("StagedChanges(sub) error = %v", err)
	}
	slices.SortFunc(fromSub, func(a, b StagedChange) int { return strings.Compare(a.Path, b.Path) })
	if !slices.Equal(fromSub, want) {
		t.Errorf("StagedChanges(sub) = %+v, want %+v", fromSub, want)
	}

	empty, err := svc.StagedChanges(ctx(), initRepo(t), nil)
	if err != nil || len(empty) != 0 {
		t.Errorf("StagedChanges(clean) = %+v, %v, want none", empty, err)
	}
}

func countWhere(files []FileChange, pred func(FileChange) bool) int {
	n := 0
	for _, f := range files {
		if pred(f) {
			n++
		}
	}
	return n
}

func TestBatchPathspecs(t *testing.T) {
	spec := strings.Repeat("x", 1000)
	specs := make([]string, 30) // 30 * 1003 bytes: three batches of 12 KiB
	for i := range specs {
		specs[i] = spec
	}

	batches, err := batchPathspecs(specs)

	if err != nil || len(batches) != 3 {
		t.Fatalf("batchPathspecs() = %d batches, %v, want 3", len(batches), err)
	}
	total := 0
	for _, batch := range batches {
		total += len(batch)
		if size := len(batch) * (len(spec) + 3); size > copyCheckBatchBytes {
			t.Errorf("batch of %d bytes exceeds %d", size, copyCheckBatchBytes)
		}
	}
	if total != len(specs) {
		t.Errorf("batches hold %d pathspecs, want %d", total, len(specs))
	}

	if _, err := batchPathspecs([]string{strings.Repeat("x", copyCheckBatchBytes)}); !errors.Is(err, ErrPathTooLong) {
		t.Errorf("batchPathspecs(oversized) error = %v, want ErrPathTooLong", err)
	}
}

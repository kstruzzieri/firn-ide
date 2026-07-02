package git

import (
	"context"
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
func gitCmd(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_SYSTEM=/dev/null",
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
	if head != "hello\n" {
		t.Errorf("HEAD content = %q, want %q", head, "hello\n")
	}

	index, err := svc.FileAtRev(ctx(), dir, ":0", "README.md")
	if err != nil {
		t.Fatalf("FileAtRev(:0) error = %v", err)
	}
	if index != "staged version\n" {
		t.Errorf("index content = %q, want %q", index, "staged version\n")
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
	if got != "" {
		t.Errorf("content = %q, want empty string", got)
	}
}

func TestService_StagedDiff(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "README.md", "hello\nmore\n")
	svc := NewService()
	_ = svc.Stage(ctx(), dir, []string{"README.md"})

	diff, err := svc.StagedDiff(ctx(), dir)

	if err != nil {
		t.Fatalf("StagedDiff() error = %v", err)
	}
	if !strings.Contains(diff, "+more") {
		t.Errorf("diff %q missing +more hunk line", diff)
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

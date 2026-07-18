package main

import (
	"context"
	"errors"
	"firn/internal/git"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// isolatedGitEnv strips the repository-local GIT_* variables (so an inherited
// GIT_DIR from a linked worktree cannot redirect these test git commands into
// the real repo) and pins config to /dev/null. Package main cannot reach the
// git package's unexported scrubGitEnv, so this mirrors it locally.
func isolatedGitEnv() []string {
	env := make([]string, 0, len(os.Environ())+6)
	for _, v := range os.Environ() {
		switch {
		case strings.HasPrefix(v, "GIT_DIR="),
			strings.HasPrefix(v, "GIT_WORK_TREE="),
			strings.HasPrefix(v, "GIT_INDEX_FILE="),
			strings.HasPrefix(v, "GIT_COMMON_DIR="),
			strings.HasPrefix(v, "GIT_OBJECT_DIRECTORY="):
			continue
		}
		env = append(env, v)
	}
	return append(env,
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

func TestGitCommitMessageAvailable_UsesGenerator(t *testing.T) {
	app := NewApp()
	app.gitMsgGen = &git.MessageGenerator{
		LookPath: func(string) (string, error) { return "", errors.New("absent") },
		Run: func(context.Context, string, []string) (string, error) {
			t.Fatal("Run must not be called when binary is absent")
			return "", nil
		},
	}

	if app.GitCommitMessageAvailable() {
		t.Error("GitCommitMessageAvailable() = true, want false when golem absent")
	}
}

func TestGitGenerateCommitMessage_Binding(t *testing.T) {
	dir := initGitRepoForApp(t)
	app := NewApp()
	if err := app.GitStage(dir, []string{"f.txt"}); err != nil {
		t.Fatal(err)
	}
	app.gitMsgGen = &git.MessageGenerator{
		LookPath: func(string) (string, error) { return "/fake/golem", nil },
		Run: func(_ context.Context, _ string, args []string) (string, error) {
			return "feat: add f.txt\n", nil
		},
	}

	msg, err := app.GitGenerateCommitMessage(dir)

	if err != nil {
		t.Fatalf("GitGenerateCommitMessage() error = %v", err)
	}
	if msg != "feat: add f.txt" {
		t.Errorf("msg = %q", msg)
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

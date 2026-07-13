package main

import (
	"context"
	"errors"
	"firn/internal/git"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

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

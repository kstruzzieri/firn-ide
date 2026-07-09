package main

import (
	"context"
	"firn/internal/git"
	"time"
)

// Timeouts for git bindings. Local plumbing is fast; pull/push cross the
// network; message generation waits on a local LLM.
const (
	gitLocalTimeout    = 15 * time.Second
	gitNetworkTimeout  = 120 * time.Second
	gitGenerateTimeout = 180 * time.Second
)

// gitCtx derives a bounded context from the Wails app context so operations
// die with the window and never hang a binding forever.
func (a *App) gitCtx(timeout time.Duration) (context.Context, context.CancelFunc) {
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	return context.WithTimeout(parent, timeout)
}

// GitStatus returns the repository snapshot for the repo containing root.
// IsRepo=false (with no error) means root is not inside a git repository or
// git is not installed; the frontend hides git UI in that case.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitStatus(root string) (git.RepoStatus, error) {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitService.Status(ctx, root)
}

// GitStage adds repo-root-relative paths to the index.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitStage(root string, paths []string) error {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitService.Stage(ctx, root, paths)
}

// GitUnstage removes repo-root-relative paths from the index.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitUnstage(root string, paths []string) error {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitService.Unstage(ctx, root, paths)
}

// GitCommit records staged changes; amend replaces the previous commit.
// Returns git's summary line for display.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitCommit(root, message string, amend bool) (string, error) {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitService.Commit(ctx, root, message, amend)
}

// GitPull integrates the upstream branch. Conflict output is returned as an
// error message for the UI.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitPull(root string) (string, error) {
	ctx, cancel := a.gitCtx(gitNetworkTimeout)
	defer cancel()
	return a.gitService.Pull(ctx, root)
}

// GitPush publishes the current branch, setting an origin upstream on the
// first push of a new branch.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitPush(root string) (string, error) {
	ctx, cancel := a.gitCtx(gitNetworkTimeout)
	defer cancel()
	return a.gitService.Push(ctx, root)
}

// GitBranches lists local branch names.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitBranches(root string) ([]string, error) {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitService.Branches(ctx, root)
}

// GitCheckout switches branches, creating the branch first when create is
// set. Dirty-file overwrite errors surface verbatim.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitCheckout(root, branch string, create bool) error {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitService.Checkout(ctx, root, branch, create)
}

// GitFileAtRev returns file content at a revision ("HEAD", ":0" for the
// index) with binary/too-large flags the diff UI special-cases. Paths new at
// that revision return empty content for diffing.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitFileAtRev(root, rev, path string) (git.FileContent, error) {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitService.FileAtRev(ctx, root, rev, path)
}

// GitFileHunks returns the per-hunk breakdown of a file's diff. staged=false
// yields working-tree-vs-index hunks (stageable); staged=true yields
// index-vs-HEAD hunks (unstageable). Each hunk carries a standalone patch for
// GitApplyHunk.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitFileHunks(root, path string, staged bool) (git.FileHunks, error) {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitService.FileHunks(ctx, root, path, staged)
}

// GitApplyHunk stages (reverse=false) or unstages (reverse=true) a single hunk
// by applying its patch to the index with `git apply --cached`.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitApplyHunk(root, patch string, reverse bool) error {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitService.ApplyPatch(ctx, root, patch, reverse)
}

// GitCommitMessageAvailable reports whether AI commit-message generation is
// usable (golem with one-shot support on PATH). The frontend hides the
// generate button when false.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitCommitMessageAvailable() bool {
	ctx, cancel := a.gitCtx(gitLocalTimeout)
	defer cancel()
	return a.gitMsgGen.Available(ctx)
}

// GitGenerateCommitMessage produces a commit message for the staged diff via
// the local golem agent.
// This is exposed to the frontend via Wails bindings.
func (a *App) GitGenerateCommitMessage(root string) (string, error) {
	ctx, cancel := a.gitCtx(gitGenerateTimeout)
	defer cancel()
	diff, err := a.gitService.StagedDiff(ctx, root)
	if err != nil {
		return "", err
	}
	return a.gitMsgGen.Generate(ctx, root, diff)
}

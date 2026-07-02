package git

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Service runs git operations by shelling out to the user's git binary, so
// their existing credential helpers, SSH agents, and hooks keep working.
type Service struct{}

// NewService returns a Service. It does not verify git is installed; Status
// reports IsRepo=false when git is missing, and operations surface the error.
func NewService() *Service {
	return &Service{}
}

// run executes git with args in dir. GIT_TERMINAL_PROMPT=0 turns interactive
// credential prompts into immediate errors (a desktop app has no terminal to
// answer them); LC_ALL=C pins parseable English output.
func (s *Service) run(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return stdout.String(), fmt.Errorf("git %s: %s", args[0], msg)
	}
	return stdout.String(), nil
}

// Status returns the repository snapshot for the repo containing dir.
// A missing git binary or a dir outside any repo yields IsRepo=false, nil.
func (s *Service) Status(ctx context.Context, dir string) (RepoStatus, error) {
	root, err := s.run(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil {
		return RepoStatus{Files: []FileChange{}}, nil
	}

	out, err := s.run(ctx, dir, "status", "--porcelain=v2", "--branch", "-z")
	if err != nil {
		return RepoStatus{}, err
	}

	status := parsePorcelainV2([]byte(out))
	status.IsRepo = true
	status.RepoRoot = strings.TrimSpace(root)
	return status, nil
}

// Stage adds the given repo-root-relative paths to the index.
func (s *Service) Stage(ctx context.Context, dir string, paths []string) error {
	_, err := s.runAtRoot(ctx, dir, append([]string{"add", "--"}, paths...)...)
	return err
}

// Unstage removes paths from the index. On an unborn HEAD (no commits yet)
// `restore --staged` cannot resolve HEAD, so fall back to rm --cached.
func (s *Service) Unstage(ctx context.Context, dir string, paths []string) error {
	if _, err := s.run(ctx, dir, "rev-parse", "--verify", "HEAD"); err != nil {
		_, err := s.runAtRoot(ctx, dir, append([]string{"rm", "--cached", "-r", "--"}, paths...)...)
		return err
	}
	_, err := s.runAtRoot(ctx, dir, append([]string{"restore", "--staged", "--"}, paths...)...)
	return err
}

// Commit records staged changes. With amend, the previous commit is replaced.
// Returns git's summary output for display.
func (s *Service) Commit(ctx context.Context, dir, message string, amend bool) (string, error) {
	args := []string{"commit", "-m", message}
	if amend {
		args = append(args, "--amend")
	}
	return s.run(ctx, dir, args...)
}

// Pull fetches and integrates the upstream branch. Conflict and divergence
// errors are returned verbatim from git for the UI to display.
func (s *Service) Pull(ctx context.Context, dir string) (string, error) {
	return s.run(ctx, dir, "pull")
}

// Push publishes the current branch. When it has no upstream yet, the branch
// is pushed with -u to origin so subsequent pushes and ahead/behind work.
func (s *Service) Push(ctx context.Context, dir string) (string, error) {
	if _, err := s.run(ctx, dir, "rev-parse", "--abbrev-ref", "@{upstream}"); err != nil {
		return s.run(ctx, dir, "push", "-u", "origin", "HEAD")
	}
	return s.run(ctx, dir, "push")
}

// Branches lists local branch names.
func (s *Service) Branches(ctx context.Context, dir string) ([]string, error) {
	out, err := s.run(ctx, dir, "branch", "--list", "--format=%(refname:short)")
	if err != nil {
		return nil, err
	}
	var branches []string
	for _, line := range strings.Split(out, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			branches = append(branches, line)
		}
	}
	return branches, nil
}

// Checkout switches to branch, creating it from the current HEAD when create
// is set. Overwrite errors (dirty conflicting files) surface verbatim.
func (s *Service) Checkout(ctx context.Context, dir, branch string, create bool) error {
	args := []string{"checkout"}
	if create {
		args = append(args, "-b")
	}
	args = append(args, branch)
	_, err := s.run(ctx, dir, args...)
	return err
}

// FileAtRev returns the content of a repo-root-relative path at rev ("HEAD",
// ":0" for the index, ...). A path that does not exist at rev returns "" so
// new files diff against empty content.
func (s *Service) FileAtRev(ctx context.Context, dir, rev, path string) (string, error) {
	out, err := s.runAtRoot(ctx, dir, "show", rev+":"+path)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") ||
			strings.Contains(err.Error(), "exists on disk, but not in") {
			return "", nil
		}
		return "", err
	}
	return out, nil
}

// StagedDiff returns the unified diff of the index against HEAD, used as
// input for commit-message generation.
func (s *Service) StagedDiff(ctx context.Context, dir string) (string, error) {
	return s.run(ctx, dir, "diff", "--cached")
}

// runAtRoot runs git from the repo top-level, so repo-root-relative path
// arguments (the porcelain contract) resolve even when dir is a subdirectory.
func (s *Service) runAtRoot(ctx context.Context, dir string, args ...string) (string, error) {
	root := dir
	if out, err := s.run(ctx, dir, "rev-parse", "--show-toplevel"); err == nil {
		root = strings.TrimSpace(out)
	}
	return s.run(ctx, root, args...)
}

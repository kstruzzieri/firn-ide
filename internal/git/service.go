package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Service runs git operations by shelling out to the user's git binary, so
// their existing credential helpers, SSH agents, and hooks keep working.
type Service struct{}

// ScrubGitEnv drops the repository-local GIT_* variables Git exports to hooks
// (and that hooks re-export to their children). Left in place, an inherited
// GIT_DIR/GIT_INDEX_FILE/GIT_OBJECT_DIRECTORY/etc. overrides cmd.Dir and
// redirects the operation into whatever repository the parent was pointed at.
// The set mirrors Git's own repository-local env (`git rev-parse
// --local-env-vars`): these are exactly the variables Git treats as
// repository-scoped and refuses to leak into submodules, so scrubbing the same
// set is the root-cause fix rather than patching the one variable that happened
// to bite us. Returns a fresh slice; the input is never mutated. Exported so
// package main's git tests share this one list instead of a drifting copy.
func ScrubGitEnv(env []string) []string {
	return scrubGitEnv(env, runtime.GOOS == "windows")
}

// scrubGitEnv is ScrubGitEnv with the platform's name matching made explicit.
// foldCase matches names case-insensitively, as Windows resolves them (git_dir
// is GIT_DIR there). On Unix a lowercase git_dir is a distinct variable a
// user's hook or credential helper may read, so it must pass through.
func scrubGitEnv(env []string, foldCase bool) []string {
	clean := make([]string, 0, len(env))
	for _, variable := range env {
		name, _, _ := strings.Cut(variable, "=")
		if foldCase {
			name = strings.ToUpper(name)
		}
		switch name {
		case "GIT_DIR",
			"GIT_WORK_TREE",
			"GIT_IMPLICIT_WORK_TREE",
			"GIT_INDEX_FILE",
			"GIT_COMMON_DIR",
			"GIT_PREFIX",
			"GIT_OBJECT_DIRECTORY",
			"GIT_ALTERNATE_OBJECT_DIRECTORIES",
			"GIT_GRAFT_FILE",
			"GIT_SHALLOW_FILE",
			"GIT_NAMESPACE",
			"GIT_NO_REPLACE_OBJECTS",
			"GIT_REPLACE_REF_BASE",
			"GIT_CONFIG",
			"GIT_CONFIG_PARAMETERS",
			"GIT_CONFIG_COUNT",
			"GIT_INTERNAL_SUPER_PREFIX":
			continue
		}
		clean = append(clean, variable)
	}
	return clean
}

// NewService returns a Service. It does not verify git is installed; Status
// reports IsRepo=false when git is missing, and operations surface the error.
func NewService() *Service {
	return &Service{}
}

// run executes git with args in dir. GIT_TERMINAL_PROMPT=0 turns interactive
// credential prompts into immediate errors (a desktop app has no terminal to
// answer them); LC_ALL=C pins parseable English output.
func (s *Service) run(ctx context.Context, dir string, args ...string) (string, error) {
	stdout, _, err := s.runEnv(ctx, dir, nil, args...)
	return stdout, err
}

// runEnv is run with extra environment entries, which override inherited
// ones, and returns stderr as well, which git uses for warnings even when the
// command succeeds.
func (s *Service) runEnv(ctx context.Context, dir string, env []string, args ...string) (string, string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(append(ScrubGitEnv(os.Environ()), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C"), env...)
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
		return stdout.String(), stderr.String(), fmt.Errorf("git %s: %s", args[0], msg)
	}
	return stdout.String(), stderr.String(), nil
}

// Status returns the repository snapshot for the repo containing dir.
// A missing git binary or a dir outside any repo yields IsRepo=false, nil.
func (s *Service) Status(ctx context.Context, dir string) (RepoStatus, error) {
	root, err := s.run(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil {
		// --show-toplevel needs a working tree. If the directory is still a
		// git dir (e.g. a normal repo wrongly marked core.bare=true), say so
		// with a fix rather than reporting "not a git repository".
		if _, gitErr := s.run(ctx, dir, "rev-parse", "--git-dir"); gitErr == nil {
			return RepoStatus{
				Files:  []FileChange{},
				Detail: "This git repository has no working tree (core.bare=true). Fix it with: git config core.bare false",
			}, nil
		}
		return RepoStatus{Files: []FileChange{}}, nil
	}

	out, err := s.run(ctx, dir, "status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z")
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
	if err := validateRepoRelPaths(paths); err != nil {
		return err
	}
	_, err := s.runAtRoot(ctx, dir, append([]string{literalPathspecs, "add", "--"}, paths...)...)
	return err
}

// IntentToAdd records untracked paths in the index as empty blobs
// (git add --intent-to-add): the files become tracked and diffable while
// their content stays unstaged, enabling later hunk-by-hunk staging.
func (s *Service) IntentToAdd(ctx context.Context, dir string, paths []string) error {
	if err := validateRepoRelPaths(paths); err != nil {
		return err
	}
	_, err := s.runAtRoot(ctx, dir, append([]string{"add", "--intent-to-add", "--"}, paths...)...)
	return err
}

// Unstage removes paths from the index. On an unborn HEAD (no commits yet)
// `restore --staged` cannot resolve HEAD, so fall back to rm --cached.
func (s *Service) Unstage(ctx context.Context, dir string, paths []string) error {
	if err := validateRepoRelPaths(paths); err != nil {
		return err
	}
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

// maxDiffableBytes caps content shipped over the bindings bridge for diffs.
// Beyond this the UI renders a "diff too large" state instead of a merge view.
const maxDiffableBytes = 1 << 20 // 1MB

// FileContent is file content at a revision, with the states the diff UI must
// special-case: binary files and files past the diffable size cap ship no
// content at all — the flags alone drive the UI.
type FileContent struct {
	Content   string `json:"content"`
	Binary    bool   `json:"binary"`
	Truncated bool   `json:"truncated"`
}

// FileAtRev returns the content of a repo-root-relative path at rev ("HEAD",
// ":0" for the index). A path that does not exist at rev returns empty content
// so new files diff against empty.
func (s *Service) FileAtRev(ctx context.Context, dir, rev, path string) (FileContent, error) {
	if err := validateRev(rev); err != nil {
		return FileContent{}, err
	}
	if err := validateRepoRelPaths([]string{path}); err != nil {
		return FileContent{}, err
	}
	out, err := s.runAtRoot(ctx, dir, "show", rev+":"+path)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") ||
			strings.Contains(err.Error(), "exists on disk, but not in") ||
			strings.Contains(err.Error(), "but not at stage") ||
			strings.Contains(err.Error(), "invalid object name 'HEAD'") {
			return FileContent{}, nil
		}
		return FileContent{}, err
	}
	if isBinary(out) {
		return FileContent{Binary: true}, nil
	}
	if len(out) > maxDiffableBytes {
		return FileContent{Truncated: true}, nil
	}
	return FileContent{Content: out}, nil
}

// isBinary mirrors git's own heuristic: a NUL byte in the first 8000 bytes.
func isBinary(content string) bool {
	probe := content
	if len(probe) > 8000 {
		probe = probe[:8000]
	}
	return strings.ContainsRune(probe, 0)
}

// StagedChange is one staged path as `git diff --cached --name-status` reports
// it: Status is the status letter (A, M, D, R, C, T, U), Path and OldPath are
// repo-relative, and OldPath is set only for a rename or copy.
type StagedChange struct {
	Status  byte
	Path    string
	OldPath string
}

// ErrRenameDetectionLimited reports that git stopped pairing inexact renames
// because more files changed than diff.renameLimit allows, so a modified
// rename lists as an unrelated deletion and addition and cannot be checked
// as one change.
var ErrRenameDetectionLimited = errors.New("too many staged files for git to pair renames, so they cannot be checked against the AI policy; write this message by hand")

// StagedChanges lists the staged paths. Rename and copy detection are forced
// on, copies from unmodified files included, so a rename or copy reports both
// sides whatever diff.renames says. Exact copies are found in any repository;
// past diff.renameLimit git pairs inexact copies only from modified files and
// returns ErrRenameDetectionLimited when it pairs no inexact renames at all.
func (s *Service) StagedChanges(ctx context.Context, dir string) ([]StagedChange, error) {
	root, err := s.TopLevel(ctx, dir)
	if err != nil {
		return nil, err
	}
	out, warnings, err := s.runEnv(ctx, root, nil, "diff", "--cached", "-M", "--find-copies-harder", "--name-status", "-z")
	if err != nil {
		return nil, err
	}
	// "inexact" before git 2.48, "exhaustive" since; both end this way.
	if strings.Contains(warnings, "rename detection was skipped") {
		return nil, ErrRenameDetectionLimited
	}
	return parseNameStatus(out)
}

// parseNameStatus decodes `--name-status -z` output: a status token, NUL, the
// path, NUL; a rename or copy carries the old path first, then the new one.
func parseNameStatus(out string) ([]StagedChange, error) {
	fields := strings.Split(out, "\x00")
	var changes []StagedChange
	for i := 0; i < len(fields); {
		status := fields[i]
		if status == "" { // the terminator after the final entry
			i++
			continue
		}
		if i+1 >= len(fields) {
			return nil, fmt.Errorf("git diff --name-status: truncated entry %q", status)
		}
		change := StagedChange{Status: status[0], Path: fields[i+1]}
		i += 2
		if change.Status == 'R' || change.Status == 'C' {
			if i >= len(fields) {
				return nil, fmt.Errorf("git diff --name-status: truncated rename %q", change.Path)
			}
			change.OldPath, change.Path = change.Path, fields[i]
			i++
		}
		changes = append(changes, change)
	}
	return changes, nil
}

// pathspecEnv restores git's default pathspec handling, so an inherited
// GIT_LITERAL_PATHSPECS cannot switch off the exclude magic StagedDiff relies
// on, and no glob or case folding widens a path.
var pathspecEnv = []string{
	"GIT_LITERAL_PATHSPECS=0",
	"GIT_GLOB_PATHSPECS=0",
	"GIT_NOGLOB_PATHSPECS=0",
	"GIT_ICASE_PATHSPECS=0",
}

// StagedDiff returns the unified diff of the index against HEAD for include,
// minus exclude, all repo-relative and taken literally, as input for
// commit-message generation (#384). A path also selects everything staged
// under a directory of that name, which is why exclude exists. No include is
// no diff, never everything: the caller decides what the model may see.
// External diff drivers, textconv filters and submodule expansion are off, so
// repository config cannot add content from paths the caller never checked.
func (s *Service) StagedDiff(ctx context.Context, dir string, include, exclude []string) (string, error) {
	if len(include) == 0 {
		return "", nil
	}
	root, err := s.TopLevel(ctx, dir)
	if err != nil {
		return "", err
	}
	args := []string{"diff", "--cached", "-M", "--no-color", "--no-ext-diff", "--no-textconv", "--submodule=short", "--"}
	for _, path := range include {
		args = append(args, ":(top,literal)"+path)
	}
	for _, path := range exclude {
		args = append(args, ":(top,literal,exclude)"+path)
	}
	out, _, err := s.runEnv(ctx, root, pathspecEnv, args...)
	return out, err
}

// TopLevel returns the root of the working tree containing dir.
func (s *Service) TopLevel(ctx context.Context, dir string) (string, error) {
	out, err := s.run(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// runAtRoot runs git from the repo top-level, so repo-root-relative path
// arguments (the porcelain contract) resolve even when dir is a subdirectory.
func (s *Service) runAtRoot(ctx context.Context, dir string, args ...string) (string, error) {
	root := dir
	if top, err := s.TopLevel(ctx, dir); err == nil {
		root = top
	}
	return s.run(ctx, root, args...)
}

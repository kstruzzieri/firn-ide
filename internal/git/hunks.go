package git

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// Hunk is one @@-block of a file's unified diff. Patch is a standalone,
// applyable patch — the file header followed by this single hunk — so the
// frontend can replay exactly what the user saw through `git apply` without
// reconstructing anything. NewStart/NewLines locate the hunk on the new side
// (the right pane of the diff view) so the UI can anchor a gutter control.
type Hunk struct {
	Patch    string `json:"patch"`
	NewStart int    `json:"newStart"`
	NewLines int    `json:"newLines"`
}

// FileHunks is the per-hunk breakdown of a single file's diff. A binary file
// or a file with no diff yields an empty Hunks slice (never nil, for stable
// JSON), which the UI renders as "no per-hunk staging here".
type FileHunks struct {
	Path  string `json:"path"`
	Hunks []Hunk `json:"hunks"`
}

// FileHunks returns the unified diff of path split into hunks. staged=false
// diffs the working tree against the index (hunks the user can stage);
// staged=true diffs the index against HEAD (hunks the user can unstage).
// --no-color/--no-ext-diff pin plain, applyable output regardless of user
// config or diff drivers. Zero context keeps nearby edits as separate hunks —
// with the default 3 lines, changes within ~6 lines coalesce into one hunk and
// the UI gets a single staging control for visually distinct changes — and
// anchors each hunk exactly at its changed line. Exactness is safe here
// because the patch preimage is the very index it is applied to (ApplyPatch),
// so context lines add no protection.
func (s *Service) FileHunks(ctx context.Context, dir, path string, staged bool) (FileHunks, error) {
	if err := validateRepoRelPaths([]string{path}); err != nil {
		return FileHunks{}, err
	}
	args := []string{
		"diff",
		"--no-color",
		"--no-ext-diff",
		"--no-textconv",
		"--unified=0",
		"--src-prefix=a/",
		"--dst-prefix=b/",
	}
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--", path)
	out, err := s.runAtRoot(ctx, dir, args...)
	if err != nil {
		return FileHunks{}, err
	}
	return parseFileHunks(out, path), nil
}

// ApplyPatch applies a single-hunk patch to the index via `git apply --cached`
// (reverse=true adds --reverse, which unstages). The patch must be one git
// produced; it is validated as a diff and then run against the index, whose
// content matches the patch's preimage by construction. --unidiff-zero admits
// the zero-context patches FileHunks generates (git otherwise insists on
// context lines); the removed-line content is still verified against the index.
func (s *Service) ApplyPatch(ctx context.Context, dir, patch string, reverse bool) error {
	if !looksLikePatch(patch) {
		return fmt.Errorf("not a git patch")
	}
	args := []string{"apply", "--cached", "--unidiff-zero"}
	if reverse {
		args = append(args, "--reverse")
	}
	_, err := s.runAtRootStdin(ctx, dir, patch, args...)
	return err
}

// looksLikePatch is a cheap guard at the bindings boundary: reject anything
// that is not a unified diff before it reaches `git apply`. git itself does
// the real validation and rejects patches that do not apply.
func looksLikePatch(patch string) bool {
	return strings.HasPrefix(patch, "diff --git ") || strings.HasPrefix(patch, "--- ")
}

// parseFileHunks splits one file's unified diff into a header (everything
// before the first @@) and its hunks. Each hunk's Patch is header+hunk-text so
// it applies on its own. A single `git diff -- <path>` yields at most one file
// section; content before the first @@ that isn't a diff (empty output, binary
// notice) simply produces no hunks.
func parseFileHunks(raw, path string) FileHunks {
	result := FileHunks{Path: path, Hunks: []Hunk{}}
	firstHunk := strings.Index(raw, "\n@@")
	if firstHunk < 0 {
		if strings.HasPrefix(raw, "@@") {
			firstHunk = -1 // header is empty; hunks start at offset 0
		} else {
			return result // no hunks (empty, binary, or mode-only change)
		}
	}
	var header, body string
	if firstHunk < 0 {
		body = raw
	} else {
		header = raw[:firstHunk+1] // include the newline before the first @@
		body = raw[firstHunk+1:]
	}

	// Split body into hunks at each line that begins with "@@".
	lines := strings.SplitAfter(body, "\n")
	var cur strings.Builder
	var curStart, curLines int
	flush := func() {
		if cur.Len() == 0 {
			return
		}
		result.Hunks = append(result.Hunks, Hunk{
			Patch:    header + cur.String(),
			NewStart: curStart,
			NewLines: curLines,
		})
		cur.Reset()
	}
	for _, line := range lines {
		if strings.HasPrefix(line, "@@") {
			flush()
			curStart, curLines = parseHunkHeader(line)
		}
		if cur.Len() > 0 || strings.HasPrefix(line, "@@") {
			cur.WriteString(line)
		}
	}
	flush()
	return result
}

// parseHunkHeader extracts the new-side start line and line count from an
// "@@ -old,oldN +new,newN @@" header. A missing count means 1 (git omits it
// for single-line ranges). Malformed headers degrade to 0/0 rather than
// dropping the hunk — the patch text is still authoritative for applying.
func parseHunkHeader(line string) (start, count int) {
	_, rest, ok := strings.Cut(line, "+")
	if !ok {
		return 0, 0
	}
	end := strings.IndexAny(rest, " \t")
	if end >= 0 {
		rest = rest[:end]
	}
	startStr, countStr, hasCount := strings.Cut(rest, ",")
	start, _ = strconv.Atoi(startStr)
	if !hasCount {
		return start, 1
	}
	count, _ = strconv.Atoi(countStr)
	return start, count
}

// runStdin is run() with a patch piped to git's stdin, for `git apply`.
func (s *Service) runStdin(ctx context.Context, dir, stdin string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	cmd.Stdin = strings.NewReader(stdin)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return stdout.String(), fmt.Errorf("git %s: %s", args[0], msg)
	}
	return stdout.String(), nil
}

// runAtRootStdin runs runStdin from the repo top-level so the a/ b/ paths in
// the patch resolve regardless of which subdirectory dir points at.
func (s *Service) runAtRootStdin(ctx context.Context, dir, stdin string, args ...string) (string, error) {
	root := dir
	if out, err := s.run(ctx, dir, "rev-parse", "--show-toplevel"); err == nil {
		root = strings.TrimSpace(out)
	}
	return s.runStdin(ctx, root, stdin, args...)
}

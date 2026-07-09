package git

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestService_FileHunks_StageSingleHunk is the tracer: a real `git diff` for a
// one-line modification parses into exactly one hunk, and replaying that hunk's
// patch through `git apply --cached` stages it — proving the full round-trip.
func TestService_FileHunks_StageSingleHunk(t *testing.T) {
	requireGit(t)
	dir := initRepo(t) // README.md committed as "hello\n"
	writeFile(t, dir, "README.md", "hello\nworld\n")
	svc := NewService()

	fh, err := svc.FileHunks(ctx(), dir, "README.md", false) // unstaged
	if err != nil {
		t.Fatalf("FileHunks() error = %v", err)
	}
	if len(fh.Hunks) != 1 {
		t.Fatalf("hunks = %d, want 1 (%+v)", len(fh.Hunks), fh.Hunks)
	}
	if !strings.Contains(fh.Hunks[0].Patch, "+world") {
		t.Errorf("hunk patch missing +world:\n%s", fh.Hunks[0].Patch)
	}

	if err := svc.ApplyPatch(ctx(), dir, fh.Hunks[0].Patch, false); err != nil {
		t.Fatalf("ApplyPatch() error = %v", err)
	}

	st, _ := svc.Status(ctx(), dir)
	n := countWhere(st.Files, func(f FileChange) bool {
		return f.Path == "README.md" && f.Index == "M"
	})
	if n != 1 {
		t.Errorf("staged-modified README.md = %d, want 1 (files %+v)", n, st.Files)
	}
}

// TestService_FileHunks_UnstageSingleHunk drives the staged side: a staged
// change parses from `git diff --cached`, and reverse-applying its hunk unstages
// it — the index returns to HEAD while the worktree edit survives.
func TestService_FileHunks_UnstageSingleHunk(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "README.md", "hello\nworld\n")
	svc := NewService()
	if err := svc.Stage(ctx(), dir, []string{"README.md"}); err != nil {
		t.Fatal(err)
	}

	fh, err := svc.FileHunks(ctx(), dir, "README.md", true) // staged
	if err != nil {
		t.Fatalf("FileHunks(staged) error = %v", err)
	}
	if len(fh.Hunks) != 1 {
		t.Fatalf("staged hunks = %d, want 1 (%+v)", len(fh.Hunks), fh.Hunks)
	}

	if err := svc.ApplyPatch(ctx(), dir, fh.Hunks[0].Patch, true); err != nil {
		t.Fatalf("ApplyPatch(reverse) error = %v", err)
	}

	st, _ := svc.Status(ctx(), dir)
	f := findFile(st.Files, "README.md")
	if f == nil {
		t.Fatalf("README.md missing from status %+v", st.Files)
	}
	if f.Index == "M" {
		t.Errorf("README.md still staged after unstage (index=%q)", f.Index)
	}
	if f.Worktree != "M" {
		t.Errorf("worktree edit lost: worktree=%q, want M", f.Worktree)
	}
}

// TestService_FileHunks_StageOneOfTwo is the crux: a file with two separate
// hunks, staging only the second must move that hunk into the index and leave
// the first untouched. Proves single-hunk selection applies against the live
// index and that NewStart anchors each hunk correctly.
func TestService_FileHunks_StageOneOfTwo(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	// 20 lines; edits at line 2 and line 19 sit far enough apart (well past
	// 2x the 3-line context) that git emits two separate hunks.
	var base, edited strings.Builder
	for i := 1; i <= 20; i++ {
		fmt.Fprintf(&base, "%d\n", i)
		switch i {
		case 2:
			edited.WriteString("TWO\n")
		case 19:
			edited.WriteString("NINETEEN\n")
		default:
			fmt.Fprintf(&edited, "%d\n", i)
		}
	}
	writeFile(t, dir, "nums.txt", base.String())
	svc := NewService()
	if err := svc.Stage(ctx(), dir, []string{"nums.txt"}); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "commit", "-m", "add nums")
	writeFile(t, dir, "nums.txt", edited.String())

	fh, err := svc.FileHunks(ctx(), dir, "nums.txt", false)
	if err != nil {
		t.Fatalf("FileHunks() error = %v", err)
	}
	if len(fh.Hunks) != 2 {
		t.Fatalf("hunks = %d, want 2 (%+v)", len(fh.Hunks), fh.Hunks)
	}
	if fh.Hunks[0].NewStart != 1 {
		t.Errorf("hunk[0].NewStart = %d, want 1", fh.Hunks[0].NewStart)
	}
	if fh.Hunks[1].NewStart != 16 {
		t.Errorf("hunk[1].NewStart = %d, want 16", fh.Hunks[1].NewStart)
	}

	// Stage only the second hunk (NINETEEN), not the first (TWO).
	if err := svc.ApplyPatch(ctx(), dir, fh.Hunks[1].Patch, false); err != nil {
		t.Fatalf("ApplyPatch() error = %v", err)
	}

	index, err := svc.FileAtRev(ctx(), dir, ":0", "nums.txt")
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(base.String(), "19\n", "NINETEEN\n", 1) // only line 19 staged
	if index.Content != want {
		t.Errorf("index content = %q, want %q", index.Content, want)
	}
}

// TestService_FileHunks_DeletionHunk covers a hunk that only removes lines
// (new-side count 0): it must parse, anchor at the surviving line, and stage.
func TestService_FileHunks_DeletionHunk(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "d.txt", "keep1\ndrop\nkeep2\n")
	svc := NewService()
	if err := svc.Stage(ctx(), dir, []string{"d.txt"}); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "commit", "-m", "add d")
	writeFile(t, dir, "d.txt", "keep1\nkeep2\n") // drop the middle line

	fh, err := svc.FileHunks(ctx(), dir, "d.txt", false)
	if err != nil {
		t.Fatalf("FileHunks() error = %v", err)
	}
	if len(fh.Hunks) != 1 {
		t.Fatalf("hunks = %d, want 1 (%+v)", len(fh.Hunks), fh.Hunks)
	}
	if err := svc.ApplyPatch(ctx(), dir, fh.Hunks[0].Patch, false); err != nil {
		t.Fatalf("ApplyPatch() error = %v", err)
	}
	index, _ := svc.FileAtRev(ctx(), dir, ":0", "d.txt")
	if index.Content != "keep1\nkeep2\n" {
		t.Errorf("index content = %q, want deletion staged", index.Content)
	}
}

// TestService_FileHunks_BinaryHasNoHunks: a binary change yields no hunks
// (the diff view already renders a binary state) rather than crashing.
func TestService_FileHunks_BinaryHasNoHunks(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "b.bin"), []byte{0, 1, 2, 3}, 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", "b.bin")
	gitCmd(t, dir, "commit", "-m", "add bin")
	if err := os.WriteFile(filepath.Join(dir, "b.bin"), []byte{0, 9, 9, 9}, 0o644); err != nil {
		t.Fatal(err)
	}
	svc := NewService()

	fh, err := svc.FileHunks(ctx(), dir, "b.bin", false)
	if err != nil {
		t.Fatalf("FileHunks(binary) error = %v", err)
	}
	if len(fh.Hunks) != 0 {
		t.Errorf("hunks = %d, want 0 for a binary change", len(fh.Hunks))
	}
}

// TestService_FileHunks_NoChangesEmpty: a clean file has no hunks and never
// returns a nil slice (stable JSON for the bindings).
func TestService_FileHunks_NoChangesEmpty(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	svc := NewService()

	fh, err := svc.FileHunks(ctx(), dir, "README.md", false)
	if err != nil {
		t.Fatalf("FileHunks() error = %v", err)
	}
	if fh.Hunks == nil || len(fh.Hunks) != 0 {
		t.Errorf("Hunks = %#v, want empty non-nil slice", fh.Hunks)
	}
}

func TestService_FileHunks_PinsApplyableDiffOutput(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	svc := NewService()
	writeFile(t, dir, "README.md", "1\n2\n3\n4\n5\n")
	if err := svc.Stage(ctx(), dir, []string{"README.md"}); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "commit", "-m", "expand readme")
	gitCmd(t, dir, "config", "diff.context", "0")
	gitCmd(t, dir, "config", "diff.noprefix", "true")
	writeFile(t, dir, "README.md", "1\n2\nTHREE\n4\n5\n")

	fh, err := svc.FileHunks(ctx(), dir, "README.md", false)
	if err != nil {
		t.Fatalf("FileHunks() error = %v", err)
	}
	if len(fh.Hunks) != 1 {
		t.Fatalf("hunks = %d, want 1 (%+v)", len(fh.Hunks), fh.Hunks)
	}
	if !strings.Contains(fh.Hunks[0].Patch, "diff --git a/README.md b/README.md") {
		t.Fatalf("patch did not keep default prefixes:\n%s", fh.Hunks[0].Patch)
	}
	if !strings.Contains(fh.Hunks[0].Patch, "@@ -1,5 +1,5 @@") {
		t.Fatalf("patch did not override zero-context config:\n%s", fh.Hunks[0].Patch)
	}
	if err := svc.ApplyPatch(ctx(), dir, fh.Hunks[0].Patch, false); err != nil {
		t.Fatalf("ApplyPatch() error = %v", err)
	}
}

// TestService_ApplyPatch_RejectsNonPatch guards the bindings boundary: junk
// never reaches `git apply`.
func TestService_ApplyPatch_RejectsNonPatch(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	svc := NewService()

	if err := svc.ApplyPatch(ctx(), dir, "rm -rf /\n", false); err == nil {
		t.Error("ApplyPatch() accepted non-patch input, want rejection")
	}
}

// TestService_FileHunks_RejectsTraversalPath: path validation matches the rest
// of the service — no absolute or escaping paths reach a git argv.
func TestService_FileHunks_RejectsTraversalPath(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	svc := NewService()

	if _, err := svc.FileHunks(ctx(), dir, "../escape.txt", false); err == nil {
		t.Error("FileHunks() accepted traversal path, want rejection")
	}
}

func findFile(files []FileChange, path string) *FileChange {
	for i := range files {
		if files[i].Path == path {
			return &files[i]
		}
	}
	return nil
}

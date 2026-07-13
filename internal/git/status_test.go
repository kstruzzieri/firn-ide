package git

import (
	"reflect"
	"strings"
	"testing"
)

// z joins porcelain v2 records with the NUL terminator produced by
// `git status --porcelain=v2 --branch -z`.
func z(records ...string) []byte {
	if len(records) == 0 {
		return nil
	}
	return []byte(strings.Join(records, "\x00") + "\x00")
}

func TestParsePorcelainV2_BranchHeaders(t *testing.T) {
	out := z(
		"# branch.oid 4c8b2a1f00000000000000000000000000000000",
		"# branch.head feature/git-integration",
		"# branch.upstream origin/feature/git-integration",
		"# branch.ab +2 -1",
	)

	got := parsePorcelainV2(out)

	if got.Branch != "feature/git-integration" {
		t.Errorf("Branch = %q, want %q", got.Branch, "feature/git-integration")
	}
	if got.Upstream != "origin/feature/git-integration" {
		t.Errorf("Upstream = %q, want %q", got.Upstream, "origin/feature/git-integration")
	}
	if got.Ahead != 2 || got.Behind != 1 {
		t.Errorf("Ahead/Behind = %d/%d, want 2/1", got.Ahead, got.Behind)
	}
	if len(got.Files) != 0 {
		t.Errorf("Files = %v, want empty", got.Files)
	}
}

func TestParsePorcelainV2_NoUpstream(t *testing.T) {
	out := z(
		"# branch.oid 4c8b2a1f00000000000000000000000000000000",
		"# branch.head main",
	)

	got := parsePorcelainV2(out)

	if got.Branch != "main" {
		t.Errorf("Branch = %q, want %q", got.Branch, "main")
	}
	if got.Upstream != "" || got.Ahead != 0 || got.Behind != 0 {
		t.Errorf("Upstream/Ahead/Behind = %q/%d/%d, want empty/0/0",
			got.Upstream, got.Ahead, got.Behind)
	}
}

func TestParsePorcelainV2_DetachedHead(t *testing.T) {
	out := z(
		"# branch.oid 4c8b2a1f00000000000000000000000000000000",
		"# branch.head (detached)",
	)

	got := parsePorcelainV2(out)

	if got.Branch != "(detached)" {
		t.Errorf("Branch = %q, want %q", got.Branch, "(detached)")
	}
}

func TestParsePorcelainV2_ChangedEntries(t *testing.T) {
	tests := []struct {
		name   string
		record string
		want   FileChange
	}{
		{
			name:   "staged modified",
			record: "1 M. N... 100644 100644 100644 aaaa bbbb internal/git/git.go",
			want:   FileChange{Path: "internal/git/git.go", Index: "M", Worktree: "."},
		},
		{
			name:   "unstaged modified",
			record: "1 .M N... 100644 100644 100644 aaaa bbbb app.go",
			want:   FileChange{Path: "app.go", Index: ".", Worktree: "M"},
		},
		{
			name:   "staged added",
			record: "1 A. N... 000000 100644 100644 0000 eeee newfile.ts",
			want:   FileChange{Path: "newfile.ts", Index: "A", Worktree: "."},
		},
		{
			name:   "staged deleted",
			record: "1 D. N... 100644 000000 000000 aaaa 0000 gone.go",
			want:   FileChange{Path: "gone.go", Index: "D", Worktree: "."},
		},
		{
			name:   "worktree deleted",
			record: "1 .D N... 100644 100644 000000 aaaa aaaa gone2.go",
			want:   FileChange{Path: "gone2.go", Index: ".", Worktree: "D"},
		},
		{
			name:   "path with spaces",
			record: "1 .M N... 100644 100644 100644 aaaa bbbb docs/my notes file.md",
			want:   FileChange{Path: "docs/my notes file.md", Index: ".", Worktree: "M"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parsePorcelainV2(z("# branch.head main", tt.record))
			if len(got.Files) != 1 {
				t.Fatalf("len(Files) = %d, want 1", len(got.Files))
			}
			if !reflect.DeepEqual(got.Files[0], tt.want) {
				t.Errorf("Files[0] = %+v, want %+v", got.Files[0], tt.want)
			}
		})
	}
}

func TestParsePorcelainV2_RenamedEntry(t *testing.T) {
	// Rename records carry the original path as a second NUL-separated field.
	out := z(
		"# branch.head main",
		"2 R. N... 100644 100644 100644 aaaa aaaa R100 new/name.go",
		"old/name.go",
	)

	got := parsePorcelainV2(out)

	want := FileChange{Path: "new/name.go", OrigPath: "old/name.go", Index: "R", Worktree: "."}
	if len(got.Files) != 1 {
		t.Fatalf("len(Files) = %d, want 1: %+v", len(got.Files), got.Files)
	}
	if !reflect.DeepEqual(got.Files[0], want) {
		t.Errorf("Files[0] = %+v, want %+v", got.Files[0], want)
	}
}

func TestParsePorcelainV2_UntrackedEntry(t *testing.T) {
	out := z("# branch.head main", "? scratch.txt")

	got := parsePorcelainV2(out)

	want := FileChange{Path: "scratch.txt", Index: "?", Worktree: "?"}
	if len(got.Files) != 1 || !reflect.DeepEqual(got.Files[0], want) {
		t.Errorf("Files = %+v, want [%+v]", got.Files, want)
	}
}

func TestParsePorcelainV2_UnmergedEntry(t *testing.T) {
	out := z(
		"# branch.head main",
		"u UU N... 100644 100644 100644 100644 h1 h2 h3 conflicted.go",
	)

	got := parsePorcelainV2(out)

	want := FileChange{Path: "conflicted.go", Index: "U", Worktree: "U", Unmerged: true}
	if len(got.Files) != 1 || !reflect.DeepEqual(got.Files[0], want) {
		t.Errorf("Files = %+v, want [%+v]", got.Files, want)
	}
}

func TestParsePorcelainV2_IgnoredAndUnknownRecordsSkipped(t *testing.T) {
	out := z(
		"# branch.head main",
		"! build/output.bin",
		"x future-record-type stuff",
	)

	got := parsePorcelainV2(out)

	if len(got.Files) != 0 {
		t.Errorf("Files = %+v, want empty (ignored/unknown records skipped)", got.Files)
	}
}

func TestParsePorcelainV2_EmptyOutput(t *testing.T) {
	got := parsePorcelainV2(nil)

	if got.Branch != "" || len(got.Files) != 0 {
		t.Errorf("got %+v, want zero-value status", got)
	}
}

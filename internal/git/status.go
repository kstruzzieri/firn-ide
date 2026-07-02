// Package git shells out to the user's installed git binary to provide
// repository status and basic operations for the IDE. Parsing targets the
// stable `--porcelain=v2 -z` formats so output is locale- and config-proof.
package git

import (
	"bytes"
	"fmt"
	"strings"
)

// FileChange is one changed path from `git status`. Index and Worktree hold
// the raw porcelain XY status letters ("M", "A", "D", "R", "?", "."); the
// frontend owns classification into staged/unstaged/untracked buckets.
type FileChange struct {
	Path     string `json:"path"`
	OrigPath string `json:"origPath,omitempty"`
	Index    string `json:"index"`
	Worktree string `json:"worktree"`
	Unmerged bool   `json:"unmerged,omitempty"`
}

// RepoStatus is a snapshot of a repository's state. Paths in Files are
// relative to RepoRoot (porcelain paths are repo-root-relative even when
// status runs in a subdirectory, e.g. a workspace inside a monorepo).
type RepoStatus struct {
	IsRepo   bool         `json:"isRepo"`
	RepoRoot string       `json:"repoRoot"`
	Branch   string       `json:"branch"`
	Upstream string       `json:"upstream"`
	Ahead    int          `json:"ahead"`
	Behind   int          `json:"behind"`
	Files    []FileChange `json:"files"`
}

// parsePorcelainV2 parses `git status --porcelain=v2 --branch -z` output.
// Records are NUL-terminated; rename records ("2") are followed by one extra
// NUL-separated field holding the original path.
func parsePorcelainV2(out []byte) RepoStatus {
	status := RepoStatus{Files: []FileChange{}}

	records := bytes.Split(out, []byte{0})
	for i := 0; i < len(records); i++ {
		rec := string(records[i])
		if rec == "" {
			continue
		}
		switch rec[0] {
		case '#':
			parseBranchHeader(rec, &status)
		case '1':
			if fc, ok := parseChanged(rec); ok {
				status.Files = append(status.Files, fc)
			}
		case '2':
			fc, ok := parseChanged(rec)
			if !ok {
				continue
			}
			// Renamed/copied: next NUL field is the original path.
			if i+1 < len(records) {
				i++
				fc.OrigPath = string(records[i])
			}
			status.Files = append(status.Files, fc)
		case 'u':
			if fields := strings.SplitN(rec, " ", 11); len(fields) == 11 {
				status.Files = append(status.Files, FileChange{
					Path:     fields[10],
					Index:    string(fields[1][0]),
					Worktree: string(fields[1][1]),
					Unmerged: true,
				})
			}
		case '?':
			if len(rec) > 2 {
				status.Files = append(status.Files, FileChange{
					Path:     rec[2:],
					Index:    "?",
					Worktree: "?",
				})
			}
		default:
			// "!" (ignored) and future record types are skipped.
		}
	}
	return status
}

func parseBranchHeader(rec string, status *RepoStatus) {
	fields := strings.Fields(rec)
	if len(fields) < 3 {
		return
	}
	switch fields[1] {
	case "branch.head":
		status.Branch = fields[2]
	case "branch.upstream":
		status.Upstream = fields[2]
	case "branch.ab":
		if len(fields) == 4 {
			fmt.Sscanf(fields[2], "+%d", &status.Ahead)
			fmt.Sscanf(fields[3], "-%d", &status.Behind)
		}
	}
}

// parseChanged parses "1" and "2" records. Both share the first 8 fields;
// "2" records carry an extra rename-score field before the path.
func parseChanged(rec string) (FileChange, bool) {
	pathField := 9
	if rec[0] == '2' {
		pathField = 10
	}
	fields := strings.SplitN(rec, " ", pathField)
	if len(fields) != pathField || len(fields[1]) != 2 {
		return FileChange{}, false
	}
	return FileChange{
		Path:     fields[pathField-1],
		Index:    string(fields[1][0]),
		Worktree: string(fields[1][1]),
	}, true
}

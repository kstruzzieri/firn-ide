package git

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
)

// validateRepoRelPaths guards the bindings boundary: the frontend only ever
// sends repo-root-relative paths from porcelain output, so anything empty,
// absolute, or escaping the root is a bug or tampering — reject before it
// reaches a git argv. ".." is only traversal as a whole segment; filenames
// containing dots ("weird..name.txt") are legal.
func validateRepoRelPaths(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("no paths given")
	}
	for _, p := range paths {
		if p == "" {
			return fmt.Errorf("empty path")
		}
		if filepath.IsAbs(p) || strings.HasPrefix(p, "/") || strings.HasPrefix(p, "\\") {
			return fmt.Errorf("absolute path not allowed: %s", p)
		}
		segs := strings.FieldsFunc(p, func(r rune) bool { return r == '/' || r == '\\' })
		if slices.Contains(segs, "..") {
			return fmt.Errorf("path traversal not allowed: %s", p)
		}
	}
	return nil
}

// validRevs is the closed set of revisions the diff UI uses. The bindings
// boundary never needs arbitrary revspecs, so none are accepted.
var validRevs = map[string]bool{"HEAD": true, ":0": true}

func validateRev(rev string) error {
	if !validRevs[rev] {
		return fmt.Errorf("unsupported revision %q (allowed: HEAD, :0)", rev)
	}
	return nil
}

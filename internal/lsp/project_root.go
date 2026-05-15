package lsp

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ErrPathOutsideWorkspace is returned when a file path resolves to a location
// outside the active workspace root after cleaning. Callers should treat this
// as a guard against `..` escapes and refuse to start a language server for
// the file.
var ErrPathOutsideWorkspace = errors.New("path outside workspace root")

// ResolveProjectRoot walks upward from filePath's containing directory toward
// workspaceRoot, returning the absolute path of the nearest directory that
// contains any of the given markers. If no marker is found within the
// workspace boundary, workspaceRoot itself is returned.
//
// markers is searched in slice order at each directory: when multiple markers
// coexist in the same directory the first one in the slice wins. This only
// affects determinism — the resolved root is the same directory either way.
//
// Returns ErrPathOutsideWorkspace if filePath resolves outside workspaceRoot
// after cleaning. Symlinks are not evaluated in this first cut; callers that
// need symlink-aware policy should resolve before calling.
//
// markers may be empty, in which case workspaceRoot is returned without
// walking. This makes the helper safe to call for language families that do
// not yet have project-root detection wired in.
func ResolveProjectRoot(filePath, workspaceRoot string, markers []string) (string, error) {
	if workspaceRoot == "" {
		return "", errors.New("workspaceRoot is empty")
	}
	if filePath == "" {
		return "", errors.New("filePath is empty")
	}

	absWorkspace, err := absClean(workspaceRoot)
	if err != nil {
		return "", fmt.Errorf("clean workspaceRoot: %w", err)
	}
	absFile, err := absClean(filePath)
	if err != nil {
		return "", fmt.Errorf("clean filePath: %w", err)
	}

	if !pathContains(absWorkspace, absFile) {
		return "", ErrPathOutsideWorkspace
	}

	if len(markers) == 0 {
		return absWorkspace, nil
	}

	for dir := filepath.Dir(absFile); ; {
		for _, marker := range markers {
			if fileExists(filepath.Join(dir, marker)) {
				return dir, nil
			}
		}

		if dir == absWorkspace {
			return absWorkspace, nil
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return absWorkspace, nil
		}
		dir = parent
	}
}

// absClean returns an absolute, lexically cleaned path.
func absClean(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

// pathContains reports whether child is at or below parent. Both paths must be
// absolute and cleaned. Uses a separator-suffixed prefix check so that
// `/foo/bar` is not treated as a child of `/foo/ba`.
func pathContains(parent, child string) bool {
	if parent == child {
		return true
	}
	sep := string(filepath.Separator)
	parentWithSep := parent
	if !strings.HasSuffix(parentWithSep, sep) {
		parentWithSep += sep
	}
	return strings.HasPrefix(child, parentWithSep)
}

// fileExists reports whether the given path exists as a regular file.
// Stat errors other than NotExist (e.g. permission denied) are treated as
// "not present" so marker probing during the walk never aborts the resolution.
func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

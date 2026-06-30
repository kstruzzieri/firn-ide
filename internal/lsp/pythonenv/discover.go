package pythonenv

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Runner executes a command in projectRoot and returns trimmed stdout.
// Injected so DiscoverInterpreter stays testable without real uv/poetry.
type Runner func(ctx context.Context, name string, args ...string) (string, error)

// DiscoverInterpreter runs uv/poetry to locate the project interpreter, but
// only when the matching lockfile/config marker is present. Returns ok=false
// when no marker is present, the tool fails, or the result is not a real
// executable. source is "uv" or "poetry".
func DiscoverInterpreter(ctx context.Context, projectRoot string, run Runner) (string, string, bool) {
	if projectRoot == "" || run == nil {
		return "", "", false
	}
	if hasUVMarker(projectRoot) {
		if out, err := run(ctx, "uv", "python", "find", "--directory", projectRoot); err == nil {
			if p := validInterpreter(strings.TrimSpace(out)); p != "" {
				return p, "uv", true
			}
		}
	}
	if hasPoetryMarker(projectRoot) {
		if out, err := run(ctx, "poetry", "env", "info", "-p", "--directory", projectRoot); err == nil {
			if p := interpreterUnderEnvRoot(strings.TrimSpace(out)); p != "" {
				return p, "poetry", true
			}
		}
	}
	return "", "", false
}

func hasUVMarker(root string) bool {
	if fileExists(filepath.Join(root, "uv.lock")) {
		return true
	}
	return pyprojectHasTable(root, "tool.uv")
}

func hasPoetryMarker(root string) bool {
	if fileExists(filepath.Join(root, "poetry.lock")) {
		return true
	}
	return pyprojectHasTable(root, "tool.poetry")
}

func pyprojectHasTable(root, table string) bool {
	b, err := os.ReadFile(filepath.Join(root, "pyproject.toml"))
	if err != nil {
		return false
	}
	return strings.Contains(string(b), "["+table+"]")
}

// interpreterUnderEnvRoot turns a poetry env root into its python executable.
func interpreterUnderEnvRoot(envRoot string) string {
	if envRoot == "" {
		return ""
	}
	rel := filepath.Join("bin", "python")
	if runtime.GOOS == "windows" {
		rel = filepath.Join("Scripts", "python.exe")
	}
	return validInterpreter(filepath.Join(envRoot, rel))
}

func validInterpreter(p string) string {
	if p == "" {
		return ""
	}
	if info, err := os.Stat(p); err == nil && !info.IsDir() {
		return p
	}
	return ""
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

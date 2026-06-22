// Package pythonenv resolves the Python analysis environment (interpreter,
// extra paths, version) for a project root WITHOUT executing any tool. It only
// stats/reads the filesystem and resolves executable names via an injected
// LookPath, so it is pure and deterministic in tests.
package pythonenv

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

// Env is the detected Python analysis environment for a project root.
type Env struct {
	InterpreterPath string   // venv/system interpreter; the primary lever for pyright
	VenvDir         string   // venv root (e.g. <root>/.venv); empty for system/none
	ExtraPaths      []string // e.g. ["src"]; empty when project config already declares extraPaths
	PythonVersion   string   // fallback only; set when no interpreter resolves and requires-python is known
	Source          string   // "VIRTUAL_ENV" | ".venv" | "venv" | "pyenv" | "system" | "none"
	Confidence      string   // "high" | "low"
	Diagnostics     []string // machine-readable detector notes (not user-facing prose)
}

// Deps are the injected, side-effect-bearing operations Detect needs.
// Injection keeps Detect deterministic and hermetic in tests.
type Deps struct {
	Getenv   func(string) string
	Stat     func(string) (os.FileInfo, error)
	ReadFile func(string) ([]byte, error)
	ReadDir  func(string) ([]os.DirEntry, error)
	LookPath func(string) (string, error) // resolves/stat-checks executables; never executes them
}

// OSDeps returns Deps backed by the real OS. It never executes Python or any tool.
func OSDeps() Deps {
	return Deps{
		Getenv:   os.Getenv,
		Stat:     os.Stat,
		ReadFile: os.ReadFile,
		ReadDir:  os.ReadDir,
		LookPath: exec.LookPath,
	}
}

// Detect resolves the analysis environment for projectRoot.
func Detect(projectRoot string, deps Deps) Env {
	env := Env{Source: "none", Confidence: "low"}

	// 1. Project-local venv (in-root VIRTUAL_ENV -> .venv -> venv).
	if dir, source := resolveVenvDir(projectRoot, deps); dir != "" {
		if interp, ok := interpreterInVenv(dir, deps); ok {
			env.InterpreterPath = interp
			env.VenvDir = dir
			env.Source = source
			env.Confidence = "high"
		} else {
			env.Diagnostics = append(env.Diagnostics, "venv_without_interpreter:"+dir)
		}
	}

	// 2. pyenv (.python-version) - only if a matching interpreter can be stat-checked.
	if env.InterpreterPath == "" {
		if interp, ok := resolvePyenv(projectRoot, deps); ok {
			env.InterpreterPath = interp
			env.Source = "pyenv"
			env.Confidence = "high"
		}
	}

	// 3. System python on PATH (low confidence; may not match the project).
	if env.InterpreterPath == "" {
		if sys, ok := lookupSystemPython(deps); ok {
			env.InterpreterPath = sys
			env.Source = "system"
			env.Confidence = "low"
		}
	}

	// 4. extraPaths: inject "src" only when no project config already declares it.
	if !projectConfigDeclaresExtraPaths(projectRoot, deps) && srcLayoutPresent(projectRoot, deps) {
		env.ExtraPaths = []string{"src"}
	}

	// 5. pythonVersion fallback when no interpreter resolved.
	if env.InterpreterPath == "" {
		env.Source = "none"
		env.PythonVersion = requiresPythonVersion(projectRoot, deps)
	}

	return env
}

// resolveVenvDir returns the project-local venv directory and its source.
// In-root VIRTUAL_ENV beats .venv beats venv. An out-of-root VIRTUAL_ENV is
// ignored: an unrelated active venv must not silently miswire the workspace.
func resolveVenvDir(projectRoot string, deps Deps) (string, string) {
	if active := deps.Getenv("VIRTUAL_ENV"); active != "" && pathInside(projectRoot, active) && isDir(active, deps) {
		return active, "VIRTUAL_ENV"
	}
	if projectRoot != "" {
		if d := filepath.Join(projectRoot, ".venv"); isDir(d, deps) {
			return d, ".venv"
		}
		if d := filepath.Join(projectRoot, "venv"); isDir(d, deps) {
			return d, "venv"
		}
	}
	return "", ""
}

func interpreterInVenv(venv string, deps Deps) (string, bool) {
	for _, rel := range venvInterpreterRelPaths() {
		candidate := filepath.Join(venv, rel)
		if isFile(candidate, deps) {
			return candidate, true
		}
	}
	return "", false
}

func venvInterpreterRelPaths() []string {
	if runtime.GOOS == "windows" {
		return []string{
			filepath.Join("Scripts", "python.exe"),
			filepath.Join("Scripts", "python3.exe"),
		}
	}
	return []string{
		filepath.Join("bin", "python"),
		filepath.Join("bin", "python3"),
	}
}

func lookupSystemPython(deps Deps) (string, bool) {
	for _, name := range []string{"python3", "python"} {
		if p, err := deps.LookPath(name); err == nil && p != "" {
			return p, true
		}
	}
	return "", false
}

// resolvePyenv resolves an interpreter from .python-version, but only if it can
// be located on disk via PYENV_ROOT / HOME without executing pyenv.
func resolvePyenv(projectRoot string, deps Deps) (string, bool) {
	ver := readPythonVersionFile(projectRoot, deps)
	if ver == "" {
		return "", false
	}
	root := deps.Getenv("PYENV_ROOT")
	if root == "" {
		home := deps.Getenv("HOME")
		if home == "" {
			home = deps.Getenv("USERPROFILE")
		}
		if home == "" {
			return "", false
		}
		root = filepath.Join(home, ".pyenv")
	}
	interp := filepath.Join(root, "versions", ver, "bin", "python")
	if runtime.GOOS == "windows" {
		interp = filepath.Join(root, "versions", ver, "python.exe")
	}
	if isFile(interp, deps) {
		return interp, true
	}
	return "", false
}

func readPythonVersionFile(projectRoot string, deps Deps) string {
	if projectRoot == "" {
		return ""
	}
	data, err := deps.ReadFile(filepath.Join(projectRoot, ".python-version"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if line = strings.TrimSpace(line); line != "" && !strings.HasPrefix(line, "#") {
			return line
		}
	}
	return ""
}

func srcLayoutPresent(projectRoot string, deps Deps) bool {
	if projectRoot == "" {
		return false
	}
	srcDir := filepath.Join(projectRoot, "src")
	if !isDir(srcDir, deps) {
		return false
	}
	entries, err := deps.ReadDir(srcDir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".py") {
			return true
		}
	}
	return false
}

func projectConfigDeclaresExtraPaths(projectRoot string, deps Deps) bool {
	if projectRoot == "" {
		return false
	}
	if data, err := deps.ReadFile(filepath.Join(projectRoot, "pyrightconfig.json")); err == nil {
		var cfg map[string]json.RawMessage
		if json.Unmarshal(data, &cfg) == nil {
			if _, ok := cfg["extraPaths"]; ok {
				return true
			}
		}
	}
	if data, err := deps.ReadFile(filepath.Join(projectRoot, "pyproject.toml")); err == nil {
		if tomlSectionHasKey(string(data), "tool.pyright", "extraPaths") {
			return true
		}
	}
	return false
}

// tomlSectionHasKey reports whether the named TOML table (e.g. "tool.pyright")
// contains the given key. Heuristic scan: adequate for detecting that a user
// already declared a key, but not a full TOML parser (no TOML dep in the module).
func tomlSectionHasKey(content, section, key string) bool {
	inSection := false
	header := "[" + section + "]"
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") {
			inSection = trimmed == header ||
				(strings.HasPrefix(trimmed, header) &&
					(trimmed[len(header)] == ' ' || trimmed[len(header)] == '\t' || trimmed[len(header)] == '#'))
			continue
		}
		if inSection {
			if eq := strings.Index(trimmed, "="); eq > 0 {
				if strings.TrimSpace(trimmed[:eq]) == key {
					return true
				}
			}
		}
	}
	return false
}

var requiresPythonRe = regexp.MustCompile(`[><=!~^]+\s*(\d+\.\d+)`)

func requiresPythonVersion(projectRoot string, deps Deps) string {
	if projectRoot == "" {
		return ""
	}
	data, err := deps.ReadFile(filepath.Join(projectRoot, "pyproject.toml"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "requires-python") {
			if m := requiresPythonRe.FindStringSubmatch(line); m != nil {
				return m[1]
			}
		}
	}
	return ""
}

func pathInside(root, p string) bool {
	if root == "" || p == "" {
		return false
	}
	root = filepath.Clean(root)
	p = filepath.Clean(p)
	if p == root {
		return true
	}
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func isDir(path string, deps Deps) bool {
	info, err := deps.Stat(path)
	return err == nil && info.IsDir()
}

func isFile(path string, deps Deps) bool {
	info, err := deps.Stat(path)
	return err == nil && !info.IsDir()
}

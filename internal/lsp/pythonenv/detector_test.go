package pythonenv_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"firn/internal/lsp/pythonenv"
)

// depsWith builds Deps backed by the real filesystem but with deterministic
// Getenv and LookPath, so no host environment or installed Python leaks in.
func depsWith(env map[string]string, lookPath func(string) (string, error)) pythonenv.Deps {
	d := pythonenv.OSDeps()
	d.Getenv = func(k string) string { return env[k] }
	if lookPath != nil {
		d.LookPath = lookPath
	}
	return d
}

func noPython(string) (string, error) { return "", os.ErrNotExist }

func writeFakeInterpreter(t *testing.T, venvDir string) {
	t.Helper()
	rel := filepath.Join("bin", "python")
	if runtime.GOOS == "windows" {
		rel = filepath.Join("Scripts", "python.exe")
	}
	full := filepath.Join(venvDir, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestDetect_DotVenvPreferred(t *testing.T) {
	root := t.TempDir()
	venv := filepath.Join(root, ".venv")
	writeFakeInterpreter(t, venv)

	env := pythonenv.Detect(root, depsWith(nil, noPython))

	if env.Source != ".venv" {
		t.Fatalf("Source = %q, want .venv", env.Source)
	}
	if env.VenvDir != venv {
		t.Errorf("VenvDir = %q, want %q", env.VenvDir, venv)
	}
	if env.InterpreterPath == "" {
		t.Error("InterpreterPath empty, want venv interpreter")
	}
	if env.Confidence != "high" {
		t.Errorf("Confidence = %q, want high", env.Confidence)
	}
}

func TestDetect_VenvFallbackWhenNoDotVenv(t *testing.T) {
	root := t.TempDir()
	venv := filepath.Join(root, "venv")
	writeFakeInterpreter(t, venv)

	env := pythonenv.Detect(root, depsWith(nil, noPython))

	if env.Source != "venv" {
		t.Fatalf("Source = %q, want venv", env.Source)
	}
}

func TestDetect_BrokenDotVenvRecordsDiagnostic(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".venv"), 0o755); err != nil {
		t.Fatal(err)
	}

	env := pythonenv.Detect(root, depsWith(nil, noPython))

	if env.Source != "none" {
		t.Fatalf("Source = %q, want none when .venv has no interpreter", env.Source)
	}
	if len(env.Diagnostics) == 0 || !strings.HasPrefix(env.Diagnostics[0], "venv_without_interpreter:") {
		t.Fatalf("Diagnostics = %v, want venv_without_interpreter note", env.Diagnostics)
	}
}

func TestDetect_OutOfRootVirtualEnvDoesNotBeatDotVenv(t *testing.T) {
	root := t.TempDir()
	dotVenv := filepath.Join(root, ".venv")
	writeFakeInterpreter(t, dotVenv)

	outside := t.TempDir() // a different tree, simulating an unrelated active venv
	writeFakeInterpreter(t, outside)

	env := pythonenv.Detect(root, depsWith(map[string]string{"VIRTUAL_ENV": outside}, noPython))

	if env.Source != ".venv" {
		t.Fatalf("Source = %q, want .venv (out-of-root VIRTUAL_ENV must not win)", env.Source)
	}
	if env.VenvDir != dotVenv {
		t.Errorf("VenvDir = %q, want %q", env.VenvDir, dotVenv)
	}
}

func TestDetect_InRootVirtualEnvWins(t *testing.T) {
	root := t.TempDir()
	active := filepath.Join(root, ".cache-venv")
	writeFakeInterpreter(t, active)

	env := pythonenv.Detect(root, depsWith(map[string]string{"VIRTUAL_ENV": active}, noPython))

	if env.Source != "VIRTUAL_ENV" {
		t.Fatalf("Source = %q, want VIRTUAL_ENV", env.Source)
	}
	if env.VenvDir != active {
		t.Errorf("VenvDir = %q, want %q", env.VenvDir, active)
	}
}

func TestDetect_SrcLayoutInjectsExtraPaths(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src", "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	env := pythonenv.Detect(root, depsWith(nil, noPython))

	if len(env.ExtraPaths) != 1 || env.ExtraPaths[0] != "src" {
		t.Fatalf("ExtraPaths = %v, want [src]", env.ExtraPaths)
	}
}

func TestDetect_NoDoubleInjectWhenConfigDeclaresExtraPaths(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src", "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pyrightconfig.json"),
		[]byte(`{"extraPaths":["lib"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	env := pythonenv.Detect(root, depsWith(nil, noPython))

	if len(env.ExtraPaths) != 0 {
		t.Fatalf("ExtraPaths = %v, want empty (project config already declares extraPaths)", env.ExtraPaths)
	}
}

func TestDetect_NoDoubleInjectWhenPyprojectToolPyrightDeclaresExtraPaths(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src", "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pyproject.toml"),
		[]byte("[tool.pyright]\nextraPaths = [\"lib\"]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	env := pythonenv.Detect(root, depsWith(nil, noPython))

	if len(env.ExtraPaths) != 0 {
		t.Fatalf("ExtraPaths = %v, want empty ([tool.pyright] already declares extraPaths)", env.ExtraPaths)
	}
}

func TestDetect_NoInterpreterFallsBackToVersion(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "pyproject.toml"),
		[]byte("[project]\nrequires-python = \">=3.11\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	env := pythonenv.Detect(root, depsWith(nil, noPython))

	if env.Source != "none" {
		t.Fatalf("Source = %q, want none", env.Source)
	}
	if env.PythonVersion != "3.11" {
		t.Errorf("PythonVersion = %q, want 3.11", env.PythonVersion)
	}
}

func TestDetect_PyenvResolvesFromVersionFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".python-version"), []byte("3.11.2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	pyenvRoot := t.TempDir()
	interp := filepath.Join(pyenvRoot, "versions", "3.11.2", "bin", "python")
	if runtime.GOOS == "windows" {
		interp = filepath.Join(pyenvRoot, "versions", "3.11.2", "python.exe")
	}
	if err := os.MkdirAll(filepath.Dir(interp), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(interp, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	env := pythonenv.Detect(root, depsWith(map[string]string{"PYENV_ROOT": pyenvRoot}, noPython))

	if env.Source != "pyenv" {
		t.Fatalf("Source = %q, want pyenv", env.Source)
	}
	if env.Confidence != "high" {
		t.Errorf("Confidence = %q, want high", env.Confidence)
	}
	if env.InterpreterPath != interp {
		t.Errorf("InterpreterPath = %q, want %q", env.InterpreterPath, interp)
	}
}

func TestDetect_SystemFallbackIsLowConfidence(t *testing.T) {
	root := t.TempDir()
	lookPath := func(name string) (string, error) {
		if name == "python3" {
			return "/usr/bin/python3", nil
		}
		return "", os.ErrNotExist
	}
	env := pythonenv.Detect(root, depsWith(nil, lookPath))

	if env.Source != "system" {
		t.Fatalf("Source = %q, want system", env.Source)
	}
	if env.Confidence != "low" {
		t.Errorf("Confidence = %q, want low", env.Confidence)
	}
	if env.InterpreterPath != "/usr/bin/python3" {
		t.Errorf("InterpreterPath = %q, want /usr/bin/python3", env.InterpreterPath)
	}
}

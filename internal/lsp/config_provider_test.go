package lsp

import (
	"context"
	"path/filepath"
	"testing"

	"firn/internal/lsp/pythonenv"
)

func stubProvider(env pythonenv.Env) *envConfigProvider {
	return &envConfigProvider{
		detectPython: func(string, pythonenv.Deps) pythonenv.Env { return env },
		pythonDeps:   pythonenv.Deps{},
	}
}

func TestEnvConfigProvider_PythonSections(t *testing.T) {
	projectRoot := t.TempDir()
	p := stubProvider(pythonenv.Env{
		InterpreterPath: filepath.Join(projectRoot, ".venv", "bin", "python"),
		VenvDir:         filepath.Join(projectRoot, ".venv"),
		ExtraPaths:      []string{"src"},
	})

	results := p.Configuration("python", projectRoot, []ConfigurationItem{
		{Section: "python"},
		{Section: "python.analysis"},
	})

	if len(results) != 2 {
		t.Fatalf("len(results) = %d, want 2", len(results))
	}
	py, ok := results[0].(map[string]any)
	if !ok {
		t.Fatalf("results[0] type = %T, want map", results[0])
	}
	if py["pythonPath"] != filepath.Join(projectRoot, ".venv", "bin", "python") {
		t.Errorf("pythonPath = %v", py["pythonPath"])
	}
	if py["venvPath"] != projectRoot || py["venv"] != ".venv" {
		t.Errorf("venvPath/venv = %v/%v, want %s/.venv", py["venvPath"], py["venv"], projectRoot)
	}
	wholeAnalysis, ok := py["analysis"].(map[string]any)
	if !ok {
		t.Fatalf("python.analysis type = %T, want map", py["analysis"])
	}
	wantSrc := filepath.Join(projectRoot, "src")
	wholePaths, ok := wholeAnalysis["extraPaths"].([]string)
	if !ok || len(wholePaths) != 1 || wholePaths[0] != wantSrc {
		t.Errorf("whole-section extraPaths = %v, want [%s]", wholeAnalysis["extraPaths"], wantSrc)
	}
	analysis, ok := results[1].(map[string]any)
	if !ok {
		t.Fatalf("results[1] type = %T, want map", results[1])
	}
	paths, ok := analysis["extraPaths"].([]string)
	if !ok || len(paths) != 1 || paths[0] != wantSrc {
		t.Errorf("extraPaths = %v, want [%s]", analysis["extraPaths"], wantSrc)
	}
}

func TestEnvConfigProvider_DialectAnalysis(t *testing.T) {
	p := stubProvider(pythonenv.Env{ExtraPaths: []string{"src"}})

	results := p.Configuration("python", "/proj", []ConfigurationItem{
		{Section: "basedpyright.analysis"},
	})

	analysis, ok := results[0].(map[string]any)
	if !ok {
		t.Fatalf("results[0] type = %T, want map (dialect-agnostic analysis)", results[0])
	}
	if _, ok := analysis["extraPaths"]; !ok {
		t.Errorf("basedpyright.analysis missing extraPaths: %v", analysis)
	}
}

func TestEnvConfigProvider_AbsoluteExtraPathsRemainUnchanged(t *testing.T) {
	absolute := filepath.Join(t.TempDir(), "src")
	p := stubProvider(pythonenv.Env{ExtraPaths: []string{absolute}})

	results := p.Configuration("python", t.TempDir(), []ConfigurationItem{
		{Section: "basedpyright.analysis.extraPaths"},
	})

	paths, ok := results[0].([]string)
	if !ok || len(paths) != 1 || paths[0] != absolute {
		t.Fatalf("absolute extraPaths = %v, want [%s]", results[0], absolute)
	}
}

func TestEnvConfigProvider_LeafSections(t *testing.T) {
	projectRoot := t.TempDir()
	p := stubProvider(pythonenv.Env{
		InterpreterPath: filepath.Join(projectRoot, ".venv", "bin", "python"),
		VenvDir:         filepath.Join(projectRoot, ".venv"),
		ExtraPaths:      []string{"src"},
	})

	results := p.Configuration("python", projectRoot, []ConfigurationItem{
		{Section: "python.pythonPath"},
		{Section: "python.venvPath"},
		{Section: "python.venv"},
		{Section: "python.analysis.extraPaths"},
	})

	if results[0] != filepath.Join(projectRoot, ".venv", "bin", "python") {
		t.Fatalf("python.pythonPath = %v", results[0])
	}
	if results[1] != projectRoot || results[2] != ".venv" {
		t.Fatalf("venvPath/venv = %v/%v, want %s/.venv", results[1], results[2], projectRoot)
	}
	paths, ok := results[3].([]string)
	wantSrc := filepath.Join(projectRoot, "src")
	if !ok || len(paths) != 1 || paths[0] != wantSrc {
		t.Fatalf("python.analysis.extraPaths = %v, want [%s]", results[3], wantSrc)
	}
}

func TestEnvConfigProvider_NonPythonEmpty(t *testing.T) {
	p := stubProvider(pythonenv.Env{InterpreterPath: "/x"})
	results := p.Configuration("go", "/proj", []ConfigurationItem{{Section: "gopls"}})
	if len(results) != 1 || results[0] != nil {
		t.Fatalf("results = %v, want [nil] for non-python family", results)
	}
}

func TestEnvConfigProvider_EmptyPythonEnvReturnsNil(t *testing.T) {
	p := stubProvider(pythonenv.Env{})
	results := p.Configuration("python", "/proj", []ConfigurationItem{
		{Section: "python"},
		{Section: "python.analysis"},
	})
	if len(results) != 2 {
		t.Fatalf("len(results) = %d, want 2", len(results))
	}
	if results[0] != nil || results[1] != nil {
		t.Fatalf("results = %v, want [nil nil] for empty env", results)
	}
}

func TestPythonEnv_overridePreservesDetectedMetadata(t *testing.T) {
	p := newEnvConfigProvider()
	p.overrideFor = func(string) string { return "/manual/python" }
	p.detectPython = func(string, pythonenv.Deps) pythonenv.Env {
		return pythonenv.Env{
			InterpreterPath: "/auto",
			VenvDir:         "/proj/.venv",
			ExtraPaths:      []string{"src"},
			PythonVersion:   "3.11",
			Source:          ".venv",
			Confidence:      "high",
		}
	}
	env := p.PythonEnv("/whatever")
	if env.InterpreterPath != "/manual/python" || env.Source != "override" || env.Confidence != "high" {
		t.Errorf("override fields = %+v", env)
	}
	if len(env.ExtraPaths) != 1 || env.ExtraPaths[0] != "src" || env.PythonVersion != "3.11" {
		t.Errorf("detected metadata lost after override: %+v", env)
	}
	// The override interpreter lives outside the detected venv, so the venv
	// identity must be dropped: venvPath/venv would otherwise redirect the
	// server's import resolution away from the manually chosen interpreter.
	if env.VenvDir != "" {
		t.Errorf("VenvDir = %q, want empty for override outside detected venv", env.VenvDir)
	}
}

func TestPythonEnv_overrideInsideVenvKeepsVenvDir(t *testing.T) {
	p := newEnvConfigProvider()
	p.overrideFor = func(string) string { return "/proj/.venv/bin/python3" }
	p.detectPython = func(string, pythonenv.Deps) pythonenv.Env {
		return pythonenv.Env{
			InterpreterPath: "/proj/.venv/bin/python",
			VenvDir:         "/proj/.venv",
			Source:          ".venv",
			Confidence:      "high",
		}
	}
	env := p.PythonEnv("/proj")
	if env.InterpreterPath != "/proj/.venv/bin/python3" || env.Source != "override" {
		t.Errorf("override fields = %+v", env)
	}
	if env.VenvDir != "/proj/.venv" {
		t.Errorf("VenvDir = %q, want /proj/.venv kept for override inside detected venv", env.VenvDir)
	}
}

func TestPythonEnv_discoveryUpgradesLowConfidence(t *testing.T) {
	root := t.TempDir()
	interp := filepath.Join(root, ".venv", "bin", "python")
	p := newEnvConfigProvider()
	p.overrideFor = func(string) string { return "" }
	p.detectPython = func(string, pythonenv.Deps) pythonenv.Env {
		return pythonenv.Env{Source: "system", Confidence: "low", InterpreterPath: "/usr/bin/python3"}
	}
	p.discover = func(_ context.Context, r string) (string, string, bool) { return interp, "uv", true }
	env := p.PythonEnv(root)
	if env.InterpreterPath != interp || env.Source != "uv" || env.Confidence != "high" {
		t.Fatalf("env = %+v, want uv-discovered high-confidence", env)
	}
}

func TestPythonEnv_highConfidenceSkipsDiscovery(t *testing.T) {
	called := false
	p := newEnvConfigProvider()
	p.overrideFor = func(string) string { return "" }
	p.detectPython = func(string, pythonenv.Deps) pythonenv.Env {
		return pythonenv.Env{Source: ".venv", Confidence: "high", InterpreterPath: "/proj/.venv/bin/python"}
	}
	p.discover = func(context.Context, string) (string, string, bool) { called = true; return "", "", false }
	env := p.PythonEnv("/proj")
	if called {
		t.Error("discovery must not run when Detect is high-confidence")
	}
	if env.InterpreterPath != "/proj/.venv/bin/python" {
		t.Errorf("env = %+v", env)
	}
}

func TestEnvConfigProvider_DialectLeafSections(t *testing.T) {
	p := stubProvider(pythonenv.Env{
		InterpreterPath: "/proj/.venv/bin/python",
		VenvDir:         "/proj/.venv",
	})
	results := p.Configuration("python", "/proj", []ConfigurationItem{
		{Section: "basedpyright.pythonPath"},
		{Section: "pyright.venvPath"},
	})
	if results[0] != "/proj/.venv/bin/python" {
		t.Errorf("basedpyright.pythonPath = %v, want /proj/.venv/bin/python", results[0])
	}
	if results[1] != "/proj" {
		t.Errorf("pyright.venvPath = %v, want /proj (parent of venv dir)", results[1])
	}
}

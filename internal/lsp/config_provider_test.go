package lsp

import (
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
	p := stubProvider(pythonenv.Env{
		InterpreterPath: "/proj/.venv/bin/python",
		VenvDir:         "/proj/.venv",
		ExtraPaths:      []string{"src"},
	})

	results := p.Configuration("python", "/proj", []ConfigurationItem{
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
	if py["pythonPath"] != "/proj/.venv/bin/python" {
		t.Errorf("pythonPath = %v", py["pythonPath"])
	}
	if py["venvPath"] != "/proj" || py["venv"] != ".venv" {
		t.Errorf("venvPath/venv = %v/%v, want /proj/.venv", py["venvPath"], py["venv"])
	}
	analysis, ok := results[1].(map[string]any)
	if !ok {
		t.Fatalf("results[1] type = %T, want map", results[1])
	}
	paths, ok := analysis["extraPaths"].([]string)
	if !ok || len(paths) != 1 || paths[0] != "src" {
		t.Errorf("extraPaths = %v, want [src]", analysis["extraPaths"])
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

func TestEnvConfigProvider_LeafSections(t *testing.T) {
	p := stubProvider(pythonenv.Env{
		InterpreterPath: "/proj/.venv/bin/python",
		VenvDir:         "/proj/.venv",
		ExtraPaths:      []string{"src"},
	})

	results := p.Configuration("python", "/proj", []ConfigurationItem{
		{Section: "python.pythonPath"},
		{Section: "python.venvPath"},
		{Section: "python.venv"},
		{Section: "python.analysis.extraPaths"},
	})

	if results[0] != "/proj/.venv/bin/python" {
		t.Fatalf("python.pythonPath = %v", results[0])
	}
	if results[1] != "/proj" || results[2] != ".venv" {
		t.Fatalf("venvPath/venv = %v/%v, want /proj/.venv", results[1], results[2])
	}
	paths, ok := results[3].([]string)
	if !ok || len(paths) != 1 || paths[0] != "src" {
		t.Fatalf("python.analysis.extraPaths = %v, want [src]", results[3])
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

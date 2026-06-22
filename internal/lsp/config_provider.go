package lsp

import (
	"path/filepath"
	"strings"

	"firn/internal/lsp/pythonenv"
)

// WorkspaceConfigProvider answers workspace/configuration requests for a server.
// It is language-generic: the client never interprets section names or setting
// keys. Per-family translation (e.g. Python env to pyright settings) lives here.
type WorkspaceConfigProvider interface {
	// Configuration returns one entry per requested item, in the same order.
	// A nil entry tells the server to fall back to its own defaults.
	Configuration(family, projectRoot string, items []ConfigurationItem) []any
}

// envConfigProvider maps detected project environments onto language-server
// settings. Python is the only family wired in Phase 1.
type envConfigProvider struct {
	detectPython func(projectRoot string, deps pythonenv.Deps) pythonenv.Env
	pythonDeps   pythonenv.Deps
}

func newEnvConfigProvider() *envConfigProvider {
	return &envConfigProvider{
		detectPython: pythonenv.Detect,
		pythonDeps:   pythonenv.OSDeps(),
	}
}

func (p *envConfigProvider) PythonEnv(projectRoot string) pythonenv.Env {
	return p.detectPython(projectRoot, p.pythonDeps)
}

// pythonEnvReader is satisfied by envConfigProvider and any other provider that
// exposes PythonEnv. It is used by pythonEnvFromProvider to retrieve the
// environment without a second independent detect call.
type pythonEnvReader interface {
	PythonEnv(projectRoot string) pythonenv.Env
}

// envConfigProvider is the default provider; this assertion guarantees the
// pythonEnvFromProvider fast path (no re-detection) is always taken in production.
var _ pythonEnvReader = (*envConfigProvider)(nil)

// pythonEnvFromProvider retrieves the Python environment via provider if it
// implements pythonEnvReader; otherwise falls back to an independent OS-backed
// detection run. The fallback may diverge from a custom provider's view and
// exists only for providers that don't implement pythonEnvReader.
func pythonEnvFromProvider(provider WorkspaceConfigProvider, projectRoot string) pythonenv.Env {
	if p, ok := provider.(pythonEnvReader); ok {
		return p.PythonEnv(projectRoot)
	}
	return pythonenv.Detect(projectRoot, pythonenv.OSDeps())
}

func (p *envConfigProvider) Configuration(family, projectRoot string, items []ConfigurationItem) []any {
	results := make([]any, len(items))
	if family != "python" {
		return results // all nil; server uses its own defaults
	}
	env := p.PythonEnv(projectRoot)
	pythonSection, analysisSection := pythonSettingSections(env)
	// item.ScopeURI is intentionally ignored in Phase 1: the project-level env
	// detected from projectRoot applies uniformly to all files in the workspace.
	for i, item := range items {
		results[i] = settingForSection(item.Section, pythonSection, analysisSection)
	}
	return results
}

// settingForSection answers a requested config section dialect-agnostically:
// any "*.analysis" object section maps to analysis settings; the bare server
// section (python, pyright, basedpyright) maps to interpreter settings; leaf
// sections are matched by suffix so pyright.pythonPath and python.pythonPath
// behave identically — the client bakes in none of these names.
func settingForSection(section string, pythonSection, analysisSection map[string]any) any {
	switch {
	case section == "":
		return nil
	case strings.HasSuffix(section, ".analysis.extraPaths"):
		return analysisSection["extraPaths"]
	case strings.HasSuffix(section, ".analysis.pythonVersion"):
		return analysisSection["pythonVersion"]
	case strings.HasSuffix(section, ".analysis"):
		if len(analysisSection) == 0 {
			return nil
		}
		return analysisSection
	case strings.HasSuffix(section, ".defaultInterpreterPath"):
		return pythonSection["defaultInterpreterPath"]
	case strings.HasSuffix(section, ".pythonPath"):
		return pythonSection["pythonPath"]
	case strings.HasSuffix(section, ".venvPath"):
		return pythonSection["venvPath"]
	case strings.HasSuffix(section, ".venv"):
		return pythonSection["venv"]
	case section == "python" || section == "pyright" || section == "basedpyright":
		if len(pythonSection) == 0 {
			return nil
		}
		return pythonSection
	default:
		return nil
	}
}

func pythonSettingSections(env pythonenv.Env) (pythonSection, analysisSection map[string]any) {
	python := map[string]any{}
	analysis := map[string]any{}
	if env.InterpreterPath != "" {
		python["pythonPath"] = env.InterpreterPath
		python["defaultInterpreterPath"] = env.InterpreterPath
	}
	if env.VenvDir != "" {
		python["venvPath"] = filepath.Dir(env.VenvDir)
		python["venv"] = filepath.Base(env.VenvDir)
	}
	if len(env.ExtraPaths) > 0 {
		analysis["extraPaths"] = env.ExtraPaths
	}
	if env.PythonVersion != "" {
		analysis["pythonVersion"] = env.PythonVersion
	}
	// Nest analysis under the python section too, so servers that read the
	// whole "python" tree (rather than pulling "python.analysis" separately)
	// still receive extraPaths/pythonVersion.
	if len(analysis) > 0 {
		python["analysis"] = analysis
	}
	return python, analysis
}

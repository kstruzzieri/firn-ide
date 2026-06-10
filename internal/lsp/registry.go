package lsp

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// ServerConfig describes how to launch a language server for a given language family.
type ServerConfig struct {
	// LanguageFamily groups related languages under one server (e.g., "typescript" covers .ts, .tsx, .js, .jsx).
	LanguageFamily string
	// Command is the executable name.
	Command string
	// Args are the command-line arguments.
	Args []string
	// Dir is the working directory for the spawned process.
	// Language servers often resolve configs (tsconfig.json, etc.) relative to their cwd.
	Dir string
	// InitOptions, if non-nil, is sent as initializationOptions in the LSP initialize request.
	InitOptions any
}

// Registry maps file extensions and language contexts to server configurations.
type Registry struct{}

// NewRegistry creates a new language server registry.
func NewRegistry() *Registry {
	return &Registry{}
}

// langInfo pairs an LSP languageId with its server family.
type langInfo struct {
	languageID string
	family     string
}

// extensionMap is the single source of truth for extension → language/family mapping.
var extensionMap = map[string]langInfo{
	".ts":  {"typescript", "typescript"},
	".tsx": {"typescriptreact", "typescript"},
	".js":  {"javascript", "typescript"},
	".jsx": {"javascriptreact", "typescript"},
	".mts": {"typescript", "typescript"},
	".cts": {"typescript", "typescript"},
	".mjs": {"javascript", "typescript"},
	".cjs": {"javascript", "typescript"},
	".go":  {"go", "go"},
	".py":  {"python", "python"},
	".pyw": {"python", "python"},
	".pyi": {"python", "python"},
}

// LanguageIDForExtension returns the LSP languageId for the given file extension.
// Returns empty string if the extension is not recognized.
func (r *Registry) LanguageIDForExtension(ext string) string {
	if info, ok := extensionMap[strings.ToLower(ext)]; ok {
		return info.languageID
	}
	return ""
}

// FamilyForExtension returns the server family for the given file extension.
// Returns empty string if the extension is not recognized.
func (r *Registry) FamilyForExtension(ext string) string {
	if info, ok := extensionMap[strings.ToLower(ext)]; ok {
		return info.family
	}
	return ""
}

// ServerConfigFor returns the server configuration for a given language
// family and project root. The project root is whatever the caller has
// resolved for the file being opened — for TypeScript that's the nearest
// directory with tsconfig.json / jsconfig.json / package.json bounded by the
// active workspace; for Go/Python it is the nearest go.mod / Python project
// marker, falling back to the active workspace root when no marker exists.
//
// Binary lookups (e.g. node_modules/.bin/typescript-language-server) and
// local-TypeScript discovery use this project root, so monorepo packages get
// their own per-package server installation when one exists.
func (r *Registry) ServerConfigFor(family, projectRoot string) (*ServerConfig, error) {
	switch family {
	case "typescript":
		return r.resolveTypeScriptServer(projectRoot)
	case "go":
		return r.resolveGoServer(projectRoot)
	case "python":
		return r.resolvePythonServer(projectRoot)
	default:
		return nil, fmt.Errorf("no language server configured for %q", family)
	}
}

func projectLocalNodeBin(projectRoot, binary string) string {
	localBin := filepath.Join(projectRoot, "node_modules", ".bin", binary)
	if runtime.GOOS == "windows" {
		localBin += ".cmd"
	}
	return localBin
}

// resolveTypeScriptServer finds and configures typescript-language-server.
// The projectRoot argument is the detected nearest TS/JS project root, not
// necessarily the active workspace root. Lookup order:
//  1. <projectRoot>/node_modules/.bin/typescript-language-server
//  2. System PATH (with initOptions.tsserver.path pointing at any
//     <projectRoot>/node_modules/typescript/lib that exists, so the project's
//     own TypeScript version is preferred over whatever the global server
//     bundles).
func (r *Registry) resolveTypeScriptServer(projectRoot string) (*ServerConfig, error) {
	binary := "typescript-language-server"

	// 1. Check project-local node_modules/.bin/
	if path, err := exec.LookPath(projectLocalNodeBin(projectRoot, binary)); err == nil {
		return &ServerConfig{
			LanguageFamily: "typescript",
			Command:        path,
			Args:           []string{"--stdio"},
			Dir:            projectRoot,
		}, nil
	}

	// 2. Fall back to system PATH
	path, err := exec.LookPath(binary)
	if err != nil {
		return nil, fmt.Errorf(
			"typescript-language-server not found: install it with " +
				"\"npm install -g typescript-language-server typescript\" " +
				"or add it as a project dependency",
		)
	}

	args := []string{"--stdio"}

	// 3. If the project has its own TypeScript lib, point the system server at
	// it via initializationOptions.tsserver.path. This ensures the server uses
	// the project's TS version rather than whatever TypeScript the global
	// server bundles. (The --tsserver-path CLI flag was removed in
	// typescript-language-server v4+.)
	// TODO: Gate behind workspace trust when trust system is implemented.
	var initOpts any
	localTSLib := filepath.Join(projectRoot, "node_modules", "typescript", "lib")
	if _, statErr := os.Stat(filepath.Join(localTSLib, "tsserver.js")); statErr == nil {
		initOpts = map[string]any{
			"tsserver": map[string]any{
				"path": localTSLib,
			},
		}
	}

	return &ServerConfig{
		LanguageFamily: "typescript",
		Command:        path,
		Args:           args,
		Dir:            projectRoot,
		InitOptions:    initOpts,
	}, nil
}

// resolveGoServer finds and configures gopls.
// When the app is launched outside a terminal (e.g. from Finder or Dock),
// macOS does not populate PATH with shell-specific entries like $HOME/go/bin.
// We fall back to well-known Go binary directories in that case.
func (r *Registry) resolveGoServer(projectRoot string) (*ServerConfig, error) {
	path, err := exec.LookPath("gopls")
	if err != nil {
		path = findGoBinary("gopls")
		if path == "" {
			return nil, fmt.Errorf(
				"gopls not found: install it with "+
					"\"go install golang.org/x/tools/gopls@latest\" "+
					"or add it to PATH",
			)
		}
	}

	return &ServerConfig{
		LanguageFamily: "go",
		Command:        path,
		Dir:            projectRoot,
	}, nil
}

// findGoBinary searches common Go binary directories for a given binary name.
// This covers the case where the app is launched from Finder/Dock on macOS
// and the user's shell PATH (containing $HOME/go/bin, etc.) is not available.
func findGoBinary(name string) string {
	homeDir, homeErr := os.UserHomeDir()
	if homeErr != nil {
		return ""
	}

	candidates := []string{
		filepath.Join(homeDir, "go", "bin", name),
		filepath.Join(homeDir, ".local", "bin", name),
		"/usr/local/go/bin/" + name,
		"/usr/local/bin/" + name,
	}

	if runtime.GOOS == "windows" {
		candidates = []string{
			filepath.Join(homeDir, "go", "bin", name+".exe"),
			filepath.Join(homeDir, ".local", "bin", name+".exe"),
		}
	}

	for _, candidate := range candidates {
		if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
			return candidate
		}
	}

	return ""
}

// resolvePythonServer finds and configures pyright-langserver.
func (r *Registry) resolvePythonServer(projectRoot string) (*ServerConfig, error) {
	binary := "pyright-langserver"

	if path, ok := resolvePythonVirtualEnvBinary(projectRoot, binary); ok {
		return &ServerConfig{
			LanguageFamily: "python",
			Command:        path,
			Args:           []string{"--stdio"},
			Dir:            projectRoot,
		}, nil
	}

	if path, err := exec.LookPath(projectLocalNodeBin(projectRoot, binary)); err == nil {
		return &ServerConfig{
			LanguageFamily: "python",
			Command:        path,
			Args:           []string{"--stdio"},
			Dir:            projectRoot,
		}, nil
	}

	path, err := exec.LookPath(binary)
	if err != nil {
		return nil, fmt.Errorf(
			"pyright-langserver not found: install it with " +
				"\"npm install -g pyright\", add pyright as a project dependency, " +
				"or activate a virtual environment that provides pyright-langserver",
		)
	}

	return &ServerConfig{
		LanguageFamily: "python",
		Command:        path,
		Args:           []string{"--stdio"},
		Dir:            projectRoot,
	}, nil
}

func resolvePythonVirtualEnvBinary(projectRoot, binary string) (string, bool) {
	for _, venv := range pythonVirtualEnvDirs(projectRoot) {
		for _, candidate := range pythonVirtualEnvBinaryCandidates(venv, binary) {
			if path, err := exec.LookPath(candidate); err == nil {
				return path, true
			}
		}
	}
	return "", false
}

func pythonVirtualEnvDirs(projectRoot string) []string {
	dirs := make([]string, 0, 3)
	if active := os.Getenv("VIRTUAL_ENV"); active != "" {
		dirs = append(dirs, active)
	}
	if projectRoot != "" {
		dirs = append(dirs,
			filepath.Join(projectRoot, ".venv"),
			filepath.Join(projectRoot, "venv"),
		)
	}
	return dirs
}

func pythonVirtualEnvBinaryCandidates(venv, binary string) []string {
	if runtime.GOOS == "windows" {
		scriptsDir := filepath.Join(venv, "Scripts")
		return []string{
			filepath.Join(scriptsDir, binary+".exe"),
			filepath.Join(scriptsDir, binary+".cmd"),
			filepath.Join(scriptsDir, binary+".bat"),
			filepath.Join(scriptsDir, binary),
		}
	}
	return []string{filepath.Join(venv, "bin", binary)}
}

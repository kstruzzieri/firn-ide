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

// ServerConfigFor returns the server configuration for a given language family
// and workspace root. It resolves binary paths using workspace-local and system lookups.
func (r *Registry) ServerConfigFor(family, workspaceRoot string) (*ServerConfig, error) {
	switch family {
	case "typescript":
		return r.resolveTypeScriptServer(workspaceRoot)
	case "go":
		return r.resolveGoServer(workspaceRoot)
	case "python":
		return r.resolvePythonServer(workspaceRoot)
	default:
		return nil, fmt.Errorf("no language server configured for %q", family)
	}
}

func workspaceLocalNodeBin(workspaceRoot, binary string) string {
	localBin := filepath.Join(workspaceRoot, "node_modules", ".bin", binary)
	if runtime.GOOS == "windows" {
		localBin += ".cmd"
	}
	return localBin
}

// resolveTypeScriptServer finds and configures typescript-language-server.
func (r *Registry) resolveTypeScriptServer(workspaceRoot string) (*ServerConfig, error) {
	binary := "typescript-language-server"

	// 1. Check workspace-local node_modules/.bin/
	if path, err := exec.LookPath(workspaceLocalNodeBin(workspaceRoot, binary)); err == nil {
		return &ServerConfig{
			LanguageFamily: "typescript",
			Command:        path,
			Args:           []string{"--stdio"},
			Dir:            workspaceRoot,
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

	// 3. If workspace has local TypeScript lib, tell the system server to use it
	// via initializationOptions.tsserver.path. This ensures the server uses the
	// project's TS version rather than whatever TypeScript the global server bundles.
	// (The --tsserver-path CLI flag was removed in typescript-language-server v4+.)
	// TODO: Gate behind workspace trust when trust system is implemented.
	var initOpts any
	localTSLib := filepath.Join(workspaceRoot, "node_modules", "typescript", "lib")
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
		Dir:            workspaceRoot,
		InitOptions:    initOpts,
	}, nil
}

// resolveGoServer finds and configures gopls.
func (r *Registry) resolveGoServer(workspaceRoot string) (*ServerConfig, error) {
	path, err := exec.LookPath("gopls")
	if err != nil {
		return nil, fmt.Errorf(
			"gopls not found: install it with " +
				"\"go install golang.org/x/tools/gopls@latest\" " +
				"or add it to PATH",
		)
	}

	return &ServerConfig{
		LanguageFamily: "go",
		Command:        path,
		Dir:            workspaceRoot,
	}, nil
}

// resolvePythonServer finds and configures pyright-langserver.
func (r *Registry) resolvePythonServer(workspaceRoot string) (*ServerConfig, error) {
	binary := "pyright-langserver"

	if path, err := exec.LookPath(workspaceLocalNodeBin(workspaceRoot, binary)); err == nil {
		return &ServerConfig{
			LanguageFamily: "python",
			Command:        path,
			Args:           []string{"--stdio"},
			Dir:            workspaceRoot,
		}, nil
	}

	path, err := exec.LookPath(binary)
	if err != nil {
		return nil, fmt.Errorf(
			"pyright-langserver not found: install it with " +
				"\"npm install -g pyright\" " +
				"or add pyright as a project dependency",
		)
	}

	return &ServerConfig{
		LanguageFamily: "python",
		Command:        path,
		Args:           []string{"--stdio"},
		Dir:            workspaceRoot,
	}, nil
}

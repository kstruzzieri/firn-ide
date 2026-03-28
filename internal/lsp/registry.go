package lsp

import (
	"fmt"
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
}

// Registry maps file extensions and language contexts to server configurations.
type Registry struct{}

// NewRegistry creates a new language server registry.
func NewRegistry() *Registry {
	return &Registry{}
}

// extensionToLanguageID maps file extensions to LSP languageId strings.
var extensionToLanguageID = map[string]string{
	".ts":  "typescript",
	".tsx": "typescriptreact",
	".js":  "javascript",
	".jsx": "javascriptreact",
	".mts": "typescript",
	".cts": "typescript",
	".mjs": "javascript",
	".cjs": "javascript",
}

// extensionToFamily maps file extensions to server family keys.
var extensionToFamily = map[string]string{
	".ts":  "typescript",
	".tsx": "typescript",
	".js":  "typescript",
	".jsx": "typescript",
	".mts": "typescript",
	".cts": "typescript",
	".mjs": "typescript",
	".cjs": "typescript",
}

// LanguageIDForExtension returns the LSP languageId for the given file extension.
// Returns empty string if the extension is not recognized.
func (r *Registry) LanguageIDForExtension(ext string) string {
	return extensionToLanguageID[strings.ToLower(ext)]
}

// FamilyForExtension returns the server family for the given file extension.
// Returns empty string if the extension is not recognized.
func (r *Registry) FamilyForExtension(ext string) string {
	return extensionToFamily[strings.ToLower(ext)]
}

// ServerConfigFor returns the server configuration for a given language family
// and workspace root. It resolves binary paths using workspace-local and system lookups.
func (r *Registry) ServerConfigFor(family, workspaceRoot string) (*ServerConfig, error) {
	switch family {
	case "typescript":
		return r.resolveTypeScriptServer(workspaceRoot)
	default:
		return nil, fmt.Errorf("no language server configured for %q", family)
	}
}

// resolveTypeScriptServer finds and configures typescript-language-server.
func (r *Registry) resolveTypeScriptServer(workspaceRoot string) (*ServerConfig, error) {
	binary := "typescript-language-server"

	// 1. Check workspace-local node_modules/.bin/
	localBin := filepath.Join(workspaceRoot, "node_modules", ".bin", binary)
	if runtime.GOOS == "windows" {
		localBin += ".cmd"
	}
	if path, err := exec.LookPath(localBin); err == nil {
		return &ServerConfig{
			LanguageFamily: "typescript",
			Command:        path,
			Args:           []string{"--stdio"},
		}, nil
	}

	// 2. Fall back to system PATH
	path, err := exec.LookPath(binary)
	if err != nil {
		return nil, fmt.Errorf(
			"typescript-language-server not found: install it with "+
				"\"npm install -g typescript-language-server typescript\" "+
				"or add it as a project dependency",
		)
	}

	return &ServerConfig{
		LanguageFamily: "typescript",
		Command:        path,
		Args:           []string{"--stdio"},
	}, nil
}

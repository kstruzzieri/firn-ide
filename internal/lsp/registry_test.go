package lsp

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// fakeTSLSBin creates a fake typescript-language-server executable in a temp
// directory and returns the directory path (suitable for prepending to PATH).
func fakeTSLSBin(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	binary := "typescript-language-server"
	if runtime.GOOS == "windows" {
		binary += ".cmd"
	}
	// Write a no-op script that's executable
	if err := os.WriteFile(filepath.Join(dir, binary), []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestResolveTypeScriptServer_MixedInstall(t *testing.T) {
	// Workspace has local TypeScript lib but no local typescript-language-server.
	// A fake system server is placed on PATH so the test is CI-deterministic.
	workspace := t.TempDir()
	tsLib := filepath.Join(workspace, "node_modules", "typescript", "lib")
	if err := os.MkdirAll(tsLib, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tsLib, "tsserver.js"), []byte("// stub"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Prepend a fake typescript-language-server to PATH so exec.LookPath succeeds
	fakeBinDir := fakeTSLSBin(t)
	origPath := os.Getenv("PATH")
	t.Setenv("PATH", fakeBinDir+string(os.PathListSeparator)+origPath)

	registry := NewRegistry()
	config, err := registry.ServerConfigFor("typescript", workspace)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify tsserver.path is set in InitOptions (not CLI args — v4+ removed the flag)
	opts, ok := config.InitOptions.(map[string]any)
	if !ok {
		t.Fatalf("expected InitOptions to be map[string]any, got %T", config.InitOptions)
	}
	tsserverOpts, ok := opts["tsserver"].(map[string]any)
	if !ok {
		t.Fatalf("expected tsserver key in InitOptions, got %v", opts)
	}
	if tsserverOpts["path"] != tsLib {
		t.Errorf("tsserver.path = %q, want %q", tsserverOpts["path"], tsLib)
	}

	// CLI args should NOT contain --tsserver-path
	for _, arg := range config.Args {
		if arg == "--tsserver-path" {
			t.Error("--tsserver-path should not be in CLI args (removed in v4+)")
		}
	}
}

func TestResolveTypeScriptServer_NoTsserverPathWhenLocalServerExists(t *testing.T) {
	// When the workspace has a local typescript-language-server,
	// --tsserver-path should NOT be added (the local server finds its own TS).
	workspace := t.TempDir()
	binDir := filepath.Join(workspace, "node_modules", ".bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	binary := "typescript-language-server"
	if runtime.GOOS == "windows" {
		binary += ".cmd"
	}
	binPath := filepath.Join(binDir, binary)
	if err := os.WriteFile(binPath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	registry := NewRegistry()
	config, err := registry.ServerConfigFor("typescript", workspace)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, arg := range config.Args {
		if arg == "--tsserver-path" {
			t.Error("unexpected --tsserver-path for workspace-local server")
		}
	}
}

func TestResolveTypeScriptServer_NoLocalTS(t *testing.T) {
	// Workspace has neither local TS lib nor local server.
	// A fake system server is on PATH. No --tsserver-path should be added.
	workspace := t.TempDir()

	fakeBinDir := fakeTSLSBin(t)
	origPath := os.Getenv("PATH")
	t.Setenv("PATH", fakeBinDir+string(os.PathListSeparator)+origPath)

	registry := NewRegistry()
	config, err := registry.ServerConfigFor("typescript", workspace)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, arg := range config.Args {
		if arg == "--tsserver-path" {
			t.Error("unexpected --tsserver-path when no local TypeScript lib exists")
		}
	}

	// Should just be --stdio
	if len(config.Args) != 1 || config.Args[0] != "--stdio" {
		t.Errorf("expected args [--stdio], got %v", config.Args)
	}
}

func TestResolveTypeScriptServer_NotFound(t *testing.T) {
	// No server anywhere — should return an actionable error
	workspace := t.TempDir()

	// Empty PATH so nothing is found
	t.Setenv("PATH", "")

	registry := NewRegistry()
	_, err := registry.ServerConfigFor("typescript", workspace)
	if err == nil {
		t.Fatal("expected error when typescript-language-server is not found")
	}

	// Error message should contain install instructions
	if !contains(err.Error(), "npm install") {
		t.Errorf("error message should contain install instructions, got: %s", err.Error())
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

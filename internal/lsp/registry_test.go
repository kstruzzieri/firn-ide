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

// Monorepo case: the repo root has no install, but a nested package has its
// own typescript-language-server. ServerConfigFor must use the package-local
// install (and its Dir must be the package, not the repo root).
//
// Mirrors the runtime invariant after #20: Manager hands the registry the
// detected project root, not the active workspace root.
func TestResolveTypeScriptServer_PrefersPackageLocalInMonorepo(t *testing.T) {
	repoRoot := t.TempDir()
	pkgRoot := filepath.Join(repoRoot, "packages", "ui")
	pkgBinDir := filepath.Join(pkgRoot, "node_modules", ".bin")
	if err := os.MkdirAll(pkgBinDir, 0o755); err != nil {
		t.Fatal(err)
	}

	binary := "typescript-language-server"
	if runtime.GOOS == "windows" {
		binary += ".cmd"
	}
	pkgBinPath := filepath.Join(pkgBinDir, binary)
	if err := os.WriteFile(pkgBinPath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	// A different fake server is on PATH; it must lose to the package-local install.
	systemBinDir := fakeTSLSBin(t)
	origPath := os.Getenv("PATH")
	t.Setenv("PATH", systemBinDir+string(os.PathListSeparator)+origPath)

	registry := NewRegistry()
	config, err := registry.ServerConfigFor("typescript", pkgRoot)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if config.Command != pkgBinPath {
		t.Errorf("Command = %q, want package-local %q", config.Command, pkgBinPath)
	}
	if config.Dir != pkgRoot {
		t.Errorf("Dir = %q, want package root %q (not repo root)", config.Dir, pkgRoot)
	}
	if config.InitOptions != nil {
		// No package-local TS lib was created, so tsserver.path must not be set.
		t.Errorf("InitOptions should be nil for package-local server without local TS lib, got %v", config.InitOptions)
	}
}

// Monorepo case 2: package-local install missing, package has its own
// TypeScript lib. The system server is used, but initializationOptions
// tsserver.path must point at the PACKAGE's TypeScript lib, not the repo's.
func TestResolveTypeScriptServer_SystemServerUsesPackageLocalTSLib(t *testing.T) {
	repoRoot := t.TempDir()
	pkgRoot := filepath.Join(repoRoot, "packages", "ui")
	// Package-local TS lib (no package-local server)
	pkgTSLib := filepath.Join(pkgRoot, "node_modules", "typescript", "lib")
	if err := os.MkdirAll(pkgTSLib, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pkgTSLib, "tsserver.js"), []byte("// stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Repo-root TS lib that must NOT be selected
	repoTSLib := filepath.Join(repoRoot, "node_modules", "typescript", "lib")
	if err := os.MkdirAll(repoTSLib, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoTSLib, "tsserver.js"), []byte("// repo stub"), 0o644); err != nil {
		t.Fatal(err)
	}

	fakeBinDir := fakeTSLSBin(t)
	origPath := os.Getenv("PATH")
	t.Setenv("PATH", fakeBinDir+string(os.PathListSeparator)+origPath)

	registry := NewRegistry()
	config, err := registry.ServerConfigFor("typescript", pkgRoot)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if config.Dir != pkgRoot {
		t.Errorf("Dir = %q, want %q", config.Dir, pkgRoot)
	}
	opts, ok := config.InitOptions.(map[string]any)
	if !ok {
		t.Fatalf("expected tsserver init options for package-local TS lib, got %T", config.InitOptions)
	}
	tsserverOpts := opts["tsserver"].(map[string]any)
	if tsserverOpts["path"] != pkgTSLib {
		t.Errorf("tsserver.path = %q, want package-local %q (repo-root TS lib must lose)", tsserverOpts["path"], pkgTSLib)
	}
}

func TestFindGoBinary_FallbackFindsGoplsInHome(t *testing.T) {
	homeDir := t.TempDir()
	goBin := filepath.Join(homeDir, "go", "bin")
	if err := os.MkdirAll(goBin, 0o755); err != nil {
		t.Fatal(err)
	}
	goplsPath := filepath.Join(goBin, "gopls")
	if err := os.WriteFile(goplsPath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Point HOME at our temp dir so findGoBinary picks up the fake binary.
	t.Setenv("HOME", homeDir)
	t.Setenv("PATH", "")

	found := findGoBinary("gopls")
	if found != goplsPath {
		t.Errorf("findGoBinary(gopls) = %q, want %q", found, goplsPath)
	}
}

func TestFindGoBinary_ReturnsEmptyWhenNotFound(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("PATH", "")

	found := findGoBinary("gopls")
	if found != "" {
		t.Errorf("findGoBinary(gopls) = %q, want empty string", found)
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

package lsp

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// tsMarkers mirrors the TypeScript family marker priority that manager.go will
// pass at the call site.
var tsMarkers = []string{"tsconfig.json", "jsconfig.json", "package.json"}

// touch creates an empty file at path, creating parent directories as needed.
func touch(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdirall: %v", err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", path, err)
	}
	_ = f.Close()
}

func TestResolveProjectRoot_NearestTsconfigWins(t *testing.T) {
	ws := t.TempDir()
	touch(t, filepath.Join(ws, "package.json"))               // repo-root package
	touch(t, filepath.Join(ws, "frontend", "tsconfig.json"))  // package-local config
	touch(t, filepath.Join(ws, "frontend", "package.json"))   // package-local manifest
	file := filepath.Join(ws, "frontend", "src", "App.tsx")
	touch(t, file)

	got, err := ResolveProjectRoot(file, ws, tsMarkers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := filepath.Join(ws, "frontend")
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestResolveProjectRoot_NearestJsconfigWins(t *testing.T) {
	ws := t.TempDir()
	touch(t, filepath.Join(ws, "package.json"))
	touch(t, filepath.Join(ws, "admin", "jsconfig.json"))
	file := filepath.Join(ws, "admin", "src", "main.js")
	touch(t, file)

	got, err := ResolveProjectRoot(file, ws, tsMarkers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := filepath.Join(ws, "admin")
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestResolveProjectRoot_PackageJsonFallback(t *testing.T) {
	ws := t.TempDir()
	touch(t, filepath.Join(ws, "packages", "ui", "package.json"))
	file := filepath.Join(ws, "packages", "ui", "src", "Button.tsx")
	touch(t, file)

	got, err := ResolveProjectRoot(file, ws, tsMarkers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := filepath.Join(ws, "packages", "ui")
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestResolveProjectRoot_SameDirectoryMarkerPriority(t *testing.T) {
	// tsconfig.json should beat package.json when both live in the same dir.
	// (Same directory wins either way; this only affects determinism.)
	ws := t.TempDir()
	touch(t, filepath.Join(ws, "tsconfig.json"))
	touch(t, filepath.Join(ws, "package.json"))
	file := filepath.Join(ws, "src", "index.ts")
	touch(t, file)

	got, err := ResolveProjectRoot(file, ws, tsMarkers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != ws {
		t.Errorf("got %q, want %q", got, ws)
	}
}

func TestResolveProjectRoot_FallbackToWorkspaceRoot(t *testing.T) {
	ws := t.TempDir()
	file := filepath.Join(ws, "src", "index.ts")
	touch(t, file)

	got, err := ResolveProjectRoot(file, ws, tsMarkers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != ws {
		t.Errorf("got %q, want workspace root %q", got, ws)
	}
}

func TestResolveProjectRoot_FileAtWorkspaceRoot(t *testing.T) {
	ws := t.TempDir()
	touch(t, filepath.Join(ws, "tsconfig.json"))
	file := filepath.Join(ws, "index.ts")
	touch(t, file)

	got, err := ResolveProjectRoot(file, ws, tsMarkers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != ws {
		t.Errorf("got %q, want %q", got, ws)
	}
}

func TestResolveProjectRoot_PathOutsideWorkspace(t *testing.T) {
	ws := t.TempDir()
	outside := t.TempDir()
	file := filepath.Join(outside, "evil.ts")
	touch(t, file)

	_, err := ResolveProjectRoot(file, ws, tsMarkers)
	if !errors.Is(err, ErrPathOutsideWorkspace) {
		t.Fatalf("got error %v, want ErrPathOutsideWorkspace", err)
	}
}

func TestResolveProjectRoot_DotDotEscapeRejected(t *testing.T) {
	ws := t.TempDir()
	parent := filepath.Dir(ws)
	// Construct a path that lexically escapes via `..` but is not absolute-cleaned.
	escapePath := filepath.Join(ws, "..", filepath.Base(parent), "outside.ts")

	_, err := ResolveProjectRoot(escapePath, ws, tsMarkers)
	if err == nil {
		t.Fatalf("expected error for `..` escape, got nil")
	}
	// May be ErrPathOutsideWorkspace or a related cleaning error; assert no false success.
}

func TestResolveProjectRoot_EmptyMarkersReturnsWorkspace(t *testing.T) {
	ws := t.TempDir()
	file := filepath.Join(ws, "src", "main.go")
	touch(t, file)

	got, err := ResolveProjectRoot(file, ws, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != ws {
		t.Errorf("got %q, want workspace %q", got, ws)
	}
}

func TestResolveProjectRoot_PathWithSpacesAndUnicode(t *testing.T) {
	ws := t.TempDir()
	pkg := filepath.Join(ws, "my package — ünicode")
	touch(t, filepath.Join(pkg, "tsconfig.json"))
	file := filepath.Join(pkg, "src", "app.ts")
	touch(t, file)

	got, err := ResolveProjectRoot(file, ws, tsMarkers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != pkg {
		t.Errorf("got %q, want %q", got, pkg)
	}
}

func TestResolveProjectRoot_RejectsPrefixCollision(t *testing.T) {
	// `/foo/bar` must not be treated as a child of `/foo/ba`.
	if runtime.GOOS == "windows" {
		t.Skip("path semantics differ on Windows; covered separately")
	}
	parent := t.TempDir()
	ws := filepath.Join(parent, "ba")
	if err := os.MkdirAll(ws, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	sibling := filepath.Join(parent, "bar")
	touch(t, filepath.Join(sibling, "tsconfig.json"))
	file := filepath.Join(sibling, "index.ts")
	touch(t, file)

	_, err := ResolveProjectRoot(file, ws, tsMarkers)
	if !errors.Is(err, ErrPathOutsideWorkspace) {
		t.Fatalf("expected ErrPathOutsideWorkspace for prefix collision, got %v", err)
	}
}

func TestResolveProjectRoot_EmptyArgsRejected(t *testing.T) {
	if _, err := ResolveProjectRoot("", "/tmp", tsMarkers); err == nil {
		t.Error("expected error for empty filePath")
	}
	if _, err := ResolveProjectRoot("/tmp/foo.ts", "", tsMarkers); err == nil {
		t.Error("expected error for empty workspaceRoot")
	}
}

// Sanity: pathContains is load-bearing for the boundary guard.
func TestPathContains(t *testing.T) {
	sep := string(filepath.Separator)
	cases := []struct {
		parent, child string
		want          bool
	}{
		{"/a/b", "/a/b", true},
		{"/a/b", "/a/b/c", true},
		{"/a/b", "/a/bc", false}, // prefix collision must be false
		{"/a/b", "/a", false},
		{strings.TrimRight("/a/b/", sep), "/a/b/c", true},
		// Empty-input guard: an unset workspace must not be classified as
		// containing every absolute path. Without this guard the crash-
		// recovery checks in manager.go would resurrect servers after
		// SetWorkspaceRoot("").
		{"", "/a/b", false},
		{"/a/b", "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		if got := pathContains(tc.parent, tc.child); got != tc.want {
			t.Errorf("pathContains(%q, %q) = %v, want %v", tc.parent, tc.child, got, tc.want)
		}
	}
}

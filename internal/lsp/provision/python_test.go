package provision

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(path, body string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(body), 0o755)
}

func TestPython_Resolve_missingThenAvailable(t *testing.T) {
	cache := t.TempDir()
	p := NewPythonProvisioner(cache, "darwin", "arm64", PythonDeps{
		LookPath: func(string) (string, error) { return "", os.ErrNotExist }, // no uv
		Fetch: func(_ context.Context, a Artifact, destDir string) error {
			if a.Kind == "node-wheel" {
				return writeFile(filepath.Join(destDir, "nodejs_wheel", "node"), "#!node")
			}
			return writeFile(filepath.Join(destDir, "basedpyright", "langserver.index.js"), "ls")
		},
	})

	if r := p.Resolve(); r.State != StateMissing {
		t.Fatalf("pre-install Resolve = %v, want missing", r.State)
	}
	r := p.Install(context.Background(), func(Progress) {})
	if r.State != StateAvailable {
		t.Fatalf("Install = %v (%v), want available", r.State, r.Err)
	}
	got := p.Resolve()
	if got.State != StateAvailable {
		t.Fatalf("post-install Resolve = %v", got.State)
	}
	if _, err := os.Stat(got.Path); err != nil {
		t.Errorf("launch path %q not on disk: %v", got.Path, err)
	}
	if len(got.Args) == 0 || got.Args[len(got.Args)-1] != "--stdio" {
		t.Errorf("args = %v, want trailing --stdio", got.Args)
	}
	// The manual (non-uv) path launches `node <langserver.index.js> --stdio` with
	// cwd=projectRoot, so the script arg must be absolute and on disk.
	if !filepath.IsAbs(got.Args[0]) {
		t.Errorf("langserver script arg must be absolute, got %q", got.Args[0])
	}
	if _, err := os.Stat(got.Args[0]); err != nil {
		t.Errorf("langserver script arg %q not resolvable on disk: %v", got.Args[0], err)
	}
	if _, err := os.Stat(filepath.Join(cache, "python", "1.39.9", "launch.json")); err != nil {
		t.Errorf("launch.json missing: %v", err)
	}
}

func TestPython_Install_unsupportedPlatform(t *testing.T) {
	p := NewPythonProvisioner(t.TempDir(), "plan9", "mips", PythonDeps{
		LookPath: func(string) (string, error) { return "", os.ErrNotExist },
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateUnsupported {
		t.Fatalf("Install = %v, want unsupported", r.State)
	}
}

func TestPython_Install_fetchOffline(t *testing.T) {
	p := NewPythonProvisioner(t.TempDir(), "darwin", "arm64", PythonDeps{
		LookPath: func(string) (string, error) { return "", os.ErrNotExist },
		Fetch:    func(context.Context, Artifact, string) error { return errors.New("dial tcp: offline") },
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateOffline {
		t.Fatalf("Install = %v, want offline", r.State)
	}
}

func TestPython_Install_checksumFailMapsToChecksumState(t *testing.T) {
	p := NewPythonProvisioner(t.TempDir(), "darwin", "arm64", PythonDeps{
		LookPath: func(string) (string, error) { return "", os.ErrNotExist },
		Fetch:    func(context.Context, Artifact, string) error { return &ChecksumError{URL: "u", Got: "a", Want: "b"} },
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateChecksumFailed {
		t.Fatalf("Install = %v, want checksum-failed", r.State)
	}
}

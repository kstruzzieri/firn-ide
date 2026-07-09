package provision

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestGo_Resolve_missingThenAvailable(t *testing.T) {
	cache := t.TempDir()
	p := NewGoProvisioner(cache, "darwin", "arm64", GoDeps{
		LookPath: func(name string) (string, error) {
			if name == "go" {
				return "/usr/local/go/bin/go", nil
			}
			return "", os.ErrNotExist
		},
		RunGo: func(_ context.Context, _ string, args, env []string) error {
			binDir := goBinDir(env)
			if binDir == "" {
				t.Fatalf("no GOBIN in env: %v", env)
			}
			// Simulate `go install` producing the gopls binary in GOBIN.
			return writeFile(filepath.Join(binDir, "gopls"), "#!/bin/sh\n# gopls")
		},
	})

	if r := p.Resolve(); r.State != StateMissing {
		t.Fatalf("pre-install Resolve = %v, want missing", r.State)
	}
	r := p.Install(context.Background(), func(Progress) {})
	if r.State != StateAvailable {
		t.Fatalf("Install = %v (%v), want available", r.State, r.Err)
	}
	if filepath.Base(r.Path) != "gopls" {
		t.Errorf("launch path = %q, want gopls binary", r.Path)
	}
	if len(r.Args) != 0 {
		t.Errorf("args = %v, want none (gopls serves stdio by default)", r.Args)
	}
	if got := p.Resolve(); got.State != StateAvailable {
		t.Fatalf("post-install Resolve = %v", got.State)
	}
	if _, err := os.Stat(r.Path); err != nil {
		t.Errorf("gopls launch path %q not on disk: %v", r.Path, err)
	}
}

func TestGoBinDirUsesLastDuplicate(t *testing.T) {
	if got := goBinDir([]string{"GOBIN=/old", "PATH=/bin", "GOBIN=/staging"}); got != "/staging" {
		t.Fatalf("goBinDir = %q, want last GOBIN", got)
	}
}

func TestGo_Install_noToolchain(t *testing.T) {
	p := NewGoProvisioner(t.TempDir(), "darwin", "arm64", GoDeps{
		LookPath: func(string) (string, error) { return "", os.ErrNotExist },
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateUnsupported {
		t.Fatalf("Install without go toolchain = %v, want unsupported", r.State)
	}
}

func TestGo_Install_goInstallFails(t *testing.T) {
	p := NewGoProvisioner(t.TempDir(), "darwin", "arm64", GoDeps{
		LookPath: func(string) (string, error) { return "/usr/local/go/bin/go", nil },
		RunGo: func(context.Context, string, []string, []string) error {
			return errors.New("go install: network unreachable")
		},
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateOffline {
		t.Fatalf("Install with failing go install = %v, want offline", r.State)
	}
}

func TestGo_Install_producesNoBinary(t *testing.T) {
	p := NewGoProvisioner(t.TempDir(), "darwin", "arm64", GoDeps{
		LookPath: func(string) (string, error) { return "/usr/local/go/bin/go", nil },
		RunGo:    func(context.Context, string, []string, []string) error { return nil }, // succeeds but writes nothing
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State == StateAvailable {
		t.Fatalf("Install = available despite no binary produced")
	}
}

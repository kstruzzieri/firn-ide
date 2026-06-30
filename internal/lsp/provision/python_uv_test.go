package provision

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestPython_installViaUV(t *testing.T) {
	cache := t.TempDir()
	p := NewPythonProvisioner(cache, "darwin", "arm64", PythonDeps{
		LookPath: func(name string) (string, error) {
			if name == "uv" {
				return "/usr/local/bin/uv", nil
			}
			return "", os.ErrNotExist
		},
		RunUV: func(_ context.Context, uv string, args, env []string) error {
			// Simulate uv creating the langserver shim in the bin dir it was told to use.
			binDir := uvBinDir(args)
			if binDir == "" {
				t.Fatalf("no --bin-dir in uv args: %v", args)
			}
			shim := filepath.Join(binDir, "basedpyright-langserver")
			return writeFile(shim, "#!/bin/sh\n# uv shim")
		},
	})

	r := p.Install(context.Background(), func(Progress) {})
	if r.State != StateAvailable {
		t.Fatalf("Install via uv = %v (%v)", r.State, r.Err)
	}
	if filepath.Base(r.Path) != "basedpyright-langserver" {
		t.Errorf("launch path = %q, want basedpyright-langserver shim", r.Path)
	}
	if len(r.Args) != 1 || r.Args[0] != "--stdio" {
		t.Errorf("args = %v, want [--stdio]", r.Args)
	}
	spec, err := readLaunchSpec(p.versionDir())
	if err != nil || !spec.Abs {
		t.Errorf("uv launch.json should be absolute: %+v err=%v", spec, err)
	}
}

func TestPython_installViaUV_failureFallsThroughToManual(t *testing.T) {
	cache := t.TempDir()
	p := NewPythonProvisioner(cache, "darwin", "arm64", PythonDeps{
		LookPath: func(name string) (string, error) {
			if name == "uv" {
				return "/usr/local/bin/uv", nil
			}
			return "", os.ErrNotExist
		},
		RunUV: func(context.Context, string, []string, []string) error {
			return os.ErrPermission // uv fails
		},
		Fetch: func(_ context.Context, a Artifact, destDir string) error {
			if a.Kind == "node-wheel" {
				return writeFile(filepath.Join(destDir, "nodejs_wheel", "node"), "#!node")
			}
			return writeFile(filepath.Join(destDir, "basedpyright", "langserver.index.js"), "ls")
		},
	})
	r := p.Install(context.Background(), func(Progress) {})
	if r.State != StateAvailable {
		t.Fatalf("expected manual fallback to succeed, got %v (%v)", r.State, r.Err)
	}
	// manual path stores a relative launch spec
	spec, _ := readLaunchSpec(p.versionDir())
	if spec.Abs {
		t.Errorf("manual fallback should write a relative launch spec, got abs")
	}
}

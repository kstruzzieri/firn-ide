package provision

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// tsFakeFetch lays out the same on-disk shape the real defaultTypeScriptFetch
// produces, so the launch-target locator can find node + cli.mjs + typescript.
func tsFakeFetch(_ context.Context, a Artifact, destDir string) error {
	switch a.Kind {
	case "node-wheel":
		return writeFile(filepath.Join(destDir, "nodejs_wheel", "node"), "#!node")
	case "npm-server":
		return writeFile(filepath.Join(destDir, "node_modules", "typescript-language-server", "lib", "cli.mjs"), "// tls")
	case "npm-typescript":
		return writeFile(filepath.Join(destDir, "node_modules", "typescript", "lib", "tsserver.js"), "// tsc")
	default:
		return errors.New("unexpected kind " + a.Kind)
	}
}

func TestTypeScript_Resolve_missingThenAvailable(t *testing.T) {
	cache := t.TempDir()
	p := NewTypeScriptProvisioner(cache, "darwin", "arm64", TypeScriptDeps{Fetch: tsFakeFetch})

	if r := p.Resolve(); r.State != StateMissing {
		t.Fatalf("pre-install Resolve = %v, want missing", r.State)
	}
	r := p.Install(context.Background(), func(Progress) {})
	if r.State != StateAvailable {
		t.Fatalf("Install = %v (%v), want available", r.State, r.Err)
	}
	if filepath.Base(r.Path) != "node" {
		t.Errorf("launch path = %q, want node runtime", r.Path)
	}
	if len(r.Args) < 2 || r.Args[len(r.Args)-1] != "--stdio" {
		t.Errorf("args = %v, want [<cli.mjs> --stdio]", r.Args)
	}
	if filepath.Base(r.Args[0]) != "cli.mjs" {
		t.Errorf("first arg = %q, want cli.mjs", r.Args[0])
	}
	// The script arg must be absolute and on disk: the server is launched with
	// cwd=projectRoot (not the version dir), so a relative script path would make
	// node fail with "Cannot find module".
	if !filepath.IsAbs(r.Args[0]) {
		t.Errorf("cli.mjs arg must be absolute, got %q", r.Args[0])
	}
	if _, err := os.Stat(r.Args[0]); err != nil {
		t.Errorf("cli.mjs arg %q not resolvable on disk: %v", r.Args[0], err)
	}
	if _, err := os.Stat(r.Path); err != nil {
		t.Errorf("node launch path %q not on disk: %v", r.Path, err)
	}
	if got := p.Resolve(); got.State != StateAvailable {
		t.Fatalf("post-install Resolve = %v", got.State)
	}
}

func TestTypeScript_Install_missingTypeScriptFailsInstall(t *testing.T) {
	// node + tls present but no typescript package -> the server can't run.
	p := NewTypeScriptProvisioner(t.TempDir(), "darwin", "arm64", TypeScriptDeps{
		Fetch: func(_ context.Context, a Artifact, destDir string) error {
			if a.Kind == "npm-typescript" {
				return nil // skip laying down typescript
			}
			return tsFakeFetch(context.Background(), a, destDir)
		},
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State == StateAvailable {
		t.Fatalf("Install = available despite missing typescript package")
	}
}

func TestTypeScript_Install_unsupportedPlatform(t *testing.T) {
	p := NewTypeScriptProvisioner(t.TempDir(), "plan9", "mips", TypeScriptDeps{})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateUnsupported {
		t.Fatalf("Install = %v, want unsupported", r.State)
	}
}

func TestTypeScript_Install_offline(t *testing.T) {
	p := NewTypeScriptProvisioner(t.TempDir(), "darwin", "arm64", TypeScriptDeps{
		Fetch: func(context.Context, Artifact, string) error { return errors.New("dial tcp: offline") },
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateOffline {
		t.Fatalf("Install = %v, want offline", r.State)
	}
}

func TestTypeScript_Install_checksumFailMapsToChecksumState(t *testing.T) {
	p := NewTypeScriptProvisioner(t.TempDir(), "darwin", "arm64", TypeScriptDeps{
		Fetch: func(context.Context, Artifact, string) error { return &ChecksumError{URL: "u", Got: "a", Want: "b"} },
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateChecksumFailed {
		t.Fatalf("Install = %v, want checksum-failed", r.State)
	}
}

// TestTypeScript_defaultFetch_npmServer exercises the real download+verify+untar
// path for an npm tarball, confirming the "package/" prefix is stripped into
// node_modules/typescript-language-server.
func TestTypeScript_defaultFetch_npmServer(t *testing.T) {
	tgz := makeTarGz(t, map[string]string{
		"package/lib/cli.mjs":  "// tls entry",
		"package/package.json": `{"name":"typescript-language-server"}`,
	})
	raw, err := os.ReadFile(tgz)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(raw) }))
	defer srv.Close()

	dest := t.TempDir()
	a := Artifact{Kind: "npm-server", URL: srv.URL + "/tls.tgz", SHA256: sha256Hex(raw)}
	if err := defaultTypeScriptFetch(context.Background(), a, dest); err != nil {
		t.Fatalf("defaultTypeScriptFetch: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dest, "node_modules", "typescript-language-server", "lib", "cli.mjs"))
	if err != nil || string(got) != "// tls entry" {
		t.Fatalf("extracted cli.mjs = %q err=%v", got, err)
	}
}

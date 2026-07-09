package provision

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRust_Resolve_missingThenAvailable(t *testing.T) {
	cache := t.TempDir()
	p := NewRustProvisioner(cache, "darwin", "arm64", RustDeps{
		Fetch: func(_ context.Context, a Artifact, destDir string) error {
			if a.Kind != "archive-binary" {
				t.Fatalf("unexpected artifact kind %q", a.Kind)
			}
			return writeFile(filepath.Join(destDir, "rust-analyzer"), "#!/bin/sh\n# rust-analyzer")
		},
	})

	if r := p.Resolve(); r.State != StateMissing {
		t.Fatalf("pre-install Resolve = %v, want missing", r.State)
	}
	r := p.Install(context.Background(), func(Progress) {})
	if r.State != StateAvailable {
		t.Fatalf("Install = %v (%v), want available", r.State, r.Err)
	}
	if filepath.Base(r.Path) != "rust-analyzer" {
		t.Errorf("launch path = %q, want rust-analyzer", r.Path)
	}
	if len(r.Args) != 0 {
		t.Errorf("args = %v, want none (rust-analyzer serves stdio by default)", r.Args)
	}
	if _, err := os.Stat(r.Path); err != nil {
		t.Errorf("rust-analyzer launch path %q not on disk: %v", r.Path, err)
	}
	if got := p.Resolve(); got.State != StateAvailable {
		t.Fatalf("post-install Resolve = %v", got.State)
	}
}

func TestRust_Install_unsupportedPlatform(t *testing.T) {
	p := NewRustProvisioner(t.TempDir(), "plan9", "mips", RustDeps{})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateUnsupported {
		t.Fatalf("Install = %v, want unsupported", r.State)
	}
}

func TestRust_Install_offline(t *testing.T) {
	p := NewRustProvisioner(t.TempDir(), "darwin", "arm64", RustDeps{
		Fetch: func(context.Context, Artifact, string) error { return errors.New("dial tcp: offline") },
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateOffline {
		t.Fatalf("Install = %v, want offline", r.State)
	}
}

func TestRust_Install_checksumFailMapsToChecksumState(t *testing.T) {
	p := NewRustProvisioner(t.TempDir(), "darwin", "arm64", RustDeps{
		Fetch: func(context.Context, Artifact, string) error { return &ChecksumError{URL: "u", Got: "a", Want: "b"} },
	})
	if r := p.Install(context.Background(), func(Progress) {}); r.State != StateChecksumFailed {
		t.Fatalf("Install = %v, want checksum-failed", r.State)
	}
}

// TestRust_defaultFetch_gunzips exercises the real download+verify+gunzip path
// (no injected Fetch) against a local server serving a gzipped fake binary.
func TestRust_defaultFetch_gunzips(t *testing.T) {
	body := []byte("#!/bin/sh\n# fake rust-analyzer")
	var gzbuf bytes.Buffer
	zw := gzip.NewWriter(&gzbuf)
	_, _ = zw.Write(body)
	_ = zw.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(gzbuf.Bytes()) }))
	defer srv.Close()

	dest := t.TempDir()
	a := Artifact{Kind: "archive-binary", URL: srv.URL + "/rust-analyzer.gz", SHA256: sha256Hex(gzbuf.Bytes())}
	if err := defaultRustFetch(context.Background(), a, dest); err != nil {
		t.Fatalf("defaultRustFetch: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dest, "rust-analyzer"))
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("gunzipped binary = %q err=%v", got, err)
	}
}

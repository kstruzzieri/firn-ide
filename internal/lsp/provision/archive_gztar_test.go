package provision

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func makeGz(t *testing.T, body []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "bin.gz")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	zw := gzip.NewWriter(f)
	if _, err := zw.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestGunzipFile_ok(t *testing.T) {
	body := []byte("#!/bin/sh\n# rust-analyzer binary")
	src := makeGz(t, body)
	dest := filepath.Join(t.TempDir(), "rust-analyzer")
	if err := GunzipFile(src, dest); err != nil {
		t.Fatalf("GunzipFile: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("contents = %q err=%v", got, err)
	}
	info, err := os.Stat(dest)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Errorf("gunzipped binary not executable: mode = %v", info.Mode())
	}
}

// makeTarGz builds a gzipped tar with an npm-style "package/" prefix so the
// strip-components behaviour can be exercised.
func makeTarGz(t *testing.T, files map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "pkg.tgz")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	gw := gzip.NewWriter(f)
	tw := tar.NewWriter(gw)
	for name, body := range files {
		hdr := &tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gw.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestUntarGz_stripsLeadingComponent(t *testing.T) {
	src := makeTarGz(t, map[string]string{
		"package/lib/cli.mjs":  "console.log('tls')",
		"package/package.json": `{"name":"typescript-language-server"}`,
	})
	dest := t.TempDir()
	if err := UntarGz(src, dest, 1); err != nil {
		t.Fatalf("UntarGz: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dest, "lib", "cli.mjs"))
	if err != nil || string(got) != "console.log('tls')" {
		t.Fatalf("stripped extract wrong: %q err=%v", got, err)
	}
	if _, err := os.Stat(filepath.Join(dest, "package", "lib", "cli.mjs")); err == nil {
		t.Error("expected leading 'package/' component stripped")
	}
}

func TestUntarGz_zipSlipRejected(t *testing.T) {
	src := makeTarGz(t, map[string]string{"package/../escape.txt": "evil"})
	if err := UntarGz(src, t.TempDir(), 1); err == nil {
		t.Fatal("expected zip-slip rejection")
	}
}

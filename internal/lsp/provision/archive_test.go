package provision

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func makeZip(t *testing.T, files map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "a.whl")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestUnzipWheel_ok(t *testing.T) {
	src := makeZip(t, map[string]string{
		"basedpyright/langserver.index.js": "console.log('ls')",
		"basedpyright/dist/x.js":           "x",
	})
	dest := t.TempDir()
	if err := UnzipWheel(src, dest); err != nil {
		t.Fatalf("UnzipWheel: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dest, "basedpyright", "langserver.index.js"))
	if err != nil || string(got) != "console.log('ls')" {
		t.Errorf("extracted file wrong: %q err=%v", got, err)
	}
}

func TestUnzipWheel_zipSlipRejected(t *testing.T) {
	src := makeZip(t, map[string]string{"../escape.txt": "evil"})
	if err := UnzipWheel(src, t.TempDir()); err == nil {
		t.Fatal("expected zip-slip rejection")
	}
}

func TestUnzipWheel_preservesExecBit(t *testing.T) {
	p := filepath.Join(t.TempDir(), "exe.whl")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	hdr := &zip.FileHeader{Name: "nodejs_wheel/node"}
	hdr.SetMode(0o755)
	w, err := zw.CreateHeader(hdr)
	if err != nil {
		t.Fatal(err)
	}
	w.Write([]byte("#!node"))
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()

	dest := t.TempDir()
	if err := UnzipWheel(p, dest); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dest, "nodejs_wheel", "node"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Errorf("exec bit not preserved: mode = %v", info.Mode())
	}
}

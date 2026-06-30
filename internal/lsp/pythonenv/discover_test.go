package pythonenv

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoverInterpreter_uv(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "uv.lock"), []byte(""), 0o644)
	interp := filepath.Join(root, ".venv", "bin", "python")
	os.MkdirAll(filepath.Dir(interp), 0o755)
	os.WriteFile(interp, []byte("#!py"), 0o755)

	run := func(_ context.Context, name string, args ...string) (string, error) {
		if name == "uv" {
			return interp, nil
		}
		return "", os.ErrNotExist
	}
	got, source, ok := DiscoverInterpreter(context.Background(), root, run)
	if !ok || got != interp || source != "uv" {
		t.Fatalf("got (%q,%q,%v)", got, source, ok)
	}
}

func TestDiscoverInterpreter_noMarkers(t *testing.T) {
	called := false
	run := func(context.Context, string, ...string) (string, error) { called = true; return "", nil }
	if _, _, ok := DiscoverInterpreter(context.Background(), t.TempDir(), run); ok {
		t.Error("expected ok=false with no markers")
	}
	if called {
		t.Error("runner must not be invoked without markers")
	}
}

func TestDiscoverInterpreter_poetry(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "poetry.lock"), []byte(""), 0o644)
	envRoot := t.TempDir()
	interp := filepath.Join(envRoot, "bin", "python")
	os.MkdirAll(filepath.Dir(interp), 0o755)
	os.WriteFile(interp, []byte("#!py"), 0o755)
	run := func(_ context.Context, name string, args ...string) (string, error) {
		if name == "poetry" {
			return envRoot, nil // `poetry env info -p` prints the env root
		}
		return "", os.ErrNotExist
	}
	got, source, ok := DiscoverInterpreter(context.Background(), root, run)
	if !ok || got != interp || source != "poetry" {
		t.Fatalf("got (%q,%q,%v)", got, source, ok)
	}
}

func TestDiscoverInterpreter_resultNotExecutableRejected(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "uv.lock"), []byte(""), 0o644)
	run := func(context.Context, string, ...string) (string, error) {
		return filepath.Join(root, "does-not-exist"), nil
	}
	if _, _, ok := DiscoverInterpreter(context.Background(), root, run); ok {
		t.Error("expected ok=false when returned interpreter does not exist")
	}
}

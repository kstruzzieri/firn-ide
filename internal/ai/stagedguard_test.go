package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"firn/internal/filesystem"
)

func newStagedGuardService(t *testing.T) *Service {
	t.Helper()
	svc := NewService(context.Background(), filesystem.NewOS(), "", nil, "")
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := svc.Close(ctx); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	return svc
}

// outsideConfig points GO_LLM_CONFIG at a config file outside every
// repository under test.
func outsideConfig(t *testing.T) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "models.json")
	writeFile(t, path, `{"providers":{},"models":{},"defaults":{}}`)
	t.Setenv("GO_LLM_CONFIG", path)
}

func bindStaged(t *testing.T, svc *Service, root string) {
	t.Helper()
	if _, _, err := svc.BindRepository(root); err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
}

func assertDenied(t *testing.T, guard func(string, bool) error, paths ...string) {
	t.Helper()
	for _, path := range paths {
		if err := guard(path, false); err == nil {
			t.Errorf("guard(%q) = nil, want denied", path)
		}
	}
}

func assertAllowed(t *testing.T, guard func(string, bool) error, paths ...string) {
	t.Helper()
	for _, path := range paths {
		if err := guard(path, false); err != nil {
			t.Errorf("guard(%q) = %v, want allowed", path, err)
		}
	}
}

// StagedPathGuard is the bound repository's own chat policy: the floor, the
// manifest rules read now (no watcher event needed), and the go-llm config
// source as discovery finds it now, which the runtime is pinned to (#384).
func TestStagedPathGuard_AppliesTheBoundChatPolicy(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "models.json")
	t.Setenv("GO_LLM_CONFIG", config) // missing when the snapshot is cached
	svc := newStagedGuardService(t)
	bindStaged(t, svc, root)
	svc.snapshotOrBuild()
	writeFile(t, config, `{"providers":{},"models":{},"defaults":{}}`)
	writeFile(t, filepath.Join(root, "ai-kit.yaml"), "sensitive_paths:\n  - fixtures/private/**\n")

	guard, configPath, err := svc.StagedPathGuard(root)

	if err != nil {
		t.Fatalf("StagedPathGuard: %v", err)
	}
	if configPath != canonical(t, config) {
		t.Errorf("config path = %q, want %q", configPath, canonical(t, config))
	}
	assertDenied(t, guard, ".env", "keys/deploy.pem", "fixtures/private/customers.csv", "models.json")
	assertAllowed(t, guard, "main.go", "fixtures/public/data.csv")
}

func TestStagedPathGuard_NoBindingIsAnError(t *testing.T) {
	outsideConfig(t)
	svc := newStagedGuardService(t)

	if _, _, err := svc.StagedPathGuard(t.TempDir()); !errors.Is(err, errPolicyDetached) {
		t.Fatalf("StagedPathGuard without a bound repository = %v, want errPolicyDetached", err)
	}
}

func TestStagedPathGuard_IssuedGuardDeniesAfterUnbindOrSwitch(t *testing.T) {
	outsideConfig(t)
	svc := newStagedGuardService(t)
	root := t.TempDir()
	bindStaged(t, svc, root)
	guard, _, err := svc.StagedPathGuard(root)
	if err != nil {
		t.Fatalf("StagedPathGuard: %v", err)
	}
	assertAllowed(t, guard, "main.go")

	bindStaged(t, svc, t.TempDir())
	assertDenied(t, guard, "main.go")

	bindStaged(t, svc, root)
	guard, _, err = svc.StagedPathGuard(root)
	if err != nil {
		t.Fatalf("StagedPathGuard after rebind: %v", err)
	}
	svc.UnbindRepository()
	assertDenied(t, guard, "main.go")
}

// The bound repository may sit below or above the git top level. Paths are
// mapped onto the bound root, and a staged path outside it is denied, because
// chat cannot see it either.
func TestStagedPathGuard_MapsGitTopLevelOntoBoundRoot(t *testing.T) {
	outsideConfig(t)
	t.Run("bound below the top level", func(t *testing.T) {
		top := t.TempDir()
		bound := filepath.Join(top, "app")
		writeFile(t, filepath.Join(bound, "ai-kit.yaml"), "sensitive_paths:\n  - private/**\n")
		svc := newStagedGuardService(t)
		bindStaged(t, svc, bound)

		guard, _, err := svc.StagedPathGuard(top)

		if err != nil {
			t.Fatalf("StagedPathGuard: %v", err)
		}
		assertAllowed(t, guard, "app/main.go")
		assertDenied(t, guard, "app/private/data.csv", "other/main.go", "README.md")
	})
	t.Run("bound above the top level", func(t *testing.T) {
		bound := t.TempDir()
		top := filepath.Join(bound, "repo")
		if err := os.MkdirAll(top, 0o755); err != nil {
			t.Fatal(err)
		}
		writeFile(t, filepath.Join(bound, "ai-kit.yaml"), "sensitive_paths:\n  - repo/private/**\n")
		svc := newStagedGuardService(t)
		bindStaged(t, svc, bound)

		guard, _, err := svc.StagedPathGuard(top)

		if err != nil {
			t.Fatalf("StagedPathGuard: %v", err)
		}
		assertAllowed(t, guard, "main.go")
		assertDenied(t, guard, "private/data.csv", ".env")
	})
}

func TestStagedPathGuard_UnresolvableConfigIsAnError(t *testing.T) {
	outsideConfig(t)
	svc := newStagedGuardService(t)
	root := t.TempDir()
	bindStaged(t, svc, root)
	t.Setenv("GO_LLM_CONFIG", t.TempDir()) // a directory, not a config file

	_, _, err := svc.StagedPathGuard(root)

	if !errors.Is(err, ErrAgentConfigInvalid) {
		t.Fatalf("StagedPathGuard error = %v, want ErrAgentConfigInvalid", err)
	}
}

func TestStagedPathGuard_ClosedServiceIsAnError(t *testing.T) {
	outsideConfig(t)
	svc := NewService(context.Background(), filesystem.NewOS(), "", nil, "")
	root := t.TempDir()
	bindStaged(t, svc, root)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := svc.Close(ctx); err != nil {
		t.Fatalf("Close: %v", err)
	}

	if _, _, err := svc.StagedPathGuard(root); !errors.Is(err, errServiceClosing) {
		t.Fatalf("StagedPathGuard on a closed service = %v, want errServiceClosing", err)
	}
}

// On a case-insensitive filesystem a project opened through a differently
// cased path is the same directory git reports, so paths map one to one.
func TestStagedPathGuard_SameDirectoryInAnotherCaseMapsDirectly(t *testing.T) {
	outsideConfig(t)
	top := filepath.Join(t.TempDir(), "Repo")
	if err := os.MkdirAll(top, 0o755); err != nil {
		t.Fatal(err)
	}
	lower := filepath.Join(filepath.Dir(top), "repo")
	if _, err := os.Stat(lower); err != nil {
		t.Skip("case-sensitive filesystem")
	}
	svc := newStagedGuardService(t)
	bindStaged(t, svc, lower)

	guard, _, err := svc.StagedPathGuard(top)

	if err != nil {
		t.Fatalf("StagedPathGuard: %v", err)
	}
	assertAllowed(t, guard, "main.go")
	assertDenied(t, guard, ".env")
}

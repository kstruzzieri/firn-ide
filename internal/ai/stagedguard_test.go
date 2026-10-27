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

// StagedScope is the bound repository's own chat policy: the floor, the
// manifest rules read now (no watcher event needed), and the go-llm config
// source as discovery finds it now, which the runtime is pinned to (#384).
func TestStagedScope_AppliesTheBoundChatPolicy(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "models.json")
	t.Setenv("GO_LLM_CONFIG", config) // missing when the snapshot is cached
	svc := newStagedGuardService(t)
	bindStaged(t, svc, root)
	svc.snapshotOrBuild()
	writeFile(t, config, `{"providers":{},"models":{},"defaults":{}}`)
	writeFile(t, filepath.Join(root, "ai-kit.yaml"), "sensitive_paths:\n  - fixtures/private/**\n")

	scope, err := svc.StagedScope(root)

	if err != nil {
		t.Fatalf("StagedScope: %v", err)
	}
	if scope.ConfigPath != canonical(t, config) {
		t.Errorf("config path = %q, want %q", scope.ConfigPath, canonical(t, config))
	}
	assertDenied(t, scope.Guard, ".env", "keys/deploy.pem", "fixtures/private/customers.csv", "models.json")
	assertAllowed(t, scope.Guard, "main.go", "fixtures/public/data.csv")
	for _, path := range []string{".env", "fixtures/private/customers.csv"} {
		if !scope.Protected(path) {
			t.Errorf("Protected(%q) = false, want true", path)
		}
	}
	if scope.Protected("main.go") {
		t.Error("Protected(main.go) = true, want false")
	}
}

func TestStagedScope_NoBindingIsAnError(t *testing.T) {
	outsideConfig(t)
	svc := newStagedGuardService(t)

	if _, err := svc.StagedScope(t.TempDir()); !errors.Is(err, errPolicyDetached) {
		t.Fatalf("StagedScope without a bound repository = %v, want errPolicyDetached", err)
	}
}

func TestStagedScope_IssuedGuardDeniesAfterUnbindOrSwitch(t *testing.T) {
	outsideConfig(t)
	svc := newStagedGuardService(t)
	root := t.TempDir()
	bindStaged(t, svc, root)
	scope, err := svc.StagedScope(root)
	if err != nil {
		t.Fatalf("StagedScope: %v", err)
	}
	assertAllowed(t, scope.Guard, "main.go")

	bindStaged(t, svc, t.TempDir())
	assertDenied(t, scope.Guard, "main.go")

	bindStaged(t, svc, root)
	scope, err = svc.StagedScope(root)
	if err != nil {
		t.Fatalf("StagedScope after rebind: %v", err)
	}
	svc.UnbindRepository()
	assertDenied(t, scope.Guard, "main.go")
}

// The bound repository may sit below or above the git top level. Paths are
// mapped onto the bound root, and a staged path outside it is denied, because
// chat cannot see it either.
func TestStagedScope_MapsGitTopLevelOntoBoundRoot(t *testing.T) {
	outsideConfig(t)
	t.Run("bound below the top level", func(t *testing.T) {
		top := t.TempDir()
		bound := filepath.Join(top, "app")
		writeFile(t, filepath.Join(bound, "ai-kit.yaml"), "sensitive_paths:\n  - private/**\n")
		svc := newStagedGuardService(t)
		bindStaged(t, svc, bound)

		scope, err := svc.StagedScope(top)

		if err != nil {
			t.Fatalf("StagedScope: %v", err)
		}
		assertAllowed(t, scope.Guard, "app/main.go")
		assertDenied(t, scope.Guard, "app/private/data.csv", "other/main.go", "README.md")
		// Outside the open project is withheld, but only a path the immutable
		// floor names is protected there, and so a copy source; the
		// manifest's rules describe the project alone.
		for path, want := range map[string]bool{
			"app/private/data.csv": true,
			".env":                 true,
			"certs/server.key":     true,
			"other/main.go":        false,
			"README.md":            false,
			"private/data.csv":     false,
		} {
			if got := scope.Protected(path); got != want {
				t.Errorf("Protected(%q) = %v, want %v", path, got, want)
			}
		}
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

		scope, err := svc.StagedScope(top)

		if err != nil {
			t.Fatalf("StagedScope: %v", err)
		}
		assertAllowed(t, scope.Guard, "main.go")
		assertDenied(t, scope.Guard, "private/data.csv", ".env")
	})
}

func TestStagedScope_UnresolvableConfigIsAnError(t *testing.T) {
	outsideConfig(t)
	svc := newStagedGuardService(t)
	root := t.TempDir()
	bindStaged(t, svc, root)
	t.Setenv("GO_LLM_CONFIG", t.TempDir()) // a directory, not a config file

	_, err := svc.StagedScope(root)

	if !errors.Is(err, ErrAgentConfigInvalid) {
		t.Fatalf("StagedScope error = %v, want ErrAgentConfigInvalid", err)
	}
}

func TestStagedScope_ClosedServiceIsAnError(t *testing.T) {
	outsideConfig(t)
	svc := NewService(context.Background(), filesystem.NewOS(), "", nil, "")
	root := t.TempDir()
	bindStaged(t, svc, root)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := svc.Close(ctx); err != nil {
		t.Fatalf("Close: %v", err)
	}

	if _, err := svc.StagedScope(root); !errors.Is(err, errServiceClosing) {
		t.Fatalf("StagedScope on a closed service = %v, want errServiceClosing", err)
	}
}

// On a case-insensitive filesystem a project opened through a differently
// cased path is the same directory git reports, so paths map one to one.
func TestStagedScope_SameDirectoryInAnotherCaseMapsDirectly(t *testing.T) {
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

	scope, err := svc.StagedScope(top)

	if err != nil {
		t.Fatalf("StagedScope: %v", err)
	}
	assertAllowed(t, scope.Guard, "main.go")
	assertDenied(t, scope.Guard, ".env")
}

// With a subfolder open, the go-llm config source outside it, and any hard
// link to it, is still a protected copy source: a staged copy of models.json
// would carry its API keys.
func TestStagedScope_ConfigSourceOutsideProjectIsProtected(t *testing.T) {
	top := t.TempDir()
	bound := filepath.Join(top, "app")
	if err := os.MkdirAll(bound, 0o755); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(top, "models.json")
	writeFile(t, config, `{"providers":{},"models":{},"defaults":{}}`)
	if err := os.Link(config, filepath.Join(top, "alias.json")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GO_LLM_CONFIG", config)
	svc := newStagedGuardService(t)
	bindStaged(t, svc, bound)

	scope, err := svc.StagedScope(top)

	if err != nil {
		t.Fatalf("StagedScope: %v", err)
	}
	for path, want := range map[string]bool{"models.json": true, "alias.json": true, "README.md": false} {
		if got := scope.Protected(path); got != want {
			t.Errorf("Protected(%q) = %v, want %v", path, got, want)
		}
	}
}

// On a case-insensitive filesystem the config may be named in another case
// than git reports; identity still matches it.
func TestStagedScope_ConfigSourceInAnotherCaseIsProtected(t *testing.T) {
	top := t.TempDir()
	bound := filepath.Join(top, "app")
	if err := os.MkdirAll(bound, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(top, "models.json"), `{"providers":{},"models":{},"defaults":{}}`)
	variant := filepath.Join(top, "MODELS.json")
	if _, err := os.Stat(variant); err != nil {
		t.Skip("case-sensitive filesystem")
	}
	t.Setenv("GO_LLM_CONFIG", variant)
	svc := newStagedGuardService(t)
	bindStaged(t, svc, bound)

	scope, err := svc.StagedScope(top)

	if err != nil {
		t.Fatalf("StagedScope: %v", err)
	}
	if !scope.Protected("models.json") {
		t.Error("Protected(models.json) = false for a config named MODELS.json, want true")
	}
}

// On a case-insensitive filesystem a project opened at a subfolder through
// another case still maps git's paths inside it: the subfolder is found by
// identity and spelled as git reports it.
func TestStagedScope_SubfolderInAnotherCaseMapsByIdentity(t *testing.T) {
	outsideConfig(t)
	top := t.TempDir()
	if err := os.MkdirAll(filepath.Join(top, "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	opened := filepath.Join(top, "APP")
	if _, err := os.Stat(opened); err != nil {
		t.Skip("case-sensitive filesystem")
	}
	svc := newStagedGuardService(t)
	bindStaged(t, svc, opened)

	scope, err := svc.StagedScope(top)

	if err != nil {
		t.Fatalf("StagedScope: %v", err)
	}
	assertAllowed(t, scope.Guard, "app/main.go")
	assertDenied(t, scope.Guard, "app/.env", "README.md", "other/main.go")
	if !scope.Protected("app/.env") || scope.Protected("app/main.go") {
		t.Error("Protected must follow the policy inside the subfolder")
	}
}

package ai

import (
	"context"
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

// StagedPathGuard applies the policy chat applies: the floor, the repository
// manifest's additive rules, and the protected config source (#384).
func TestStagedPathGuard_AppliesChatPolicy(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "ai-kit.yaml"), []byte("sensitive_paths:\n  - fixtures/private/**\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(root, "models.json")
	if err := os.WriteFile(config, []byte(`{"providers":{},"models":{},"defaults":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GO_LLM_CONFIG", config)
	svc := newStagedGuardService(t)

	guard := svc.StagedPathGuard(root)

	for _, denied := range []string{".env", "keys/deploy.pem", "fixtures/private/customers.csv", "models.json"} {
		if err := guard(denied, false); err == nil {
			t.Errorf("guard(%q) = nil, want denied", denied)
		}
	}
	for _, allowed := range []string{"main.go", "fixtures/public/data.csv"} {
		if err := guard(allowed, false); err != nil {
			t.Errorf("guard(%q) = %v, want allowed", allowed, err)
		}
	}
}

func TestStagedPathGuard_MissingRootDeniesAll(t *testing.T) {
	t.Setenv("GO_LLM_CONFIG", "")
	svc := newStagedGuardService(t)

	guard := svc.StagedPathGuard(filepath.Join(t.TempDir(), "gone"))

	if err := guard("main.go", false); err == nil {
		t.Fatal("guard(main.go) = nil for a missing repository root, want denied")
	}
}

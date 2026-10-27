package git

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	agenttools "github.com/kstruzzieri/go-llm/agent/tools"

	"firn/internal/ai"
	"firn/internal/filesystem"
	"firn/internal/git/gittest"
)

// chatPolicy wires the generator to the policy Golem chat applies, loaded from
// the repository's own manifests, so these tests exercise the same matching
// (#384: one policy for both paths).
func chatPolicy(gen *MessageGenerator) {
	gen.SetScopeGuardSource(func(repoRoot string) agenttools.ScopeGuard {
		return ai.LoadScopePolicy(filesystem.NewOS(), repoRoot).Guard("")
	})
}

// noRuntime points golem at a missing config so any runtime bootstrap fails:
// a test using it proves GenerateStaged returned before touching golem.
func noRuntime(t *testing.T) {
	t.Helper()
	t.Setenv("GO_LLM_CONFIG", filepath.Join(t.TempDir(), "missing.json"))
}

const mainGo = "package main\n\nfunc main() { println(\"shipped hunk\") }\n"

// providerRequest is one chat request split into the whole body and the user
// messages Firn authored (instruction plus staged-diff context). go-llm's
// static tool descriptions in the body name ".env" on their own, so file
// names are checked against the user messages and secret content against
// the whole body.
type providerRequest struct {
	body string
	user string
}

func readRequest(t *testing.T, provider *gittest.Provider) providerRequest {
	t.Helper()
	body := <-provider.Requests
	var decoded struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("decode provider request: %v", err)
	}
	var user strings.Builder
	for _, message := range decoded.Messages {
		if message.Role == "user" {
			user.WriteString(message.Content)
			user.WriteString("\n")
		}
	}
	return providerRequest{body: string(body), user: user.String()}
}

// assertWithheld checks that no withheld content reached the provider at all
// and that no withheld name reached the prompt Firn wrote.
func assertWithheld(t *testing.T, request providerRequest, contents []string, names []string) {
	t.Helper()
	for _, content := range contents {
		if strings.Contains(request.body, content) {
			t.Errorf("provider request contains withheld content %q", content)
		}
	}
	for _, name := range names {
		if strings.Contains(request.user, name) {
			t.Errorf("prompt names withheld path %q:\n%s", name, request.user)
		}
	}
}

func TestGenerateStaged_WithholdsFloorDeniedPath(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, ".env", "API_TOKEN=hunter2-must-not-leave\n")
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", ".env", "main.go")
	provider := gittest.Start(t, "feat: add main", nil)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	result, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err != nil {
		t.Fatalf("GenerateStaged() error = %v", err)
	}
	if result.Message != "feat: add main" {
		t.Errorf("Message = %q", result.Message)
	}
	if !slices.Equal(result.Withheld, []string{".env"}) {
		t.Errorf("Withheld = %q, want [.env]", result.Withheld)
	}
	request := readRequest(t, provider)
	if !strings.Contains(request.user, "shipped hunk") {
		t.Errorf("prompt lacks the allowed file's hunk:\n%s", request.user)
	}
	assertWithheld(t, request, []string{"hunter2", "API_TOKEN"}, []string{".env"})
	if !strings.Contains(request.user, "1 staged file was withheld") {
		t.Errorf("prompt does not say one file was withheld:\n%s", request.user)
	}
}

func TestGenerateStaged_HonorsManifestRule(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "ai-kit.yaml", "sensitive_paths:\n  - fixtures/private/**\n")
	writeFile(t, dir, "fixtures/private/customers.csv", "alice@example.test,hidden-row\n")
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", "fixtures", "main.go") // the manifest stays unstaged: it names the path
	provider := gittest.Start(t, "feat: add main", nil)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	result, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err != nil {
		t.Fatalf("GenerateStaged() error = %v", err)
	}
	if !slices.Equal(result.Withheld, []string{"fixtures/private/customers.csv"}) {
		t.Errorf("Withheld = %q", result.Withheld)
	}
	request := readRequest(t, provider)
	if !strings.Contains(request.user, "shipped hunk") {
		t.Errorf("prompt lacks the allowed file's hunk:\n%s", request.user)
	}
	assertWithheld(t, request, []string{"hidden-row"}, []string{"customers.csv", "fixtures/private"})
}

func TestGenerateStaged_WithholdsRenameTouchingProtectedPath(t *testing.T) {
	requireGit(t)
	t.Run("from protected", func(t *testing.T) {
		dir := initRepo(t)
		writeFile(t, dir, ".env", "API_TOKEN=hunter2-must-not-leave\n")
		gitCmd(t, dir, "add", ".env")
		gitCmd(t, dir, "commit", "-m", "add env")
		gitCmd(t, dir, "config", "diff.renames", "false") // detection must not depend on config
		gitCmd(t, dir, "mv", ".env", "config.txt")
		writeFile(t, dir, "main.go", mainGo)
		gitCmd(t, dir, "add", "main.go")
		provider := gittest.Start(t, "feat: add main", nil)
		gen := NewMessageGenerator()
		chatPolicy(gen)

		result, err := gen.GenerateStaged(ctx(), NewService(), dir)

		if err != nil {
			t.Fatalf("GenerateStaged() error = %v", err)
		}
		if !slices.Equal(result.Withheld, []string{".env -> config.txt"}) {
			t.Errorf("Withheld = %q", result.Withheld)
		}
		request := readRequest(t, provider)
		if !strings.Contains(request.user, "shipped hunk") {
			t.Errorf("prompt lacks the allowed file's hunk:\n%s", request.user)
		}
		assertWithheld(t, request, []string{"hunter2"}, []string{".env", "config.txt"})
	})
	t.Run("to protected", func(t *testing.T) {
		dir := initRepo(t)
		writeFile(t, dir, "notes.txt", "plain note\n")
		gitCmd(t, dir, "add", "notes.txt")
		gitCmd(t, dir, "commit", "-m", "add notes")
		if err := os.MkdirAll(filepath.Join(dir, "secrets"), 0o755); err != nil {
			t.Fatal(err)
		}
		gitCmd(t, dir, "mv", "notes.txt", "secrets/notes.txt")
		writeFile(t, dir, "main.go", mainGo)
		gitCmd(t, dir, "add", "main.go")
		provider := gittest.Start(t, "feat: add main", nil)
		gen := NewMessageGenerator()
		chatPolicy(gen)

		result, err := gen.GenerateStaged(ctx(), NewService(), dir)

		if err != nil {
			t.Fatalf("GenerateStaged() error = %v", err)
		}
		if !slices.Equal(result.Withheld, []string{"notes.txt -> secrets/notes.txt"}) {
			t.Errorf("Withheld = %q", result.Withheld)
		}
		request := readRequest(t, provider)
		assertWithheld(t, request, []string{"plain note"}, []string{"notes.txt", "secrets"})
	})
}

func TestGenerateStaged_AllowedRenameKeepsBothSides(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	gitCmd(t, dir, "config", "diff.renames", "false")
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "mv", "README.md", "docs/README.md")
	provider := gittest.Start(t, "docs: move readme", nil)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	result, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err != nil {
		t.Fatalf("GenerateStaged() error = %v", err)
	}
	if len(result.Withheld) != 0 {
		t.Errorf("Withheld = %q, want none", result.Withheld)
	}
	request := readRequest(t, provider)
	if !strings.Contains(request.user, "rename from README.md") || !strings.Contains(request.user, "rename to docs/README.md") {
		t.Errorf("prompt does not show the rename:\n%s", request.user)
	}
}

func TestGenerateStaged_AllWithheldMakesNoRequest(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, ".env", "API_TOKEN=hunter2\n")
	writeFile(t, dir, "deploy.key", "-----BEGIN PRIVATE KEY-----\n")
	gitCmd(t, dir, "add", ".env", "deploy.key")
	noRuntime(t)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	result, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err != nil {
		t.Fatalf("GenerateStaged() error = %v, want no error and no request", err)
	}
	if result.Message != "" {
		t.Errorf("Message = %q, want empty", result.Message)
	}
	if !slices.Equal(result.Withheld, []string{".env", "deploy.key"}) {
		t.Errorf("Withheld = %q", result.Withheld)
	}
}

// Fail closed where chat fails closed: a manifest past the rule limit denies
// every path in chat, so it withholds every staged path here too.
func TestGenerateStaged_ManifestOverflowWithholdsEverything(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "ai-kit.yaml", "sensitive_paths:\n"+strings.Repeat("  - fixtures/x\n", 513))
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", "main.go")
	noRuntime(t)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	result, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err != nil {
		t.Fatalf("GenerateStaged() error = %v", err)
	}
	if result.Message != "" || !slices.Equal(result.Withheld, []string{"main.go"}) {
		t.Errorf("result = %+v, want everything withheld", result)
	}
}

// No policy source wired is the detached case: nothing may reach the model.
func TestGenerateStaged_NoPolicySourceWithholdsEverything(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", "main.go")
	noRuntime(t)

	result, err := NewMessageGenerator().GenerateStaged(ctx(), NewService(), dir)

	if err != nil {
		t.Fatalf("GenerateStaged() error = %v", err)
	}
	if result.Message != "" || !slices.Equal(result.Withheld, []string{"main.go"}) {
		t.Errorf("result = %+v, want everything withheld", result)
	}
}

func TestGenerateStaged_NothingStaged(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	noRuntime(t)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	_, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err == nil || !strings.Contains(err.Error(), "nothing staged") {
		t.Fatalf("GenerateStaged() error = %v, want nothing-staged error", err)
	}
}

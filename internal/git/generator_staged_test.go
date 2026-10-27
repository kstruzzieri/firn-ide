package git

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
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
	gen.SetScopeGuardSource(func(repoRoot string) (agenttools.ScopeGuard, string, error) {
		return ai.LoadScopePolicy(filesystem.NewOS(), repoRoot).Guard(""), "", nil
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

// assertWithheld checks that no withheld content reached the provider at all,
// that no withheld name reached the prompt Firn wrote, and that no diff header
// for a withheld name appears anywhere in the request.
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
		for _, header := range []string{"a/" + name, "b/" + name, "from " + name, "to " + name} {
			if strings.Contains(request.body, header) {
				t.Errorf("provider request carries diff header %q", header)
			}
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

// A tracked file replaced by a directory: the deletion is allowed, but its
// literal pathspec also selects the new directory's contents, so a withheld
// descendant must be excluded explicitly.
func TestGenerateStaged_KeepsWithheldDescendantOutOfAllowedPathspec(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "config", "plain config\n")
	gitCmd(t, dir, "add", "config")
	gitCmd(t, dir, "commit", "-m", "add config")
	gitCmd(t, dir, "rm", "-q", "config")
	writeFile(t, dir, "config/.env", "TOKEN=leak-descendant\n")
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", "config/.env", "main.go")
	provider := gittest.Start(t, "chore: replace config", nil)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	result, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err != nil {
		t.Fatalf("GenerateStaged() error = %v", err)
	}
	if !slices.Equal(result.Withheld, []string{"config/.env"}) {
		t.Errorf("Withheld = %q", result.Withheld)
	}
	request := readRequest(t, provider)
	if !strings.Contains(request.user, "shipped hunk") || !strings.Contains(request.user, "deleted file") {
		t.Errorf("prompt lacks the allowed changes:\n%s", request.user)
	}
	assertWithheld(t, request, []string{"leak-descendant"}, []string{"config/.env"})
}

func TestGenerateStaged_WithholdsCopyOfProtectedFile(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, ".env", "API_TOKEN=copied-secret\n")
	gitCmd(t, dir, "add", ".env")
	gitCmd(t, dir, "commit", "-m", "add env")
	writeFile(t, dir, "config.txt", "API_TOKEN=copied-secret\n")
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", "config.txt", "main.go")
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
	assertWithheld(t, readRequest(t, provider), []string{"copied-secret"}, []string{"config.txt"})
}

// Repository config must not be able to add content the guard never saw: an
// external diff, a textconv filter, or a submodule expanded into its own diff.
func TestGenerateStaged_IgnoresDiffHelpersAndSubmoduleExpansion(t *testing.T) {
	requireGit(t)
	const secret = "API_TOKEN=helper-leak"
	cases := map[string]func(t *testing.T, dir string){
		"diff.external": func(t *testing.T, dir string) {
			gitCmd(t, dir, "config", "diff.external", "cat .env;:")
			writeFile(t, dir, "main.go", mainGo)
			gitCmd(t, dir, "add", "main.go")
		},
		"textconv": func(t *testing.T, dir string) {
			writeFile(t, dir, ".gitattributes", "*.go diff=leak\n")
			gitCmd(t, dir, "add", ".gitattributes")
			gitCmd(t, dir, "commit", "-m", "attributes")
			gitCmd(t, dir, "config", "diff.leak.textconv", "cat .env;:")
			writeFile(t, dir, "main.go", mainGo)
			gitCmd(t, dir, "add", "main.go")
		},
		"diff.submodule=diff": func(t *testing.T, dir string) {
			sub := filepath.Join(dir, "sub")
			if err := os.MkdirAll(sub, 0o755); err != nil {
				t.Fatal(err)
			}
			gitCmd(t, sub, "init", "-q", "-b", "main")
			writeFile(t, sub, "lib.go", "package lib\n")
			gitCmd(t, sub, "add", "lib.go")
			gitCmd(t, sub, "commit", "-m", "lib")
			gitCmd(t, dir, "add", "sub")
			gitCmd(t, dir, "commit", "-m", "add sub")
			writeFile(t, sub, ".env", secret+"\n")
			gitCmd(t, sub, "add", ".env")
			gitCmd(t, sub, "commit", "-m", "env")
			gitCmd(t, dir, "config", "diff.submodule", "diff")
			gitCmd(t, dir, "add", "sub")
		},
	}
	for name, stage := range cases {
		t.Run(name, func(t *testing.T) {
			dir := initRepo(t)
			writeFile(t, dir, ".env", secret+"\n") // unstaged, in the worktree
			stage(t, dir)
			provider := gittest.Start(t, "chore: update", nil)
			gen := NewMessageGenerator()
			chatPolicy(gen)

			if _, err := gen.GenerateStaged(ctx(), NewService(), dir); err != nil {
				t.Fatalf("GenerateStaged() error = %v", err)
			}
			assertWithheld(t, readRequest(t, provider), []string{"helper-leak"}, nil)
		})
	}
}

// The runtime loads the config source the guard protected, not whatever its
// own discovery finds later.
func TestGenerateStaged_PinsRuntimeToGuardedConfig(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", "main.go")
	provider := gittest.Start(t, "feat: pinned", nil)
	pinned := os.Getenv("GO_LLM_CONFIG")
	noRuntime(t)
	gen := NewMessageGenerator()
	gen.SetScopeGuardSource(func(repoRoot string) (agenttools.ScopeGuard, string, error) {
		return ai.LoadScopePolicy(filesystem.NewOS(), repoRoot).Guard(""), pinned, nil
	})

	result, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err != nil || result.Message != "feat: pinned" {
		t.Fatalf("GenerateStaged() = %+v, %v, want the pinned config's answer", result, err)
	}
	if len(provider.Requests) != 1 {
		t.Errorf("provider requests = %d, want 1", len(provider.Requests))
	}
}

func TestGenerateStaged_GuardSourceErrorMakesNoRequest(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", "main.go")
	noRuntime(t)
	gen := NewMessageGenerator()
	gen.SetScopeGuardSource(func(string) (agenttools.ScopeGuard, string, error) {
		return nil, "", errors.New("reopen the repository")
	})

	_, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err == nil || !strings.Contains(err.Error(), "reopen the repository") {
		t.Fatalf("GenerateStaged() error = %v, want the guard source's error", err)
	}
}

// A policy that starts denying after the paths were checked (the repository
// was detached or its rules changed) stops the request.
func TestGenerateStaged_PolicyChangeBeforeSendMakesNoRequest(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", "main.go")
	noRuntime(t)
	// Listing and checking make the same guard calls on both passes, so a
	// full run (which then fails at the missing runtime) is counted and the
	// policy denies from the second pass on.
	var calls atomic.Int32
	gen := NewMessageGenerator()
	gen.SetScopeGuardSource(func(string) (agenttools.ScopeGuard, string, error) {
		return func(string, bool) error { calls.Add(1); return nil }, "", nil
	})
	if _, err := gen.GenerateStaged(ctx(), NewService(), dir); err == nil || errors.Is(err, errStagedChangesMoved) {
		t.Fatalf("counting run error = %v, want the missing-runtime failure", err)
	}
	firstPass := calls.Load() / 2
	calls.Store(0)
	gen.SetScopeGuardSource(func(string) (agenttools.ScopeGuard, string, error) {
		return func(string, bool) error {
			if calls.Add(1) > firstPass {
				return errors.New("detached")
			}
			return nil
		}, "", nil
	})

	_, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if !errors.Is(err, errStagedChangesMoved) {
		t.Fatalf("GenerateStaged() error = %v, want errStagedChangesMoved", err)
	}
}

// Staging after the paths were checked could put an unchecked path under an
// allowed directory pathspec, so a changed index stops the request.
func TestGenerateStaged_IndexChangeBeforeSendMakesNoRequest(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, "main.go", mainGo)
	writeFile(t, dir, "late.txt", "staged late\n")
	gitCmd(t, dir, "add", "main.go")
	noRuntime(t)
	var staged atomic.Bool
	gen := NewMessageGenerator()
	gen.SetScopeGuardSource(func(repoRoot string) (agenttools.ScopeGuard, string, error) {
		guard := ai.LoadScopePolicy(filesystem.NewOS(), repoRoot).Guard("")
		return func(rel string, write bool) error {
			if staged.CompareAndSwap(false, true) {
				gitCmd(t, dir, "add", "late.txt")
			}
			return guard(rel, write)
		}, "", nil
	})

	_, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if !errors.Is(err, errStagedChangesMoved) {
		t.Fatalf("GenerateStaged() error = %v, want errStagedChangesMoved", err)
	}
}

// Past diff.renameLimit git silently stops pairing modified renames, so a
// modified .env rename would list as an ordinary addition. That fails closed.
func TestGenerateStaged_SkippedRenameDetectionMakesNoRequest(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, ".env", "A=1\nB=2\nC=3\nD=4\n")
	gitCmd(t, dir, "add", ".env")
	gitCmd(t, dir, "commit", "-m", "add env")
	gitCmd(t, dir, "rm", "-q", ".env")
	writeFile(t, dir, "config/app.env.txt", "A=1\nB=2\nC=3\nD=5\n")
	writeFile(t, dir, "new.txt", "x\n")
	gitCmd(t, dir, "add", "config", "new.txt")
	gitCmd(t, dir, "config", "diff.renameLimit", "1")
	noRuntime(t)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	_, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if !errors.Is(err, ErrRenameDetectionLimited) {
		t.Fatalf("GenerateStaged() error = %v, want ErrRenameDetectionLimited", err)
	}
}

// With more unmodified files than diff.renameLimit, a repository-wide
// --find-copies-harder pass drops unmodified copy sources. The protected file
// is checked as a copy source directly, so an edited copy of a committed .env
// is still withheld as a copy.
func TestGenerateStaged_WithholdsInexactCopyPastRenameLimit(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, ".env", "A=1\nB=2\nC=3\nD=4\nAPI_TOKEN=inexact-copy\n")
	for i := range 5 {
		writeFile(t, dir, fmt.Sprintf("filler-%d.txt", i), fmt.Sprintf("filler %d\n", i))
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "add env and fillers")
	writeFile(t, dir, "config.txt", "A=1\nB=2\nC=3\nD=9\nAPI_TOKEN=inexact-copy\n")
	writeFile(t, dir, "main.go", mainGo)
	gitCmd(t, dir, "add", "config.txt", "main.go")
	gitCmd(t, dir, "config", "diff.renameLimit", "3")
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
	assertWithheld(t, readRequest(t, provider), []string{"inexact-copy"}, []string{"config.txt"})
}

// When even the protected-source check exceeds diff.renameLimit, nothing is
// sent.
func TestGenerateStaged_LimitedCopyCheckMakesNoRequest(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, ".env", "API_TOKEN=one\n")
	writeFile(t, dir, "deploy.key", "KEY=two\n")
	gitCmd(t, dir, "add", ".env", "deploy.key")
	gitCmd(t, dir, "commit", "-m", "add secrets")
	writeFile(t, dir, "config.txt", "API_TOKEN=one\nmore\n")
	gitCmd(t, dir, "add", "config.txt")
	gitCmd(t, dir, "config", "diff.renameLimit", "1")
	noRuntime(t)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	_, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if !errors.Is(err, ErrRenameDetectionLimited) {
		t.Fatalf("GenerateStaged() error = %v, want ErrRenameDetectionLimited", err)
	}
}

// The protected-source copy check passes every added path to git, so it runs
// in batches that fit a Windows command line; a copy in the last batch is
// still found.
func TestGenerateStaged_FindsProtectedCopyAcrossBatches(t *testing.T) {
	requireGit(t)
	dir := initRepo(t)
	writeFile(t, dir, ".env", "A=1\nB=2\nC=3\nD=4\nAPI_TOKEN=batched-copy\n")
	gitCmd(t, dir, "add", ".env")
	gitCmd(t, dir, "commit", "-m", "add env")
	const added = 1500
	for i := range added {
		writeFile(t, dir, fmt.Sprintf("vendor/package-%04d/file.txt", i), fmt.Sprintf("file %d\n", i))
	}
	writeFile(t, dir, "vendor/zzz-last/settings.txt", "A=1\nB=2\nC=3\nD=9\nAPI_TOKEN=batched-copy\n")
	gitCmd(t, dir, "add", "vendor")
	provider := gittest.Start(t, "chore: vendor", nil)
	gen := NewMessageGenerator()
	chatPolicy(gen)

	result, err := gen.GenerateStaged(ctx(), NewService(), dir)

	if err != nil {
		t.Fatalf("GenerateStaged() error = %v", err)
	}
	if !slices.Equal(result.Withheld, []string{".env -> vendor/zzz-last/settings.txt"}) {
		t.Errorf("Withheld = %q", result.Withheld)
	}
	assertWithheld(t, readRequest(t, provider), []string{"batched-copy"}, []string{"settings.txt"})
}

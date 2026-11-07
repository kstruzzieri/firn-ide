package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kstruzzieri/go-llm/provider"

	"firn/internal/filesystem"
)

// #491: commit messages send only to the Golem model, the target Golem chat
// resolves from the configuration it has loaded.

// golemModelConfig is a one-model agent config on endpoint, naming modelName
// and declaring window (0 omits context_window).
func golemModelConfig(endpoint, modelName string, window int) string {
	contextWindow := ""
	if window != 0 {
		contextWindow = fmt.Sprintf(`"context_window": %d, `, window)
	}
	return fmt.Sprintf(`{
  "providers": {"hosted": {"base_url": %q, "api_format": "openai-compat", "timeout": "2s"}},
  "models": {"agent-m": {"name": %q, "provider": "hosted", "type": "dense", %s"capabilities": ["chat", "stream", "tool_call"]}},
  "defaults": {"agent": "agent-m"}
}`, endpoint, modelName, contextWindow)
}

// newGolemModelService is a Service on the config at path (GO_LLM_CONFIG),
// bound to a fresh repository, with its repository identity.
func newGolemModelService(t *testing.T, path string) (*Service, RepositoryIdentity, string) {
	t.Helper()
	sandboxAgentConfigEnv(t)
	t.Setenv("GO_LLM_CONFIG", path)
	svc := NewService(context.Background(), filesystem.NewOS(),
		filepath.Join(t.TempDir(), "consent", "grants.json"), (&emitRecorder{}).emit, "")
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := svc.Close(ctx); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	repo := newRepo(t)
	id, _, err := svc.BindRepository(repo)
	if err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
	return svc, id, repo
}

// stagedModel is the model StagedScope hands commit generation.
func stagedModel(t *testing.T, svc *Service, repo string) *GolemModel {
	t.Helper()
	scope, err := svc.StagedScope(repo)
	if err != nil {
		t.Fatalf("StagedScope: %v", err)
	}
	if scope.Release != nil {
		t.Cleanup(scope.Release)
	}
	if scope.Model == nil {
		t.Fatal("StagedScope returned no model")
	}
	return scope.Model
}

// An edit made outside Firn reaches neither chat nor commit messages until
// Refresh; after it, both use the new model.
func TestStagedScopeSendsToTheModelChatHasLoaded(t *testing.T) {
	path := writeAgentConfigBody(t, golemModelConfig("http://127.0.0.1:1", "first-model", 32768))
	svc, id, repo := newGolemModelService(t, path)
	models := func() (chat, commit string) {
		t.Helper()
		st, err := svc.Status(StatusRequest{RepoEpoch: id.RepoEpoch, WorkspaceID: "project"})
		if err != nil || st.Destination == nil {
			t.Fatalf("Status = %+v, %v", st, err)
		}
		return st.Destination.Model, stagedModel(t, svc, repo).target.model.Name
	}

	if chat, commit := models(); chat != "first-model" || commit != "first-model" {
		t.Fatalf("chat/commit = %q/%q, want first-model for both", chat, commit)
	}
	if err := os.WriteFile(path, []byte(golemModelConfig("http://127.0.0.1:1", "second-model", 32768)), 0o600); err != nil {
		t.Fatal(err)
	}
	if chat, commit := models(); chat != "first-model" || commit != "first-model" {
		t.Fatalf("after an outside edit chat/commit = %q/%q, want first-model until Refresh", chat, commit)
	}
	if res, err := svc.ReloadSettings(); err != nil || res.Busy {
		t.Fatalf("ReloadSettings = %+v, %v", res, err)
	}
	if chat, commit := models(); chat != "second-model" || commit != "second-model" {
		t.Fatalf("after Refresh chat/commit = %q/%q, want second-model for both", chat, commit)
	}
}

// A configuration chat cannot run refuses generation with chat's reason.
func TestStagedScopeRefusesWithChatsReason(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"no agent setting", `{
  "providers": {"hosted": {"base_url": "http://127.0.0.1:1", "api_format": "openai-compat"}},
  "models": {"m": {"name": "m", "provider": "hosted", "type": "dense", "capabilities": ["chat", "stream", "tool_call"]}},
  "defaults": {}
}`},
		{"agent model misses the floor", `{
  "providers": {"hosted": {"base_url": "http://127.0.0.1:1", "api_format": "openai-compat"}},
  "models": {"m": {"name": "m", "provider": "hosted", "type": "dense", "capabilities": ["chat", "stream"]}},
  "defaults": {"agent": "m"}
}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, id, repo := newGolemModelService(t, writeAgentConfigBody(t, tc.body))
			st, err := svc.Status(StatusRequest{RepoEpoch: id.RepoEpoch, WorkspaceID: "project"})
			if err != nil || st.Available {
				t.Fatalf("Status = %+v, %v, want chat unavailable", st, err)
			}

			scope, err := svc.StagedScope(repo)

			if err == nil || scope.Model != nil {
				t.Fatalf("StagedScope = %+v, %v, want chat's refusal", scope, err)
			}
			if !errors.Is(err, ErrAgentConfigInvalid) || SanitizeError(err).Message != st.InitError {
				t.Fatalf("StagedScope error = %v (public %q), want chat's %q", err, SanitizeError(err).Message, st.InitError)
			}
		})
	}
}

// A remote destination generation reaches needs the grant chat needs; the
// denial is go-llm's typed one, so the generator words it as it always has.
func TestGolemModelOptionsRefuseAnUngrantedRemote(t *testing.T) {
	endpoint, requests := startCountingServer(t)
	svc, _, repo := newGolemModelService(t, writeAgentConfigBody(t, golemModelConfig(endpoint, "wire-model", 32768)))
	model := stagedModel(t, svc, repo)

	_, err := model.Options()

	var denied *provider.DestinationDeniedError
	if !errors.As(err, &denied) || !errors.Is(err, provider.ErrDestinationDenied) {
		t.Fatalf("Options() error = %v, want the typed destination denial", err)
	}
	canonical, _, err := NormalizeEndpoint(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	if denied.Destination.Provider() != "hosted" || denied.Destination.String() != "hosted/"+canonical || denied.Purpose != "agent" {
		t.Fatalf("denial = %+v, want hosted at %s for agent", denied, canonical)
	}

	if err := svc.consent.Grant(model.target.destination); err != nil {
		t.Fatalf("Grant: %v", err)
	}
	opts, err := model.Options()
	if err != nil || opts.Orchestrator == nil {
		t.Fatalf("Options() after the grant = %+v, %v, want an orchestrator", opts, err)
	}
	if got := *requests; got != 0 {
		t.Fatalf("building the options sent %d request(s)", got)
	}
}

// The input budget follows the model's declared window as chat's does, and a
// window too small to budget is refused, never defaulted.
func TestGolemModelOptionsBudgetFollowsTheWindow(t *testing.T) {
	for _, tc := range []struct {
		window, want int
		refused      bool
	}{
		{window: 0, want: 0},
		{window: 1024, want: 768},
		{window: 32768, want: 24576},
		{window: 262144, want: 24576},
		{window: 4, want: 3},
		{window: 3, refused: true},
		{window: 1, refused: true},
	} {
		t.Run(fmt.Sprint(tc.window), func(t *testing.T) {
			svc, _, repo := newGolemModelService(t, writeAgentConfigBody(t, golemModelConfig("http://127.0.0.1:1", "wire-model", tc.window)))
			model := stagedModel(t, svc, repo)
			if model.ContextWindow() != tc.window {
				t.Fatalf("ContextWindow() = %d, want %d", model.ContextWindow(), tc.window)
			}

			opts, err := model.Options()

			if tc.refused {
				if !errors.Is(err, ErrContextWindowTooSmall) {
					t.Fatalf("Options() = %+v, %v, want ErrContextWindowTooSmall", opts.Budget, err)
				}
				return
			}
			if err != nil || opts.Budget.InputCeiling != tc.want {
				t.Fatalf("Options() budget = %+v, %v, want input ceiling %d", opts.Budget, err, tc.want)
			}
		})
	}
}

// hybridCCJSON is shaped like the hybrid-cc profile: the agent's model is
// GLM-5.2 on Command Code, whose fallbacks reach other hosted providers.
const hybridCCJSON = `{
  "providers": {
    "commandcode": {"base_url": "https://api.commandcode.ai/provider/v1", "api_format": "openai-compat"},
    "opencode": {"base_url": "https://opencode.ai/zen/go", "api_format": "openai-compat"},
    "zai": {"base_url": "https://api.z.ai/api/coding/paas/v4", "api_format": "openai-compat"},
    "lan": {"base_url": "http://127.0.0.1:11434", "api_format": "ollama"}
  },
  "models": {
    "fast": {"name": "zai-org/GLM-5.2", "provider": "commandcode", "type": "dense", "context_window": 202752,
      "capabilities": ["chat", "stream", "tool_call"], "fallbacks": ["fast-go", "fast-zai"]},
    "fast-go": {"name": "glm-5.2", "provider": "opencode", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"], "fallbacks": ["fast-local"]},
    "fast-zai": {"name": "glm-5.2", "provider": "zai", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "fast-local": {"name": "qwen3-coder-next:latest", "provider": "lan", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]}
  },
  "defaults": {"agent": "fast"}
}`

// Approving the Golem model's destinations names Command Code alone, none of
// the destinations only the golem CLI's fallbacks reach.
func TestApprovalNamesOnlyTheGolemModelsDestination(t *testing.T) {
	h := newApplyHarness(t, hybridCCJSON)

	res := h.prepareGrants(t)

	if res.Status != "consent_required" {
		t.Fatalf("prepare = %+v, want consent_required", res)
	}
	assertGrantDestinations(t, res.Challenge.Destinations, ApplyDestination{
		Provider: "commandcode", Model: "zai-org/GLM-5.2", Endpoint: "https://api.commandcode.ai/provider/v1",
		Classification: "remote", Provenance: []string{"agent"},
	})
}

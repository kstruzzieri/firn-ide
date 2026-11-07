package ai

import (
	"bytes"
	"log"
	"slices"
	"strings"
	"testing"

	"github.com/kstruzzieri/go-llm/config"
)

func reachableFixtureConfig() *config.Config {
	return &config.Config{
		Providers: map[string]config.ProviderConfig{
			"hosted": {BaseURL: "https://api.example.com/v1", APIFormat: "openai-compat"},
			"backup": {BaseURL: "https://alt.example.net", APIFormat: "openai-compat"},
			"local":  {BaseURL: "http://127.0.0.1:11434", APIFormat: "ollama"},
		},
		Models: map[string]config.ModelConfig{
			"agent-m":   {Name: "front", Provider: "hosted", Type: "dense", Capabilities: []string{"chat", "stream", "tool_call"}, Fallbacks: []string{"agent-fb"}},
			"agent-fb":  {Name: "spare", Provider: "backup", Type: "dense", Capabilities: []string{"chat", "stream", "tool_call"}},
			"unrelated": {Name: "digest", Provider: "local", Type: "dense", Capabilities: []string{"chat", "stream"}},
		},
		Defaults: map[string]string{"agent": "agent-m"},
	}
}

// #491: Golem chat and commit messages send to the agent's primary model
// alone, so its destination is the whole set; a fallback is never reached.
func TestReachableDestinationsAreTheGolemModel(t *testing.T) {
	got := reachableDestinations(reachableFixtureConfig())

	want := []ReachableDestination{{
		Destination: ProviderDestination{
			Provider: "hosted", Model: "front", Endpoint: "https://api.example.com/v1",
			Classification: "remote", Digest: destinationDigest("hosted", "https://api.example.com/v1"),
		},
		Hops: []ReachableHop{{UseCase: "agent", Source: "agent"}},
	}}
	if !slices.EqualFunc(got, want, func(a, b ReachableDestination) bool {
		return a.Destination == b.Destination && slices.Equal(a.Hops, b.Hops)
	}) {
		t.Fatalf("reachable = %+v, want the agent model alone %+v", got, want)
	}
}

// A configuration chat cannot run reaches nothing: no agent setting (go-llm's
// recommendation route is the golem CLI's alone now), an unknown role, a
// model that misses agent's floor, or no configuration.
func TestReachableDestinationsEmptyWhenChatCannotRun(t *testing.T) {
	for name, edit := range map[string]func(*config.Config){
		"no agent setting": func(cfg *config.Config) { delete(cfg.Defaults, "agent") },
		"unknown role":     func(cfg *config.Config) { cfg.Defaults["agent"] = "no-such-role" },
		"misses the floor": func(cfg *config.Config) {
			m := cfg.Models["agent-m"]
			m.Capabilities = []string{"chat", "stream"}
			cfg.Models["agent-m"] = m
		},
	} {
		t.Run(name, func(t *testing.T) {
			cfg := reachableFixtureConfig()
			edit(cfg)
			if _, err := ResolveAgentTarget(cfg); err == nil {
				t.Fatal("fixture: chat would run this configuration")
			}
			if got := reachableDestinations(cfg); len(got) != 0 {
				t.Fatalf("reachable = %+v, want none", got)
			}
		})
	}
	if got := reachableDestinations(nil); len(got) != 0 {
		t.Fatalf("nil config: %+v", got)
	}
}

// #286 item 1: an agent endpoint that cannot be canonicalized reaches nothing,
// and the host log names the provider, never the base URL (it may carry
// userinfo credentials or a query like this fixture's).
func TestReachableUnusableEndpointIsLogged(t *testing.T) {
	cfg := reachableFixtureConfig()
	cfg.Providers["hosted"] = config.ProviderConfig{
		BaseURL:   "https://api.example.com/v1?tenant=secret",
		APIFormat: "openai-compat",
	}

	var logs bytes.Buffer
	previousLog := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previousLog) })

	if got := reachableDestinations(cfg); len(got) != 0 {
		t.Fatalf("reachable = %+v, want none", got)
	}
	out := logs.String()
	if !strings.Contains(out, "endpoint rejected") {
		t.Fatalf("log missing the rejection: %q", out)
	}
	if strings.Contains(out, "tenant=secret") {
		t.Fatalf("log must never leak the endpoint query: %q", out)
	}
}

func TestRenderHop(t *testing.T) {
	if got := renderHop(ReachableHop{UseCase: "agent", Source: "agent"}); got != "agent" {
		t.Fatalf("direct: %q", got)
	}
	if got := renderHop(ReachableHop{UseCase: "agent", Source: "fast"}); got != "agent via defaults.fast" {
		t.Fatalf("via: %q", got)
	}
}

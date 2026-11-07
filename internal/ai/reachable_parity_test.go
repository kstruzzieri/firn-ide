package ai

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/kstruzzieri/go-llm/config"
)

// writeParityConfig writes a models.json fixture and returns its path.
func writeParityConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "models.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// explicitRouteParityConfig: agent -> A only.
func explicitRouteParityConfig(remoteA, _, _ string) string {
	return fmt.Sprintf(`{
		"providers": {
			"A": {"base_url": %q, "api_format": "openai-compat", "timeout": "2s"}
		},
		"models": {
			"agent-model": {"name": "agent-model", "provider": "A", "type": "dense", "context_window": 32768, "capabilities": ["chat", "stream", "tool_call"]}
		},
		"defaults": {"agent": "agent-model"}
	}`, remoteA)
}

// transitiveFallbacksParityConfig: agent -> A, fallback -> B.
func transitiveFallbacksParityConfig(remoteA, remoteB, _ string) string {
	return fmt.Sprintf(`{
		"providers": {
			"A": {"base_url": %q, "api_format": "openai-compat", "timeout": "2s"},
			"B": {"base_url": %q, "api_format": "openai-compat", "timeout": "2s"}
		},
		"models": {
			"agent-model": {"name": "agent-model", "provider": "A", "type": "dense", "context_window": 32768, "capabilities": ["chat", "stream", "tool_call"], "fallbacks": ["fallback-model"]},
			"fallback-model": {"name": "fallback-model", "provider": "B", "type": "dense", "context_window": 32768, "capabilities": ["chat", "stream", "tool_call"]}
		},
		"defaults": {"agent": "agent-model"}
	}`, remoteA, remoteB)
}

// absentAgentBindingParityConfig: no defaults.agent. The golem CLI reaches A
// and B through its recommendation route (upstream I8); chat refuses it.
func absentAgentBindingParityConfig(remoteA, remoteB, _ string) string {
	return fmt.Sprintf(`{
		"providers": {
			"A": {"base_url": %q, "api_format": "openai-compat", "timeout": "2s"},
			"B": {"base_url": %q, "api_format": "openai-compat", "timeout": "2s"}
		},
		"models": {
			"model-a": {"name": "model-a", "provider": "A", "type": "dense", "context_window": 32768, "capabilities": ["chat", "stream", "tool_call"]},
			"model-b": {"name": "model-b", "provider": "B", "type": "dense", "context_window": 32768, "capabilities": ["chat", "stream", "tool_call"]}
		},
		"defaults": {}
	}`, remoteA, remoteB)
}

// sharedDestinationParityConfig: two roles on the SAME provider A; agent ->
// role1, fallback -> role2. Both hops collapse to one destination.
func sharedDestinationParityConfig(remoteA, _, _ string) string {
	return fmt.Sprintf(`{
		"providers": {
			"A": {"base_url": %q, "api_format": "openai-compat", "timeout": "2s"}
		},
		"models": {
			"role1": {"name": "role1-model", "provider": "A", "type": "dense", "context_window": 32768, "capabilities": ["chat", "stream", "tool_call"], "fallbacks": ["role2"]},
			"role2": {"name": "role2-model", "provider": "A", "type": "dense", "context_window": 32768, "capabilities": ["chat", "stream", "tool_call"]}
		},
		"defaults": {"agent": "role1"}
	}`, remoteA)
}

// isolatedPlanningParityConfig: agent -> A; defaults.planning -> C, a route
// neither chat nor commit generation ever sends to.
func isolatedPlanningParityConfig(remoteA, _, remoteC string) string {
	return fmt.Sprintf(`{
		"providers": {
			"A": {"base_url": %q, "api_format": "openai-compat", "timeout": "2s"},
			"C": {"base_url": %q, "api_format": "openai-compat", "timeout": "2s"}
		},
		"models": {
			"agent-model": {"name": "agent-model", "provider": "A", "type": "dense", "context_window": 32768, "capabilities": ["chat", "stream", "tool_call"]},
			"planning-model": {"name": "planning-model", "provider": "C", "type": "dense", "context_window": 32768, "capabilities": ["chat", "stream", "tool_call"]}
		},
		"defaults": {"agent": "agent-model", "planning": "planning-model"}
	}`, remoteA, remoteC)
}

// F15 (#491): Golem chat and commit generation both send to the one target
// chat resolves, through a caller with no router and no fallback, so for
// every case of the corpus the approval set is exactly that target; a
// configuration chat refuses (no agent setting) approves nothing.
func TestReachableSetIsTheGolemModel(t *testing.T) {
	corpus := []struct {
		name       string
		modelsJSON func(remoteA, remoteB, remoteC string) string
	}{
		{"explicit-route", explicitRouteParityConfig},
		{"transitive-fallbacks", transitiveFallbacksParityConfig},
		{"absent-agent-binding", absentAgentBindingParityConfig},
		{"shared-destination", sharedDestinationParityConfig},
		{"isolated-planning", isolatedPlanningParityConfig},
	}
	for _, tc := range corpus {
		t.Run(tc.name, func(t *testing.T) {
			path := writeParityConfig(t, tc.modelsJSON(
				"http://firn-parity-a.invalid",
				"http://firn-parity-b.invalid",
				"http://firn-parity-c.invalid",
			))
			doc, err := config.LoadDocument(path)
			if err != nil {
				t.Fatalf("LoadDocument: %v", err)
			}
			got := reachableDestinations(doc.Config())
			target, err := ResolveAgentTarget(doc.Config())
			if tc.name == "absent-agent-binding" {
				if err == nil || len(got) != 0 {
					t.Fatalf("reachable = %+v, target error = %v, want chat's refusal and nothing to approve", got, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolveAgentTarget: %v", err)
			}
			if target.destination.Provider != "A" || target.destination.Classification != "remote" {
				t.Fatalf("fixture target = %+v, want remote A", target.destination)
			}
			if len(got) != 1 || got[0].Destination != target.destination ||
				!slices.Equal(got[0].Hops, []ReachableHop{{UseCase: "agent", Source: "agent"}}) {
				t.Fatalf("reachable = %+v, want exactly the target %+v", got, target.destination)
			}
		})
	}
}

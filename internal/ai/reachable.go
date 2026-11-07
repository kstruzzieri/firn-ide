package ai

import (
	"github.com/kstruzzieri/go-llm/config"
)

// Golem chat and commit-message generation both send through
// fixedModelCaller, with no router and no fallback (#491), so the one target
// ResolveAgentTarget names is everywhere Firn sends. Fallback chains and the
// recommendation route belong to the golem CLI, which keeps them; Firn asks
// approval for none of their destinations. The reachable-set corpus test
// (F15) pins that the approval set is this one target.

// ReachableHop names how the agent route reaches a destination.
type ReachableHop struct {
	UseCase string
	Source  string
}

// ReachableDestination is one destination in the reachable set with every
// provenance hop that reaches it.
type ReachableDestination struct {
	Destination ProviderDestination
	Hops        []ReachableHop
}

// renderHop is the provenance string for one hop. The literals are fixed
// vocabulary; only Source is interpolated (boundary callers sanitize it).
func renderHop(h ReachableHop) string {
	if h.Source == "" || h.Source == h.UseCase {
		return h.UseCase
	}
	return h.UseCase + " via defaults." + h.Source
}

// reachableDestinations is the destination Golem chat and commit generation
// send to for cfg: the agent use case's primary model, resolved exactly as
// ResolveAgentTarget resolves it. A configuration chat cannot run (no agent
// setting, an unknown role, a model that misses agent's floor, an endpoint
// that cannot be canonicalized) reaches nothing; ResolveAgentTarget logs an
// unusable endpoint without the endpoint itself.
func reachableDestinations(cfg *config.Config) []ReachableDestination {
	if cfg == nil {
		return nil
	}
	target, err := ResolveAgentTarget(cfg)
	if err != nil {
		return nil
	}
	return []ReachableDestination{{
		Destination: target.destination,
		Hops:        []ReachableHop{{UseCase: useCaseAgent, Source: useCaseAgent}},
	}}
}

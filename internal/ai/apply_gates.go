package ai

import (
	"context"
	"maps"
	"slices"
	"strings"

	"github.com/kstruzzieri/go-llm/config"
	"github.com/kstruzzieri/go-llm/provider"
)

// Design decision 12 (#493): Firn consumes only `agent`, so Apply's gates read
// agent plus the use cases the Apply TOUCHES — a bound use case whose resolved
// model, chain or exposure differs between the document before the staged
// changes and after them. A route the change leaves alone is never checked
// and never asked about, so an edit is never refused for a shortfall it did
// not cause; a touched route that misses its floor is refused, so Firn never
// writes a new one. frontend/src/types/golemConfig.ts predicts the same set
// from the projection (`touchedUseCasesOf`), and the shared fixture under
// testdata/apply_gates pins the two to each other.

// applyGates is what one Apply's gates read. A nil *applyGates is the dry
// run that derives it: every mutation runs ungated.
type applyGates struct {
	// scope holds the use cases whose Firn floors are checked: agent plus the
	// touched set. nil checks every default — a whole-document source (blank
	// or profile) replaces the file, so every route in it is the Apply's.
	scope map[string]bool
	// confirm is the exact unknown-use-case acknowledgement each selector
	// group must carry: the floorless touched use cases its changes touch.
	confirm map[modelSelector][]string
	// confirmed is every use case some group acknowledges.
	confirmed map[string]bool
	// touched is the touched set itself.
	touched map[string]bool
	// changed holds the roles whose state the Apply changes (or creates): on
	// a touched use case's chain, each is a new answer to its floor.
	changed map[string]bool
}

func (g *applyGates) changedSet() map[string]bool {
	if g == nil {
		return nil
	}
	return g.changed
}

func (g *applyGates) inScope(useCase string) bool {
	return g == nil || g.scope == nil || g.scope[useCase]
}

// floors is the requirement table handed to go-llm's eligibility gate: only
// the in-scope floors. go-llm evaluates every other affected use case as
// unknown/no_requirements, which Firn's own gate (refuseIneligible) has
// already settled by the time the call runs. The dry run hands none.
func (g *applyGates) floors() map[string]provider.Capability {
	out := map[string]provider.Capability{}
	if g == nil {
		return out
	}
	for useCase, floor := range firnUseCaseFloors {
		if g.inScope(useCase) {
			out[useCase] = floor
		}
	}
	return out
}

// deriveApplyGates runs the staged changes ungated on a scratch copy of the
// source document and compares every default before and after. Gates only
// refuse, they never shape a mutation, so the gated run that follows writes
// the same document the scratch one did, or refuses.
func deriveApplyGates(ctx context.Context, req SettingsApplyRequest, active, doc *config.Document, consumed map[string]bool) (*applyGates, *SettingsApplyResult) {
	scratch, result := scratchSourceDocument(ctx, req, active)
	if result != nil {
		return nil, result
	}
	if result := applyStagedChanges(scratch, req, consumed, nil); result != nil {
		return nil, result
	}
	before, after := doc.Config(), scratch.Config()
	touched := touchedUseCases(before, after)
	plans, result := planRouteChanges(before, req.Changes, consumed, nil)
	if result != nil {
		return nil, result // unreachable: the dry run planned the same request
	}
	gates := &applyGates{
		confirm:   confirmationSets(before, after, plans, touched),
		confirmed: map[string]bool{},
		touched:   touched,
		changed:   changedRoles(before, after),
	}
	for _, useCases := range gates.confirm {
		for _, useCase := range useCases {
			gates.confirmed[useCase] = true
		}
	}
	if req.Source.Kind == applySourceApplied {
		gates.scope = map[string]bool{useCaseAgent: true}
		maps.Copy(gates.scope, touched)
	}
	return gates, nil
}

// scratchSourceDocument builds a second, disposable copy of the source
// document. The applied source is reloaded and must be the same revision —
// a target that moved in between is the conflict loadApplyTarget would report
// a moment later; blank and profile sources are rebuilt from the request.
func scratchSourceDocument(ctx context.Context, req SettingsApplyRequest, active *config.Document) (*config.Document, *SettingsApplyResult) {
	if req.Source.Kind != applySourceApplied {
		scratch, _, result := applySourceDocument(ctx, req, nil)
		return scratch, result
	}
	scratch, _, err := loadAgentConfigDocument()
	if err != nil || active == nil || scratch.Revision() != active.Revision() {
		return nil, conflictTarget(nil)
	}
	return scratch, nil
}

// roleState is what one role on a chain gives the use cases reaching it:
// its model facts, the exposure the projection shows (a selector's explicit
// list, else the role's own resolved set) and its Think mode.
type roleState struct {
	provider, model, modelType, parameters string
	contextWindow, dimensions              int
	exposed, think                         string
}

func roleStateOf(m config.ModelConfig, overrides map[modelSelector][]string) roleState {
	exposed, ok := overrides[modelSelector{provider: m.Provider, model: m.Name}]
	if !ok {
		exposed = canonicalizeCapabilities(m.ResolvedCapabilities())
	}
	return roleState{
		provider: m.Provider, model: m.Name, modelType: m.Type, parameters: m.Parameters,
		contextWindow: m.ContextWindow, dimensions: m.Dimensions,
		exposed: strings.Join(exposed, ","), think: m.ThinkMode,
	}
}

// chainStates walks a use case's chain as roleUsage does — its role, then
// fallbacks depth first, each role once — and records each role's state.
func chainStates(cfg *config.Config, overrides map[modelSelector][]string, useCase string) []roleState {
	role, ok := cfg.Defaults[useCase]
	if !ok {
		return nil
	}
	var out []roleState
	seen := map[string]bool{}
	var walk func(string)
	walk = func(role string) {
		if seen[role] {
			return
		}
		seen[role] = true
		m, ok := cfg.Models[role]
		if !ok {
			return
		}
		out = append(out, roleStateOf(m, overrides))
		for _, fallback := range m.Fallbacks {
			walk(fallback)
		}
	}
	walk(role)
	return out
}

// changedRoles is every role after the Apply whose state differs from
// before it, a role the Apply creates included.
func changedRoles(before, after *config.Config) map[string]bool {
	beforeOverrides, afterOverrides := selectorCapabilityOverrides(before), selectorCapabilityOverrides(after)
	changed := map[string]bool{}
	for role, m := range after.Models {
		was, ok := before.Models[role]
		if !ok || roleStateOf(was, beforeOverrides) != roleStateOf(m, afterOverrides) {
			changed[role] = true
		}
	}
	return changed
}

// changedChainMeetsFloor reports whether every role on useCase's chain that
// the Apply changed exposes floor — the shortfall a change can write into a
// chain it does not route through its primary (a role left behind when the
// selector's only list moves away, say). Roles it did not change are not this
// Apply's to judge.
func changedChainMeetsFloor(cfg *config.Config, useCase string, floor provider.Capability, changed map[string]bool) bool {
	overrides := selectorCapabilityOverrides(cfg)
	seen := map[string]bool{}
	var walk func(string) bool
	walk = func(role string) bool {
		if seen[role] {
			return true
		}
		seen[role] = true
		m, ok := cfg.Models[role]
		if !ok {
			return true
		}
		if changed[role] {
			exposed, owned := overrides[modelSelector{provider: m.Provider, model: m.Name}]
			if !owned {
				exposed = m.ResolvedCapabilities()
			}
			if caps, err := provider.ParseCapsStrict(exposed); err != nil || !caps.Has(floor) {
				return false
			}
		}
		for _, fallback := range m.Fallbacks {
			if !walk(fallback) {
				return false
			}
		}
		return true
	}
	return walk(cfg.Defaults[useCase])
}

// touchedUseCases is the touched set: every use case bound after the Apply
// whose chain states differ from before it. A use case the Apply unbinds has
// no route left to check or ask about.
func touchedUseCases(before, after *config.Config) map[string]bool {
	beforeOverrides, afterOverrides := selectorCapabilityOverrides(before), selectorCapabilityOverrides(after)
	touched := map[string]bool{}
	for useCase := range after.Defaults {
		if !slices.Equal(chainStates(before, beforeOverrides, useCase), chainStates(after, afterOverrides, useCase)) {
			touched[useCase] = true
		}
	}
	return touched
}

// confirmationSets attributes each floorless touched use case to the selector
// groups whose changes touch it. A staged use case belongs to its own group.
// Any other touched use case keeps its chain and changes through a role on it
// whose exposure or Think moved: such a role sits on a selector a group
// routes onto (an override or an asserted list), or on one a retarget left
// (taking the selector's only list with it), so it is asked in that group.
// The set is per selector because the acknowledgement is selector-scoped
// (§3.3): every staged route onto one model carries the same value.
func confirmationSets(before, after *config.Config, plans []routePlan, touched map[string]bool) map[modelSelector][]string {
	sets := map[modelSelector]map[string]bool{}
	staged := map[string]modelSelector{}
	sources := map[modelSelector][]modelSelector{}
	for _, plan := range plans {
		if sets[plan.selector] == nil {
			sets[plan.selector] = map[string]bool{}
		}
		staged[plan.change.UseCase] = plan.selector
		if plan.action == routeRetarget {
			m := before.Models[plan.role]
			source := modelSelector{provider: m.Provider, model: m.Name}
			sources[source] = append(sources[source], plan.selector)
		}
	}
	routed, _ := roleUsage(before)
	beforeOverrides, afterOverrides := selectorCapabilityOverrides(before), selectorCapabilityOverrides(after)
	for useCase := range touched {
		if _, floored := firnUseCaseFloors[useCase]; floored {
			continue
		}
		if group, ok := staged[useCase]; ok {
			sets[group][useCase] = true
			continue
		}
		for role, users := range routed {
			was, ok := before.Models[role]
			now, still := after.Models[role]
			if !ok || !still || !slices.Contains(users, useCase) ||
				roleStateOf(was, beforeOverrides) == roleStateOf(now, afterOverrides) {
				continue
			}
			selector := modelSelector{provider: was.Provider, model: was.Name}
			if sets[selector] != nil {
				sets[selector][useCase] = true
			}
			for _, group := range sources[selector] {
				sets[group][useCase] = true
			}
		}
	}
	out := make(map[modelSelector][]string, len(sets))
	for selector, set := range sets {
		out[selector] = slices.Sorted(maps.Keys(set))
	}
	return out
}

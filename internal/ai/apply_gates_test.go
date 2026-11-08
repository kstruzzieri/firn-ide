package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/kstruzzieri/go-llm/agent"
	"github.com/kstruzzieri/go-llm/config"
	"github.com/kstruzzieri/go-llm/provider"
)

// #493, design decision 12: Firn's three gates read agent plus the use cases
// an Apply touches — a use case whose resolved model, chain or exposure
// differs between the document before the Apply and after it. A route the
// change leaves alone is never checked and never asked about; a route the
// change touches never gets a new shortfall.

// golemUseCaseRequirements is a copy of Golem's consumer declaration for the
// same models.json (go-llm v0.5.0, cmd/golem/models_inventory.go,
// golemViewRequirements). cmd/golem is a main package, so the copy is the
// pin: bump it with go-llm.
var golemUseCaseRequirements = map[string]provider.Capability{
	"agent":      agent.ModelCallCapabilities(true),
	"planning":   agent.ModelCallCapabilities(true),
	"chat":       agent.ModelCallCapabilities(false),
	"analysis":   agent.ModelCallCapabilities(false),
	"embedding":  provider.CapEmbed,
	"completion": provider.CapGenerate | provider.CapInsert,
}

// TestFirnFloorsMatchGolemExceptCompletion: Firn's floor table is Golem's,
// with one listed difference. `completion` stays out (deferred): `insert` is
// never derived from a model type, so every dense or moe card without an
// explicit list naming it would fall short.
func TestFirnFloorsMatchGolemExceptCompletion(t *testing.T) {
	deferred := map[string]bool{"completion": true}
	for useCase, golem := range golemUseCaseRequirements {
		firn, ok := firnUseCaseFloors[useCase]
		if deferred[useCase] {
			if ok {
				t.Errorf("Firn has a floor for %q, which is deferred", useCase)
			}
			continue
		}
		if !ok || firn != golem {
			t.Errorf("floor for %q = %v, Golem declares %v", useCase, firn.Names(), golem.Names())
		}
	}
	for useCase := range firnUseCaseFloors {
		if _, ok := golemUseCaseRequirements[useCase]; !ok {
			t.Errorf("Firn has a floor for %q, which Golem does not declare", useCase)
		}
	}
}

// applyOutcome runs Call 1 and reports the use cases a blocking ineligible
// diagnostic names, or none when the request was accepted (applied or asking
// for destination approval: either way past every gate).
func applyOutcome(t *testing.T, h *applyHarness, changes ...Change) (accepted bool, refused []string, res SettingsApplyResult) {
	t.Helper()
	res, err := h.svc.ApplySettings(h.request(t, changes...))
	if err != nil {
		t.Fatalf("ApplySettings: %v", err)
	}
	switch res.Status {
	case "applied", "consent_required":
		return true, nil, res
	}
	for _, d := range res.Diagnostics {
		if d.Code == codeEligibilityIneligible && d.SubjectKind == "use_case" {
			refused = append(refused, d.SubjectName)
		}
	}
	slices.Sort(refused)
	return false, refused, res
}

func TestApplyEditToAgentIgnoresAChatRouteThatAlreadyFallsShort(t *testing.T) {
	const target = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "agent-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "chat-m": {"name": "embed-model", "provider": "ollama", "type": "embedding"}
  },
  "defaults": {"agent": "agent-m", "chat": "chat-m"}
}`
	h := newApplyHarness(t, target)
	accepted, refused, res := applyOutcome(t, h,
		routeChange("agent", "ollama", "other-model", "chat", "stream", "tool_call"))
	if !accepted {
		t.Fatalf("an edit to agent alone was refused (%v): %+v", refused, res)
	}
}

func TestApplyRetargetOfAnalysisOntoAnEmbeddingModelIsRefusedByUseCase(t *testing.T) {
	const target = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "agent-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "ana-m": {"name": "analysis-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "analysis": "ana-m"}
}`
	h := newApplyHarness(t, target)
	change := routeChange("analysis", "ollama", "embed-model", "embed")
	change.ModelFacts.Type = "embedding"
	_, refused, res := applyOutcome(t, h, change)
	if !slices.Equal(refused, []string{"analysis"}) {
		t.Fatalf("retarget of analysis onto an embedding model refused %v (%+v), want analysis", refused, res)
	}
}

// A fork leaves the source role's other use cases as they are, so their
// floors are not this change's to check: embedding already falls short on
// the role chat forks away from, and the fork still applies.
func TestApplyForkDoesNotCheckTheSourceRolesOtherUseCases(t *testing.T) {
	const target = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "agent-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "shared-m": {"name": "chat-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "chat": "shared-m", "embedding": "shared-m"}
}`
	h := newApplyHarness(t, target)
	accepted, refused, res := applyOutcome(t, h,
		routeChange("chat", "ollama", "new-chat-model", "chat", "generate", "stream"))
	if !accepted {
		t.Fatalf("fork of chat was refused (%v): %+v", refused, res)
	}
}

// The selector agent runs on carries one explicit list, on agent's own role;
// embedding sits beside it on a role that derives and already lacks embed.
// Retargeting agent in place (a type change on the same model) re-sends that
// unchanged list, so go-llm evaluates every role on the selector: it must
// receive only agent's floor and the touched use cases', and embedding, whose
// exposure does not change, is not refused.
func TestApplyRetargetInPlaceReassertingTheListIgnoresAnUntouchedSibling(t *testing.T) {
	const target = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "shared-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "embed-m": {"name": "shared-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "embedding": "embed-m"}
}`
	h := newApplyHarness(t, target)
	change := routeChange("agent", "ollama", "shared-model", "chat", "stream", "tool_call")
	change.ModelFacts.Type = "moe"
	accepted, refused, res := applyOutcome(t, h, change)
	if !accepted {
		t.Fatalf("retarget in place of the sole list holder was refused (%v): %+v", refused, res)
	}
}

// An override on a role chat reaches only through its fallbacks still gates
// chat: its chain changes.
func TestApplyOverrideOnAFallbackRoleIsRefusedByTheUseCaseReachingIt(t *testing.T) {
	const target = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "agent-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "chat-m": {"name": "chat-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream"], "fallbacks": ["fast-m"]},
    "fast-m": {"name": "fast-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]}
  },
  "defaults": {"agent": "agent-m", "chat": "chat-m", "completion": "fast-m"}
}`
	h := newApplyHarness(t, target)
	change := confirmUnknown(routeChange("completion", "ollama", "fast-model", "chat"), "completion")
	_, refused, res := applyOutcome(t, h, change)
	if !slices.Equal(refused, []string{"chat"}) {
		t.Fatalf("override on chat's fallback refused %v (%+v), want chat", refused, res)
	}
}

// departureTargetJSON: agent's role holds the only explicit list on
// shared-model; planning's role sits beside it and derives, so it lacks
// tool_call on its own. While agent stays, the planning route is untouched.
const departureTargetJSON = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "shared-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "plan-m": {"name": "shared-model", "provider": "ollama", "type": "dense"},
    "chat-m": {"name": "chat-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "planning": "plan-m", "chat": "chat-m"}
}`

func TestApplyEditElsewhereIgnoresAnUntouchedPlanningShortfall(t *testing.T) {
	h := newApplyHarness(t, departureTargetJSON)
	accepted, refused, res := applyOutcome(t, h,
		routeChange("chat", "ollama", "other-chat-model", "chat", "generate", "stream"))
	if !accepted {
		t.Fatalf("an edit to chat was refused (%v): %+v", refused, res)
	}
}

// Retargeting agent off the selector takes the selector's only list with it:
// planning's exposure changes, so planning is checked, and refused, although
// the route editor's reach report does not name it.
func TestApplyRetargetTakingTheOnlyListAwayChecksTheRoutesLeftBehind(t *testing.T) {
	h := newApplyHarness(t, departureTargetJSON)
	_, refused, res := applyOutcome(t, h,
		routeChange("agent", "ollama", "agent-model", "chat", "stream", "tool_call"))
	if !slices.Equal(refused, []string{"planning"}) {
		t.Fatalf("departure refused %v (%+v), want planning", refused, res)
	}
}

// Agent is checked on every Apply, as before decision 12.
func TestApplyEditElsewhereStillChecksAgent(t *testing.T) {
	const target = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "agent-model", "provider": "ollama", "type": "dense"},
    "chat-m": {"name": "chat-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "chat": "chat-m"}
}`
	h := newApplyHarness(t, target)
	before := h.targetBytes(t)
	accepted, _, res := applyOutcome(t, h,
		routeChange("chat", "ollama", "other-chat-model", "chat", "generate", "stream"))
	if accepted || !bytes.Equal(h.targetBytes(t), before) {
		t.Fatalf("an edit beside an agent that misses its floor was accepted: %+v", res)
	}
}

// A floorless use case the change does not touch is not asked about: a fork
// of a role completion also reaches leaves completion's chain as it was.
func TestApplyForkAsksNothingAboutTheSourceRolesFloorlessUseCases(t *testing.T) {
	const target = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "fast-m": {"name": "fast-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "coding-m": {"name": "coding-model", "provider": "ollama", "type": "dense",
      "fallbacks": ["fast-m"]}
  },
  "defaults": {"agent": "fast-m", "completion": "coding-m"}
}`
	h := newApplyHarness(t, target)
	accepted, refused, res := applyOutcome(t, h,
		routeChange("agent", "ollama", "glm-model", "chat", "stream", "tool_call"))
	if !accepted {
		t.Fatalf("fork with no acknowledgement was refused (%v): %+v", refused, res)
	}
}

func parseTestConfig(t *testing.T, body string) *config.Config {
	t.Helper()
	doc, err := config.ParseDocument([]byte(body), config.Origin{Source: config.OriginProgrammatic}, config.DocumentOptions{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return doc.Config()
}

// touchedUseCases compares every default's chain — model facts, exposure and
// Think of each role on it — before and after.
func TestTouchedUseCases(t *testing.T) {
	before := parseTestConfig(t, departureTargetJSON)
	for _, tc := range []struct {
		name  string
		after string
		want  []string
	}{
		{"nothing changes", departureTargetJSON, nil},
		{
			// agent leaves with the selector's only list: planning's exposure changes.
			"departure",
			`{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "agent-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "plan-m": {"name": "shared-model", "provider": "ollama", "type": "dense"},
    "chat-m": {"name": "chat-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "planning": "plan-m", "chat": "chat-m"}
}`,
			[]string{"agent", "planning"},
		},
		{
			// A Think on agent's own role only.
			"think",
			`{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "shared-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"], "think_mode": "toggle"},
    "plan-m": {"name": "shared-model", "provider": "ollama", "type": "dense"},
    "chat-m": {"name": "chat-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "planning": "plan-m", "chat": "chat-m"}
}`,
			[]string{"agent"},
		},
		{
			// chat unbound: nothing left to touch for it.
			"unbind",
			`{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "shared-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "plan-m": {"name": "shared-model", "provider": "ollama", "type": "dense"},
    "chat-m": {"name": "chat-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "planning": "plan-m"}
}`,
			nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := slices.Sorted(maps.Keys(touchedUseCases(before, parseTestConfig(t, tc.after))))
			if !slices.Equal(got, tc.want) {
				t.Fatalf("touched = %v, want %v", got, tc.want)
			}
		})
	}
}

// applyGatesDir is absolute: the apply harness changes directory.
var applyGatesDir = func() string {
	dir, err := filepath.Abs(filepath.Join("testdata", "apply_gates"))
	if err != nil {
		panic(err)
	}
	return dir
}()

type applyGatesCard struct {
	Provider    string   `json:"provider"`
	Model       string   `json:"model"`
	Type        string   `json:"type"`
	ExposedCaps []string `json:"exposedCaps"`
}

type applyGatesCase struct {
	Name                string         `json:"name"`
	Base                string         `json:"base"`
	UseCase             string         `json:"useCase"`
	Card                applyGatesCard `json:"card"`
	Touched             []string       `json:"touched"`
	Asks                []string       `json:"asks"`
	Refused             []string       `json:"refused"`
	Picker              []string       `json:"picker"`
	RefusedForEveryCard string         `json:"refusedForEveryCard"`
}

type applyGatesFixture struct {
	Bases map[string]json.RawMessage `json:"bases"`
	Cases []applyGatesCase           `json:"cases"`
}

func readApplyGatesFixture(t *testing.T) applyGatesFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(applyGatesDir, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture applyGatesFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("cases.json: %v", err)
	}
	return fixture
}

// baseDocument is a base's models.json: inline, or a path under testdata.
func (f applyGatesFixture) baseDocument(t *testing.T, name string) string {
	t.Helper()
	raw, ok := f.Bases[name]
	if !ok {
		t.Fatalf("no base %q", name)
	}
	var path string
	if json.Unmarshal(raw, &path) == nil {
		body, err := os.ReadFile(filepath.Join(applyGatesDir, "..", path))
		if err != nil {
			t.Fatal(err)
		}
		return string(body)
	}
	return string(raw)
}

// change is the route change the editor stages for the card: its exposure,
// fully known, and the acknowledgement the case expects to be asked for.
func (c applyGatesCase) change() Change {
	exposed := canonicalCaps(c.Card.ExposedCaps...)
	change := Change{
		Kind: changeKindRoute, UseCase: c.UseCase,
		ModelFacts: &ModelFacts{Provider: c.Card.Provider, Model: c.Card.Model, Type: c.Card.Type},
		CapabilityFacts: &CapabilityFacts{
			Caps: exposed, KnownCaps: append([]string{}, provider.CanonicalCapabilityNames...),
		},
		ExposedCaps: exposed,
	}
	if len(c.Asks) > 0 {
		change = confirmUnknown(change, c.Asks...)
	}
	return change
}

// TestApplyGatesFixture pins the backend half of the shared gate fixture: the
// projections the frontend half reads, the touched set and acknowledgement
// Apply derives, and the use cases Apply refuses. Set FIRN_UPDATE_GOLDEN=1 to
// rewrite projections.json after an intended projection change.
func TestApplyGatesFixture(t *testing.T) {
	fixture := readApplyGatesFixture(t)
	projections := map[string]json.RawMessage{}
	for _, name := range slices.Sorted(maps.Keys(fixture.Bases)) {
		h := newApplyHarness(t, fixture.baseDocument(t, name))
		result, err := h.svc.ReloadSettings()
		if err != nil || result.Projection.State != "ready" {
			t.Fatalf("base %s: reload = %+v, %v; want a Ready projection", name, result, err)
		}
		raw, err := json.Marshal(result.Projection)
		if err != nil {
			t.Fatal(err)
		}
		projections[name] = raw
	}
	raw, err := json.Marshal(projections)
	if err != nil {
		t.Fatal(err)
	}
	got := indentJSON(t, raw)
	golden := filepath.Join(applyGatesDir, "projections.json")
	if os.Getenv("FIRN_UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(golden, got, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if want, err := os.ReadFile(golden); err != nil || !bytes.Equal(got, want) {
		t.Errorf("projections drifted from %s (%v); rerun with FIRN_UPDATE_GOLDEN=1 if intended", golden, err)
	}

	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			if tc.RefusedForEveryCard == "" && !slices.Equal(tc.Picker, tc.Refused) {
				t.Fatalf("fixture: picker %v and refused %v disagree without refusedForEveryCard", tc.Picker, tc.Refused)
			}
			h := newApplyHarness(t, fixture.baseDocument(t, tc.Base))
			change := tc.change()
			request := h.request(t, change)

			doc, _, err := loadAgentConfigDocument()
			if err != nil {
				t.Fatal(err)
			}
			gates, result := deriveApplyGates(context.Background(), request, doc, doc, nil)
			if result != nil {
				t.Fatalf("deriveApplyGates = %+v", result)
			}
			if got := slices.Sorted(maps.Keys(gates.touched)); !slices.Equal(got, tc.Touched) {
				t.Errorf("touched = %v, want %v", got, tc.Touched)
			}
			asks := gates.confirm[modelSelector{provider: tc.Card.Provider, model: tc.Card.Model}]
			if !slices.Equal(asks, tc.Asks) && (len(asks) > 0 || len(tc.Asks) > 0) {
				t.Errorf("asks = %v, want %v", asks, tc.Asks)
			}

			accepted, refused, res := applyOutcome(t, h, change)
			if accepted != (len(tc.Refused) == 0) || !slices.Equal(refused, tc.Refused) {
				t.Errorf("Apply accepted %v refusing %v (%+v), want refused %v", accepted, refused, res, tc.Refused)
			}
		})
	}
}

// Taking a selector's only list away changes what a role on it shows, and
// planning reaches that role only as a fallback: planning is touched, its
// primary still meets the floor, and the fallback that now lacks tool_call is
// a new shortfall Apply refuses, naming planning.
func TestApplyRetargetTakingTheOnlyListAwayChecksATouchedFallback(t *testing.T) {
	const target = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "shared-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "plan-m": {"name": "plan-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"], "fallbacks": ["fb-m"]},
    "fb-m": {"name": "shared-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "planning": "plan-m"}
}`
	h := newApplyHarness(t, target)
	_, refused, res := applyOutcome(t, h,
		routeChange("agent", "ollama", "agent-model", "chat", "stream", "tool_call"))
	if !slices.Equal(refused, []string{"planning"}) {
		t.Fatalf("departure refused %v (%+v), want planning", refused, res)
	}
}

// #350: a floorless use case the change touches is asked about only when the
// change can narrow what it receives — a capability removed, a Think cleared,
// or a route moved to another model. Widening asks nothing.

// widenTargetJSON: completion runs on fast-m, which chat reaches through its
// fallbacks and summarize routes directly.
const widenTargetJSON = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "agent-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "chat-m": {"name": "chat-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream"], "fallbacks": ["fast-m"]},
    "fast-m": {"name": "fast-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"], "think_mode": "toggle"},
    "sum-m": {"name": "fast-model", "provider": "ollama", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "chat": "chat-m", "completion": "fast-m", "summarize": "sum-m"}
}`

func TestApplyAsksNothingWhenTheChangeOnlyWidens(t *testing.T) {
	h := newApplyHarness(t, widenTargetJSON)
	change := routeChange("completion", "ollama", "fast-model", "chat", "generate", "stream", "tool_call")
	change.ThinkMode = "toggle"
	accepted, refused, res := applyOutcome(t, h, change)
	if !accepted {
		t.Fatalf("a widening override without acknowledgement was refused (%v): %+v", refused, res)
	}
}

func TestApplyAsksAboutEveryRouteANarrowingReaches(t *testing.T) {
	for _, tc := range []struct {
		name  string
		caps  []string
		think string
		asks  []string
	}{
		{"unticking a capability", []string{"chat", "stream"}, "toggle", []string{"completion", "summarize"}},
		{"clearing Think", []string{"chat", "stream", "tool_call"}, "", []string{"completion"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newApplyHarness(t, widenTargetJSON)
			change := routeChange("completion", "ollama", "fast-model", tc.caps...)
			change.ThinkMode = tc.think
			before := h.targetBytes(t)
			res, err := h.svc.ApplySettings(h.request(t, change))
			if err != nil {
				t.Fatal(err)
			}
			if res.Status != "diagnostics" || len(res.Diagnostics) != 1 ||
				res.Diagnostics[0].Code != codeEligibilityUnknown || !bytes.Equal(h.targetBytes(t), before) {
				t.Fatalf("unacknowledged narrowing = %+v, want one %s diagnostic", res, codeEligibilityUnknown)
			}
			if accepted, refused, res := applyOutcome(t, h, confirmUnknown(change, tc.asks...)); !accepted {
				t.Fatalf("narrowing acknowledging %v was refused (%v): %+v", tc.asks, refused, res)
			}
		})
	}
}

func TestApplyAsksAboutAFloorlessRouteItBinds(t *testing.T) {
	h := newApplyHarness(t, widenTargetJSON)
	change := routeChange("translate", "ollama", "agent-model", "chat", "stream", "tool_call")
	if _, _, res := applyOutcome(t, h, change); res.Status != "diagnostics" ||
		len(res.Diagnostics) != 1 || res.Diagnostics[0].Code != codeEligibilityUnknown {
		t.Fatalf("unacknowledged bind = %+v, want one %s diagnostic", res, codeEligibilityUnknown)
	}
	if accepted, refused, res := applyOutcome(t, h, confirmUnknown(change, "translate")); !accepted {
		t.Fatalf("acknowledged bind was refused (%v): %+v", refused, res)
	}
}

func TestNarrowedUseCases(t *testing.T) {
	before := parseTestConfig(t, widenTargetJSON)
	edit := func(old, replacement string) *config.Config {
		t.Helper()
		body := strings.Replace(widenTargetJSON, old, replacement, 1)
		if body == widenTargetJSON {
			t.Fatalf("edit %q did not apply", old)
		}
		return parseTestConfig(t, body)
	}
	for _, tc := range []struct {
		name  string
		after *config.Config
		want  []string
	}{
		{"widened", edit(`"capabilities": ["chat", "stream", "tool_call"], "think_mode"`,
			`"capabilities": ["chat", "generate", "stream", "tool_call"], "think_mode"`), nil},
		{"narrowed", edit(`"capabilities": ["chat", "stream", "tool_call"], "think_mode"`,
			`"capabilities": ["chat", "stream"], "think_mode"`), []string{"chat", "completion", "summarize"}},
		{"Think cleared", edit(`, "think_mode": "toggle"}`, `}`), []string{"chat", "completion"}},
		{"moved", edit(`"summarize": "sum-m"`, `"summarize": "agent-m"`), []string{"summarize"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			touched := touchedUseCases(before, tc.after)
			got := slices.Sorted(maps.Keys(narrowedUseCases(before, tc.after, touched)))
			if !slices.Equal(got, tc.want) {
				t.Fatalf("narrowed = %v, want %v (touched %v)", got, tc.want, slices.Sorted(maps.Keys(touched)))
			}
		})
	}
}

// Codex #350 round 1: completion's own change only widens it, and chat's
// change narrows completion through the fallback completion reaches chat's
// model by. The acknowledgement belongs to chat's change, which narrows it,
// not to completion's, staged without one.
func TestApplyAsksForANarrowingInTheGroupThatNarrows(t *testing.T) {
	const target = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "agent-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "comp-m": {"name": "comp-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"], "fallbacks": ["chat-m"]},
    "chat-m": {"name": "chat-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]}
  },
  "defaults": {"agent": "agent-m", "completion": "comp-m", "chat": "chat-m"}
}`
	h := newApplyHarness(t, target)
	widen := routeChange("completion", "ollama", "comp-model", "chat", "generate", "stream", "tool_call")
	narrow := routeChange("chat", "ollama", "chat-model", "chat", "stream")
	if _, _, res := applyOutcome(t, h, widen, narrow); res.Status != "diagnostics" ||
		len(res.Diagnostics) != 1 || res.Diagnostics[0].Code != codeEligibilityUnknown ||
		res.Diagnostics[0].SubjectName != "chat" {
		t.Fatalf("unacknowledged narrowing = %+v, want one %s diagnostic on chat", res, codeEligibilityUnknown)
	}
	if accepted, refused, res := applyOutcome(t, h, widen, confirmUnknown(narrow, "completion")); !accepted {
		t.Fatalf("narrowing acknowledged by the group that narrows was refused (%v): %+v", refused, res)
	}
}

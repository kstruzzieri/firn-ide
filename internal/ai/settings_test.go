package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode"

	"github.com/kstruzzieri/go-llm/config"
	"github.com/kstruzzieri/go-llm/provider"
)

// testSettingsRevision is the one 64-lowercase-hex revision constant used by
// every producer test in this file.
const testSettingsRevision = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// loadFixture parses cfgJSON the way a successful load ends up shaped, without
// filesystem or env. Defaults/expansion behavior is covered separately by
// TestBuildSettingsProjectionFromRealLoad.
func loadFixture(t *testing.T, cfgJSON string) loadedAgentConfig {
	t.Helper()
	var cfg config.Config
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		t.Fatalf("fixture unmarshal: %v", err)
	}
	return loadedAgentConfig{
		Config:      &cfg,
		SourcePath:  "/secret/canonical/models.json",
		LexicalPath: "/secret/lexical/models.json",
		Origin:      originUserConfig,
		Revision:    testSettingsRevision,
	}
}

const settingsFixtureJSON = `{
  "providers": {
    "hosted": {"base_url": "https://api.example.com:8443/v1/", "api_format": "openai-compat", "api_key": "sk-EXPANDED-MARKER"},
    "local":  {"base_url": "http://localhost:11434", "api_format": "ollama"},
    "broken": {"base_url": "ftp://bad", "api_format": "openai-compat"}
  },
  "models": {
    "agent-m": {"name": "wire-model", "provider": "hosted", "type": "dense",
                "capabilities": ["Tool_Call", "chat", "chat", "stream"], "think_mode": "auto"},
    "chat-m":  {"name": "small-model", "provider": "local", "type": "dense"}
  },
  "defaults": {"agent": "agent-m", "chat": "chat-m"}
}`

func projectionLoaded(cfg *config.Config) loadedAgentConfig {
	return loadedAgentConfig{
		Config: cfg, Origin: originUserConfig, Revision: testSettingsRevision,
	}
}

func projectionConfig() *config.Config {
	return &config.Config{
		Providers: map[string]config.ProviderConfig{
			"hosted": {BaseURL: "https://api.example.com/v1", APIFormat: "openai-compat"},
		},
		Models: map[string]config.ModelConfig{
			"agent-m": {
				Name: "wire-model", Provider: "hosted", Type: "dense",
				Capabilities: []string{"chat", "stream", "tool_call"},
			},
		},
		Defaults: map[string]string{"agent": "agent-m"},
	}
}

func projectedModel(t *testing.T, p SettingsProjection, role string) ModelProjection {
	t.Helper()
	for _, m := range p.Models {
		if m.Role == role {
			return m
		}
	}
	t.Fatalf("model %q missing from %+v", role, p.Models)
	return ModelProjection{}
}

func projectionHasDiagnostic(p SettingsProjection, code string, blocking bool) bool {
	for _, d := range p.Diagnostics {
		if d.Code == code && d.Blocking == blocking {
			return true
		}
	}
	return false
}

// projectionDiagnostic returns the first diagnostic with the given code,
// regardless of Blocking, so a test can assert on its full shape (subject,
// blocking) in one place.
func projectionDiagnostic(p SettingsProjection, code string) (Diagnostic, bool) {
	for _, d := range p.Diagnostics {
		if d.Code == code {
			return d, true
		}
	}
	return Diagnostic{}, false
}

func TestProjectionDocumentStateInvariants(t *testing.T) {
	ready := buildSettingsProjection(projectionLoaded(projectionConfig()), nil)
	if ready.State != "ready" || ready.Revision != testSettingsRevision ||
		ready.ReadOnly || !ready.Editable {
		t.Fatalf("Ready document facts = %+v", ready)
	}

	duplicate := projectionLoaded(projectionConfig())
	duplicate.ReadOnly = true
	duplicate.ReadOnlyDiagnostic = config.Diagnostic{
		Code: config.CodeDuplicateKeys, SubjectKind: config.SubjectProvider, Subject: "hosted",
	}
	limited := buildSettingsProjection(duplicate, nil)
	if limited.State != "limited" || limited.Revision != testSettingsRevision ||
		!limited.ReadOnly || !limited.Editable || len(limited.Models) != 1 ||
		!projectionHasDiagnostic(limited, codeDuplicateKeys, false) {
		t.Fatalf("duplicate document projection = %+v", limited)
	}

	missing := buildSettingsProjection(loadedAgentConfig{}, ErrAgentConfigMissing)
	invalid := buildSettingsProjection(
		loadedAgentConfig{Origin: originEnv}, ErrAgentConfigInvalid)
	for name, p := range map[string]SettingsProjection{"missing": missing, "invalid": invalid} {
		if p.Revision != "" || p.ReadOnly || p.Editable {
			t.Fatalf("%s document facts = %+v", name, p)
		}
	}
}

// TestProjectionReadOnlyDiagnosticNeverBlocks: an unknown future read-only
// code fails closed onto {config_invalid, Blocking:true} inside
// mapConfigDiagnostic (a deliberate choice for the LOAD-failure path, where
// blocking is correct). Rendered as-is over a LIVE, successfully loaded
// document, that same Blocking:true would read as "rejected while loading"
// for a document that in fact loaded fine and whose entities still project.
func TestProjectionReadOnlyDiagnosticNeverBlocks(t *testing.T) {
	loaded := projectionLoaded(projectionConfig())
	loaded.ReadOnly = true
	loaded.ReadOnlyDiagnostic = config.Diagnostic{Code: config.ErrorCode("future_read_only_reason")}
	p := buildSettingsProjection(loaded, nil)
	if p.State != "limited" || len(p.Models) != 1 {
		t.Fatalf("read-only unknown-code projection = %+v", p)
	}
	d, ok := projectionDiagnostic(p, codeConfigInvalid)
	if !ok || d.Blocking {
		t.Fatalf("read-only diagnostic must never block a live document: %+v", p.Diagnostics)
	}
}

func TestProjectionCompleteModelFacts(t *testing.T) {
	cfg := projectionConfig()
	agent := cfg.Models["agent-m"]
	agent.Parameters, agent.ContextWindow, agent.Dimensions = "7b", 32768, 1536
	agent.ThinkMode = "toggle"
	agent.Fallbacks = []string{"fallback-m"}
	cfg.Models["agent-m"] = agent
	cfg.Models["fallback-m"] = config.ModelConfig{
		Name: "fallback-model", Provider: "hosted", Type: "dense",
	}
	cfg.Models["orphan-m"] = config.ModelConfig{
		Name: "embedding-model", Provider: "hosted", Type: "embedding",
	}

	p := buildSettingsProjection(projectionLoaded(cfg), nil)
	got := projectedModel(t, p, "agent-m")
	wantCaps := []string{"chat", "stream", "tool_call"}
	wantKnown := []string{"chat", "generate", "stream", "embed", "tool_call", "thinking", "insert"}
	if got.Parameters != "7b" || got.ContextWindow != 32768 || got.Dimensions != 1536 ||
		got.ThinkMode != "toggle" || !reflect.DeepEqual(got.EffectiveCapabilities, wantCaps) ||
		!reflect.DeepEqual(got.CapabilityFacts.Caps, wantCaps) ||
		!reflect.DeepEqual(got.CapabilityFacts.KnownCaps, wantKnown) ||
		!reflect.DeepEqual(got.RoutedUseCases, []string{"agent"}) || got.Removable {
		t.Fatalf("agent model facts = %+v", got)
	}
	fallback := projectedModel(t, p, "fallback-m")
	if !reflect.DeepEqual(fallback.RoutedUseCases, []string{"agent"}) || fallback.Removable {
		t.Fatalf("fallback usage = %+v", fallback)
	}
	orphan := projectedModel(t, p, "orphan-m")
	if len(orphan.RoutedUseCases) != 0 || !orphan.Removable {
		t.Fatalf("orphan usage = %+v", orphan)
	}
}

func TestProjectionSelectorWideExposedCapabilities(t *testing.T) {
	cfg := projectionConfig()
	cfg.Models = map[string]config.ModelConfig{
		"alpha": {
			Name: "shared", Provider: "hosted", Type: "dense",
			Capabilities: []string{"chat"},
		},
		"beta": {Name: "shared", Provider: "hosted", Type: "dense"},
	}
	cfg.Defaults = map[string]string{"agent": "alpha"}
	p := buildSettingsProjection(projectionLoaded(cfg), nil)
	alpha, beta := projectedModel(t, p, "alpha"), projectedModel(t, p, "beta")
	if !reflect.DeepEqual(alpha.ExposedCapabilities, []string{"chat"}) ||
		!reflect.DeepEqual(beta.ExposedCapabilities, []string{"chat"}) ||
		!reflect.DeepEqual(alpha.EffectiveCapabilities, []string{"chat"}) ||
		!reflect.DeepEqual(beta.EffectiveCapabilities, []string{"chat", "generate", "stream"}) {
		t.Fatalf("selector facts alpha=%+v beta=%+v", alpha, beta)
	}
}

func TestProjectionUnsafeIdentifierLimited(t *testing.T) {
	cfg := projectionConfig()
	m := cfg.Models["agent-m"]
	delete(cfg.Models, "agent-m")
	cfg.Models["agent\u202e"] = m
	cfg.Defaults["agent"] = "agent\u202e"
	p := buildSettingsProjection(projectionLoaded(cfg), nil)
	if p.State != "limited" || p.Editable || len(p.Models) != 1 ||
		p.Models[0].Role != "agent\ufffd" {
		t.Fatalf("unsafe identifier projection = %+v", p)
	}
	d, ok := projectionDiagnostic(p, codeIdentifierNotEditable)
	if !ok || d.Blocking || d.SubjectKind != "role" || d.SubjectName != "agent\ufffd" {
		t.Fatalf("unsafe identifier diagnostic must name the offending role: %+v", d)
	}
}

func TestProjectionUnsafeParametersLimited(t *testing.T) {
	cfg := projectionConfig()
	model := cfg.Models["agent-m"]
	model.Parameters = "7b\u0600"
	cfg.Models["agent-m"] = model
	p := buildSettingsProjection(projectionLoaded(cfg), nil)
	projected := projectedModel(t, p, "agent-m")
	if p.State != "limited" || p.Editable || projected.Parameters != "7b\ufffd" {
		t.Fatalf("unsafe parameters projection = %+v", p)
	}
	d, ok := projectionDiagnostic(p, codeIdentifierNotEditable)
	if !ok || d.Blocking || d.SubjectKind != "model" || d.SubjectName != "7b\ufffd" {
		t.Fatalf("unsafe parameters diagnostic must name the offending model: %+v", d)
	}
}

func TestProjectionEmptyIdentityWithheld(t *testing.T) {
	cfg := projectionConfig()
	cfg.Defaults = map[string]string{"": ""}
	cfg.Models = map[string]config.ModelConfig{"": cfg.Models["agent-m"]}
	p := buildSettingsProjection(projectionLoaded(cfg), nil)
	if p.State != "limited" || p.Revision != testSettingsRevision || p.Editable ||
		len(p.Routes) != 0 || len(p.Models) != 0 || len(p.Providers) != 0 ||
		!projectionHasDiagnostic(p, codeIdentifierNotEditable, false) {
		t.Fatalf("empty identifier projection = %+v", p)
	}
}

func TestProjectionSanitizedCollisionWithheld(t *testing.T) {
	cfg := projectionConfig()
	cfg.Defaults = map[string]string{"a\u202d": "agent-m", "a\u202e": "agent-m"}
	p := buildSettingsProjection(projectionLoaded(cfg), nil)
	if p.State != "limited" || p.Editable || len(p.Routes)+len(p.Models)+len(p.Providers) != 0 {
		t.Fatalf("sanitized collision projection = %+v", p)
	}
	d, ok := projectionDiagnostic(p, codeIdentifierNotEditable)
	if !ok || d.Blocking || d.SubjectKind != "use_case" || d.SubjectName != "a\ufffd" {
		t.Fatalf("sanitized collision diagnostic must name the offending use case: %+v", d)
	}
}

func TestProjectionSanitizedModelSelectorCollisionWithheld(t *testing.T) {
	cfg := projectionConfig()
	cfg.Models = map[string]config.ModelConfig{
		"alpha": {Name: "m\u202d", Provider: "hosted", Type: "dense"},
		"beta":  {Name: "m\u202e", Provider: "hosted", Type: "dense"},
	}
	cfg.Defaults = map[string]string{"agent": "alpha"}
	p := buildSettingsProjection(projectionLoaded(cfg), nil)
	if p.State != "limited" || p.Editable ||
		len(p.Routes)+len(p.Models)+len(p.Providers) != 0 {
		t.Fatalf("sanitized selector collision projection = %+v", p)
	}
	d, ok := projectionDiagnostic(p, codeIdentifierNotEditable)
	if !ok || d.Blocking || d.SubjectKind != "model" || d.SubjectName != "m\ufffd" {
		t.Fatalf("sanitized selector collision diagnostic must name the offending model: %+v", d)
	}
}

func TestProjectionNewBounds(t *testing.T) {
	for _, tc := range []struct {
		name string
		set  func(*config.ModelConfig, int)
		at   int
	}{
		{name: "parameters", at: 256, set: func(m *config.ModelConfig, n int) { m.Parameters = strings.Repeat("p", n) }},
		{name: "contextWindow", at: 2147483647, set: func(m *config.ModelConfig, n int) { m.ContextWindow = n }},
		{name: "dimensions", at: 2147483647, set: func(m *config.ModelConfig, n int) { m.Dimensions = n }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, edge := range []struct {
				delta int
				want  string
			}{{0, "ready"}, {1, "limited"}} {
				cfg := projectionConfig()
				m := cfg.Models["agent-m"]
				tc.set(&m, tc.at+edge.delta)
				cfg.Models["agent-m"] = m
				if got := buildSettingsProjection(projectionLoaded(cfg), nil).State; got != edge.want {
					t.Fatalf("value %d: state=%q want %q", tc.at+edge.delta, got, edge.want)
				}
			}
		})
	}
}

// TestProjectionFallbackCountBounded: exceedsProjectionBounds only checked
// each fallback entry's byte length, never the COUNT of entries. A model
// with hundreds of (even duplicated) fallbacks is unbounded work every
// projection build, including under the bindingGate write lock.
func TestProjectionFallbackCountBounded(t *testing.T) {
	cfg := projectionConfig()
	m := cfg.Models["agent-m"]
	m.Fallbacks = make([]string, maxProjectionEntries+1)
	for i := range m.Fallbacks {
		m.Fallbacks[i] = "agent-m" // duplicates: the COUNT alone must bound this
	}
	cfg.Models["agent-m"] = m
	p := buildSettingsProjection(projectionLoaded(cfg), nil)
	if p.State != "limited" || !projectionHasDiagnostic(p, codeProjectionLimited, false) {
		t.Fatalf("fallback-count projection = %+v", p)
	}
}

func TestProjectionDiagnosticsStayBounded(t *testing.T) {
	cfg := projectionConfig()
	cfg.Providers = make(map[string]config.ProviderConfig, maxProjectionEntries)
	for i := 0; i < maxProjectionEntries; i++ {
		cfg.Providers[fmt.Sprintf("p%03d", i)] = config.ProviderConfig{
			BaseURL: ":://", APIFormat: "ollama",
		}
	}
	m := cfg.Models["agent-m"]
	m.Provider = "p255"
	cfg.Models["agent-m"] = m
	loaded := projectionLoaded(cfg)
	loaded.ReadOnly = true
	loaded.ReadOnlyDiagnostic = config.Diagnostic{Code: config.CodeDuplicateKeys}
	p := buildSettingsProjection(loaded, nil)
	if len(p.Diagnostics) != maxProjectionDiagnostics ||
		!projectionHasDiagnostic(p, codeProviderEndpointUnsupported, true) ||
		!projectionHasDiagnostic(p, codeDuplicateKeys, false) {
		t.Fatalf("bounded diagnostics = %+v", p.Diagnostics)
	}
	want := append([]Diagnostic(nil), p.Diagnostics...)
	sortDiagnostics(want)
	if !reflect.DeepEqual(p.Diagnostics, want) {
		t.Fatalf("diagnostics are not canonical: %+v", p.Diagnostics)
	}
}

func TestBuildSettingsProjectionReady(t *testing.T) {
	p := buildSettingsProjection(loadFixture(t, settingsFixtureJSON), nil)

	if p.State != "ready" || p.SourceOrigin != "user_config" {
		t.Fatalf("state=%q origin=%q", p.State, p.SourceOrigin)
	}
	if len(p.Routes) != 2 || p.Routes[0].UseCase != "agent" || p.Routes[1].UseCase != "chat" {
		t.Fatalf("routes: %+v", p.Routes)
	}
	if len(p.Models) != 2 || p.Models[0].Role != "agent-m" || p.Models[0].ModelName != "wire-model" {
		t.Fatalf("models: %+v", p.Models)
	}
	want := []string{"chat", "stream", "tool_call"} // lowercased, deduped, vocabulary order
	got := p.Models[0].EffectiveCapabilities
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("caps: %v want %v", got, want)
	}
	if p.Models[0].ThinkMode != "auto" {
		t.Fatalf("thinkMode: %q", p.Models[0].ThinkMode)
	}
	if len(p.Providers) != 3 {
		t.Fatalf("providers: %+v", p.Providers)
	}
	byName := map[string]ProviderProjection{}
	for _, pr := range p.Providers {
		byName[pr.Name] = pr
	}
	if pr := byName["hosted"]; pr.Endpoint != "https://api.example.com:8443/v1" ||
		pr.Classification != "remote" || pr.CredentialState != "available" || pr.APIFormat != "openai-compat" {
		t.Fatalf("hosted: %+v", pr)
	}
	if pr := byName["local"]; pr.Endpoint != "http://localhost:11434" ||
		pr.Classification != "local" || pr.CredentialState != "none" {
		t.Fatalf("local: %+v", pr)
	}
	if pr := byName["broken"]; pr.Endpoint != "" || pr.Classification != "unknown" {
		t.Fatalf("broken: %+v", pr)
	}
	var d *Diagnostic
	for i := range p.Diagnostics {
		if p.Diagnostics[i].Code == "provider_endpoint_unsupported" {
			d = &p.Diagnostics[i]
		}
	}
	if d == nil || d.SubjectKind != "provider" || d.SubjectName != "broken" || d.Blocking {
		t.Fatalf("endpoint diagnostic: %+v", p.Diagnostics)
	}
}

func TestBuildSettingsProjectionAgentEndpointBlocks(t *testing.T) {
	bad := strings.Replace(settingsFixtureJSON,
		`"hosted": {"base_url": "https://api.example.com:8443/v1/",`,
		`"hosted": {"base_url": "https://u:p@host/",`, 1)
	p := buildSettingsProjection(loadFixture(t, bad), nil)
	found := false
	for _, d := range p.Diagnostics {
		if d.Code == "provider_endpoint_unsupported" && d.SubjectName == "hosted" && d.Blocking {
			found = true
		}
	}
	if !found {
		t.Fatalf("agent-route endpoint failure must block: %+v", p.Diagnostics)
	}
}

// TestBuildSettingsProjectionBidiEndpointHostUnsupported: a Cc/Cf rune in the
// endpoint HOST (e.g. an RLO) is not rejected by net/url -- it only rejects
// bytes below 0x80 in the host -- so NormalizeEndpoint must reject it itself.
// The provider must still project (classification "unknown", endpoint ""),
// carrying a blocking provider_endpoint_unsupported since it's the agent
// route's provider.
func TestBuildSettingsProjectionBidiEndpointHostUnsupported(t *testing.T) {
	bad := strings.Replace(settingsFixtureJSON,
		`"hosted": {"base_url": "https://api.example.com:8443/v1/",`,
		`"hosted": {"base_url": "https://ex\u202eample.com/",`, 1)
	p := buildSettingsProjection(loadFixture(t, bad), nil)
	var hosted *ProviderProjection
	for i := range p.Providers {
		if p.Providers[i].Name == "hosted" {
			hosted = &p.Providers[i]
		}
	}
	if hosted == nil || hosted.Classification != "unknown" || hosted.Endpoint != "" {
		t.Fatalf("bidi-host provider projection = %+v", p.Providers)
	}
	blocking := false
	for _, d := range p.Diagnostics {
		if d.Code == "provider_endpoint_unsupported" && d.SubjectName == "hosted" && d.Blocking {
			blocking = true
		}
	}
	if !blocking {
		t.Fatalf("bidi-host agent-route endpoint failure must block: %+v", p.Diagnostics)
	}
}

func TestBuildSettingsProjectionAgentRoleDiagnostics(t *testing.T) {
	t.Run("no agent default", func(t *testing.T) {
		j := strings.Replace(settingsFixtureJSON, `"agent": "agent-m", `, "", 1)
		p := buildSettingsProjection(loadFixture(t, j), nil)
		if p.State != "ready" {
			t.Fatalf("state: %q", p.State)
		}
		found := false
		for _, d := range p.Diagnostics {
			if d.Code == "agent_role_missing" && d.Blocking {
				found = true
			}
		}
		if !found {
			t.Fatalf("want blocking agent_role_missing: %+v", p.Diagnostics)
		}
	})
	t.Run("caps missing tool_call", func(t *testing.T) {
		j := strings.Replace(settingsFixtureJSON,
			`["Tool_Call", "chat", "chat", "stream"]`, `["chat", "stream"]`, 1)
		p := buildSettingsProjection(loadFixture(t, j), nil)
		found := false
		for _, d := range p.Diagnostics {
			if d.Code == "agent_capabilities_insufficient" && d.Blocking && d.SubjectName == "agent-m" {
				found = true
			}
		}
		if !found {
			t.Fatalf("want blocking agent_capabilities_insufficient: %+v", p.Diagnostics)
		}
	})
}

func TestBuildSettingsProjectionFailures(t *testing.T) {
	t.Run("missing", func(t *testing.T) {
		p := buildSettingsProjection(loadedAgentConfig{Origin: originNone},
			fmt.Errorf("%w: nothing found", ErrAgentConfigMissing))
		if p.State != "missing" || p.SourceOrigin != "none" {
			t.Fatalf("%+v", p)
		}
		if len(p.Diagnostics) != 1 || p.Diagnostics[0].Code != "config_missing" || !p.Diagnostics[0].Blocking {
			t.Fatalf("%+v", p.Diagnostics)
		}
		if p.Routes == nil || p.Models == nil || p.Providers == nil {
			t.Fatal("collections must be empty slices, not nil")
		}
	})
	t.Run("json syntax", func(t *testing.T) {
		p := buildSettingsProjection(loadedAgentConfig{Origin: originEnv},
			fmt.Errorf("%w: %w", ErrAgentConfigInvalid, errConfigJSONSyntax))
		if p.State != "invalid" || p.SourceOrigin != "env" || p.Diagnostics[0].Code != "json_invalid" {
			t.Fatalf("%+v", p)
		}
	})
	t.Run("coarse invalid", func(t *testing.T) {
		p := buildSettingsProjection(loadedAgentConfig{Origin: originLegacy},
			fmt.Errorf("%w: configuration failed to load", ErrAgentConfigInvalid))
		if p.State != "invalid" || p.Diagnostics[0].Code != "config_invalid" {
			t.Fatalf("%+v", p)
		}
	})
}

func TestBuildSettingsProjectionNilConfigDegrades(t *testing.T) {
	p := buildSettingsProjection(loadedAgentConfig{Origin: originUserConfig}, nil)
	if p.State != "invalid" || len(p.Diagnostics) != 1 || p.Diagnostics[0].Code != "config_invalid" {
		t.Fatalf("%+v", p)
	}
}

// overLimitConfigJSON builds a valid config with n providers; n > 256 trips
// the entry bound. The agent route optionally points at a provider with an
// unsupported endpoint so the limited+blocking contract is testable.
func overLimitConfigJSON(n int, agentEndpointBad bool) string {
	var b strings.Builder
	b.WriteString(`{"providers": {`)
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteString(",")
		}
		fmt.Fprintf(&b, `"p%03d": {"base_url": "http://localhost:1"}`, i)
	}
	agentBase := "http://localhost:1"
	if agentEndpointBad {
		agentBase = "ftp://bad"
	}
	fmt.Fprintf(&b, `,"agent-p": {"base_url": %q}`, agentBase)
	b.WriteString(`}, "models": {"agent-m": {"name": "m", "provider": "agent-p", "type": "dense", "capabilities": ["chat","stream","tool_call"]}}, "defaults": {"agent": "agent-m"}}`)
	return b.String()
}

func TestBuildSettingsProjectionLimited(t *testing.T) {
	p := buildSettingsProjection(loadFixture(t, overLimitConfigJSON(257, false)), nil)
	if p.State != "limited" {
		t.Fatalf("state: %q", p.State)
	}
	if len(p.Routes) != 0 || len(p.Models) != 0 || len(p.Providers) != 0 {
		t.Fatal("limited projection must withhold collections")
	}
	if len(p.Diagnostics) != 1 || p.Diagnostics[0].Code != "projection_limited" || p.Diagnostics[0].Blocking {
		t.Fatalf("%+v", p.Diagnostics)
	}
}

// TestBuildSettingsProjectionLimitedKeepsAgentBlocking: limited must not
// conceal an unusable agent route — at most one bounded blocking agent
// diagnostic rides along (spec amendment).
func TestBuildSettingsProjectionLimitedKeepsAgentBlocking(t *testing.T) {
	p := buildSettingsProjection(loadFixture(t, overLimitConfigJSON(257, true)), nil)
	if p.State != "limited" {
		t.Fatalf("state: %q", p.State)
	}
	if len(p.Diagnostics) != 2 {
		t.Fatalf("want blocking agent diagnostic + projection_limited: %+v", p.Diagnostics)
	}
	if !p.Diagnostics[0].Blocking || p.Diagnostics[0].Code != "provider_endpoint_unsupported" {
		t.Fatalf("blocking agent diagnostic must sort first: %+v", p.Diagnostics)
	}
	if p.Diagnostics[1].Code != "projection_limited" {
		t.Fatalf("%+v", p.Diagnostics)
	}
}

func TestBuildSettingsProjectionOverlongIdentifierLimited(t *testing.T) {
	long := strings.Repeat("x", 257)
	j := strings.Replace(settingsFixtureJSON, `"chat-m"`, fmt.Sprintf("%q", long), 1)
	j = strings.Replace(j, `"chat": "chat-m"`, fmt.Sprintf(`"chat": %q`, long), 1)
	p := buildSettingsProjection(loadFixture(t, j), nil)
	if p.State != "limited" {
		t.Fatalf("state: %q", p.State)
	}
}

func TestBuildSettingsProjectionOverlongEndpointLimited(t *testing.T) {
	long := "http://localhost/" + strings.Repeat("a", maxProjectionEndpointLen)
	j := strings.Replace(settingsFixtureJSON, "http://localhost:11434", long, 1)
	p := buildSettingsProjection(loadFixture(t, j), nil)
	if p.State != "limited" {
		t.Fatalf("state: %q", p.State)
	}
}

// TestBuildSettingsProjectionBoundEdges pins the exact accept/withhold edges:
// at-limit configs stay ready, one past the limit goes limited. Bounds are
// UTF-8 byte counts.
func TestBuildSettingsProjectionBoundEdges(t *testing.T) {
	t.Run("providers at 256 ready, 257 limited", func(t *testing.T) {
		// overLimitConfigJSON(n, _) emits n numbered providers plus agent-p.
		if p := buildSettingsProjection(loadFixture(t, overLimitConfigJSON(255, false)), nil); p.State != "ready" {
			t.Fatalf("256 providers: state %q", p.State)
		}
		if p := buildSettingsProjection(loadFixture(t, overLimitConfigJSON(256, false)), nil); p.State != "limited" {
			t.Fatalf("257 providers: state %q", p.State)
		}
	})
	t.Run("endpoint at 1024 ready, 1025 limited", func(t *testing.T) {
		// Canonical form of "http://h/aaaa..." is the input unchanged: 9 bytes
		// of scheme+host+slash plus the path payload.
		at := "http://h/" + strings.Repeat("a", maxProjectionEndpointLen-9)
		over := at + "a"
		base := strings.Replace(settingsFixtureJSON, "http://localhost:11434", at, 1)
		if p := buildSettingsProjection(loadFixture(t, base), nil); p.State != "ready" {
			t.Fatalf("endpoint at limit: state %q", p.State)
		}
		base = strings.Replace(settingsFixtureJSON, "http://localhost:11434", over, 1)
		if p := buildSettingsProjection(loadFixture(t, base), nil); p.State != "limited" {
			t.Fatalf("endpoint over limit: state %q", p.State)
		}
	})
	t.Run("identifier at 256 bytes ready", func(t *testing.T) {
		exact := strings.Repeat("x", maxProjectionIdentifierLen)
		j := strings.Replace(settingsFixtureJSON, `"chat-m"`, fmt.Sprintf("%q", exact), 1)
		j = strings.Replace(j, `"chat": "chat-m"`, fmt.Sprintf(`"chat": %q`, exact), 1)
		if p := buildSettingsProjection(loadFixture(t, j), nil); p.State != "ready" {
			t.Fatalf("identifier at limit: state %q", p.State)
		}
	})
}

// TestBuildSettingsProjectionFromRealLoad drives config.LoadDocument end to
// end so defaults materialization (empty api_format -> "ollama") and ${ENV}
// key expansion are covered — the direct-unmarshal fixture cannot see those.
func TestBuildSettingsProjectionFromRealLoad(t *testing.T) {
	t.Setenv("FIRN_TEST_SET_KEY_263", "sk-REAL-LOAD-MARKER")
	dir := t.TempDir()
	p := filepath.Join(dir, "models.json")
	cfg := `{
  "providers": {"h": {"base_url": "http://localhost:11434", "api_key": "${FIRN_TEST_SET_KEY_263}"}},
  "models": {"agent-m": {"name": "m", "provider": "h", "type": "dense", "capabilities": ["chat","stream","tool_call"]}},
  "defaults": {"agent": "agent-m"}
}`
	if err := os.WriteFile(p, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	doc, err := config.LoadDocument(p)
	if err != nil {
		t.Fatalf("config.LoadDocument: %v", err)
	}
	readOnlyDiagnostic, readOnly := doc.ReadOnly()
	proj := buildSettingsProjection(loadedAgentConfig{
		Config: doc.Config(), SourcePath: p, LexicalPath: p, Origin: originUserConfig,
		Revision: doc.Revision(), ReadOnly: readOnly,
		ReadOnlyDiagnostic: readOnlyDiagnostic,
	}, nil)
	if proj.State != "ready" || proj.Revision != doc.Revision() ||
		proj.ReadOnly || !proj.Editable {
		t.Fatalf("document projection facts: %+v", proj)
	}
	if len(proj.Providers) != 1 {
		t.Fatalf("providers: %+v", proj.Providers)
	}
	if proj.Providers[0].APIFormat != "ollama" {
		t.Fatalf("defaults did not materialize api_format: %+v", proj.Providers[0])
	}
	if proj.Providers[0].CredentialState != "available" {
		t.Fatalf("expanded key must project as available: %+v", proj.Providers[0])
	}
	raw, err := json.Marshal(proj)
	if err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{"sk-REAL-LOAD-MARKER", "FIRN_TEST_SET_KEY_263", dir} {
		if strings.Contains(string(raw), marker) {
			t.Fatalf("projection leaks %q", marker)
		}
	}
}

// TestBuildSettingsProjectionSanitizesIdentifiers: control and bidi-format
// runes in config keys are scrubbed to U+FFFD before they cross the boundary
// — an RLO in a role name or a C0 control in a provider name could otherwise
// visually spoof the configuration view.
func TestBuildSettingsProjectionSanitizesIdentifiers(t *testing.T) {
	// U+202E (RLO) into the chat role key + route, U+0007 (BEL) into the
	// provider name + the model's provider reference. The escapes are
	// JSON-level: json.Unmarshal decodes them into the real runes.
	j := strings.Replace(settingsFixtureJSON, `"chat-m":`, `"chat\u202em":`, 1)
	j = strings.Replace(j, `"chat": "chat-m"`, `"chat": "chat\u202em"`, 1)
	j = strings.Replace(j, `"local":`, `"lo\u0007cal":`, 1)
	j = strings.Replace(j, `"provider": "local"`, `"provider": "lo\u0007cal"`, 1)

	p := buildSettingsProjection(loadFixture(t, j), nil)
	if p.State != "limited" || p.Editable || p.ReadOnly ||
		p.Revision != testSettingsRevision ||
		!projectionHasDiagnostic(p, codeIdentifierNotEditable, false) {
		t.Fatalf("unsafe-identifier document facts = %+v", p)
	}
	if p.Routes[1].Role != "chat\uFFFDm" {
		t.Fatalf("route role not sanitized: %q", p.Routes[1].Role)
	}
	roleByName := map[string]ModelProjection{}
	for _, m := range p.Models {
		roleByName[m.Role] = m
	}
	m, ok := roleByName["chat\uFFFDm"]
	if !ok || m.Provider != "lo\uFFFDcal" {
		t.Fatalf("model not sanitized: %+v", p.Models)
	}
	found := false
	for _, pr := range p.Providers {
		if pr.Name == "lo\uFFFDcal" {
			found = true
		}
	}
	if !found {
		t.Fatalf("provider name not sanitized: %+v", p.Providers)
	}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(string(raw), "\u202e\a") {
		t.Fatalf("raw control/bidi rune crossed the boundary: %s", raw)
	}
	if err := validateSettingsProjection(p); err != nil {
		t.Fatalf("sanitized projection must satisfy the oracle: %v", err)
	}
}

// TestSettingsProjectionSerializationLeaksNothing is the boundary proof.
func TestSettingsProjectionSerializationLeaksNothing(t *testing.T) {
	projections := []SettingsProjection{
		buildSettingsProjection(loadFixture(t, settingsFixtureJSON), nil),
		buildSettingsProjection(loadedAgentConfig{Origin: originEnv, LexicalPath: "/secret/lexical/models.json", SourcePath: "/secret/canonical/models.json"},
			fmt.Errorf("%w: %w", ErrAgentConfigInvalid, errConfigJSONSyntax)),
	}
	for i, p := range projections {
		raw, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		for _, marker := range []string{"/secret/", "models.json", "sk-EXPANDED-MARKER", "GO_LLM_CONFIG", "base_url", "api_key"} {
			if strings.Contains(string(raw), marker) {
				t.Fatalf("projection %d leaks %q: %s", i, marker, raw)
			}
		}
	}
}

// contractIdentifier is the shared identifier predicate: non-empty, within
// the byte bound, and free of Cc/Cf runes (the producer's sanitize pass never
// emits either).
func contractIdentifier(value string) bool {
	return value != "" && len(value) <= maxProjectionIdentifierLen &&
		!strings.ContainsFunc(value, func(r rune) bool {
			return unicode.In(r, unicode.Cc, unicode.Cf)
		})
}

func validSettingsRevision(value string) bool {
	if len(value) != 64 {
		return false
	}
	for i := range value {
		if (value[i] < '0' || value[i] > '9') &&
			(value[i] < 'a' || value[i] > 'f') {
			return false
		}
	}
	return true
}

func capabilityPosition(value string) int {
	for i, candidate := range provider.CanonicalCapabilityNames {
		if value == candidate {
			return i
		}
	}
	return -1
}

func canonicalCapabilityList(values []string) bool {
	if values == nil {
		return false
	}
	previous := -1
	for _, value := range values {
		position := capabilityPosition(value)
		if position <= previous {
			return false
		}
		previous = position
	}
	return true
}

func strictStringList(values []string) bool {
	if values == nil {
		return false
	}
	for i := 1; i < len(values); i++ {
		if values[i-1] >= values[i] {
			return false
		}
	}
	return true
}

func diagnosticBefore(left, right Diagnostic) bool {
	if left.Blocking != right.Blocking {
		return left.Blocking
	}
	if left.Code != right.Code {
		return left.Code < right.Code
	}
	if left.SubjectKind != right.SubjectKind {
		return left.SubjectKind < right.SubjectKind
	}
	return left.SubjectName < right.SubjectName
}

// validateSettingsProjection checks every enum and bound of the Slice-A
// contract. It is the Go twin of the frontend validator; the corpus keeps the
// two honest against the same fixtures.
func validateSettingsProjection(p SettingsProjection) error {
	states := map[string]bool{"missing": true, "invalid": true, "limited": true, "ready": true}
	origins := map[string]bool{"none": true, "env": true, "working_directory": true, "user_config": true, "legacy": true}
	if !states[p.State] || !origins[p.SourceOrigin] {
		return fmt.Errorf("state/source %q/%q", p.State, p.SourceOrigin)
	}
	loaded := p.State == "ready" || p.State == "limited"
	if (loaded && !validSettingsRevision(p.Revision)) || (!loaded && p.Revision != "") {
		return fmt.Errorf("revision/state %q/%q", p.Revision, p.State)
	}
	if !loaded && (p.ReadOnly || p.Editable || len(p.Routes) != 0 ||
		len(p.Models) != 0 || len(p.Providers) != 0) {
		return fmt.Errorf("unloaded projection carries document state")
	}
	if p.State == "ready" && (p.ReadOnly || !p.Editable) {
		return fmt.Errorf("ready projection is not writable")
	}
	if p.Routes == nil || p.Models == nil || p.Providers == nil || p.Diagnostics == nil {
		return fmt.Errorf("null root collection")
	}
	if len(p.Routes) > maxProjectionEntries || len(p.Models) > maxProjectionEntries ||
		len(p.Providers) > maxProjectionEntries || len(p.Diagnostics) > maxProjectionDiagnostics {
		return fmt.Errorf("collection over bound")
	}

	for i, route := range p.Routes {
		if !contractIdentifier(route.UseCase) || !contractIdentifier(route.Role) {
			return fmt.Errorf("route[%d] = %+v", i, route)
		}
		if i > 0 && p.Routes[i-1].UseCase >= route.UseCase {
			return fmt.Errorf("routes are not unique canonical use-case order")
		}
	}

	modelTypes := map[string]bool{"dense": true, "moe": true, "embedding": true}
	thinkModes := map[string]bool{"": true, "none": true, "always": true, "toggle": true, "auto": true}
	for i, model := range p.Models {
		if !contractIdentifier(model.Role) || !contractIdentifier(model.ModelName) ||
			!contractIdentifier(model.Provider) || !modelTypes[model.Type] ||
			!thinkModes[model.ThinkMode] {
			return fmt.Errorf("model[%d] = %+v", i, model)
		}
		if model.Parameters != "" && !contractIdentifier(model.Parameters) {
			return fmt.Errorf("model[%d].parameters", i)
		}
		if model.ContextWindow < 0 || model.ContextWindow > 2147483647 ||
			model.Dimensions < 0 || model.Dimensions > 2147483647 {
			return fmt.Errorf("model[%d] numeric fact", i)
		}
		if !canonicalCapabilityList(model.EffectiveCapabilities) ||
			!canonicalCapabilityList(model.CapabilityFacts.Caps) ||
			!canonicalCapabilityList(model.CapabilityFacts.KnownCaps) ||
			!canonicalCapabilityList(model.ExposedCapabilities) ||
			len(model.RoutedUseCases) > maxProjectionEntries ||
			!strictStringList(model.RoutedUseCases) {
			return fmt.Errorf("model[%d] non-canonical array", i)
		}
		for _, useCase := range model.RoutedUseCases {
			if !contractIdentifier(useCase) {
				return fmt.Errorf("model[%d] routed use case %q", i, useCase)
			}
		}
		known := make(map[string]bool, len(model.CapabilityFacts.KnownCaps))
		for _, capability := range model.CapabilityFacts.KnownCaps {
			known[capability] = true
		}
		for _, capability := range model.CapabilityFacts.Caps {
			if !known[capability] {
				return fmt.Errorf("model[%d] caps not subset of knownCaps", i)
			}
		}
		if i > 0 && p.Models[i-1].Role >= model.Role {
			return fmt.Errorf("models are not unique canonical role order")
		}
	}

	classifications := map[string]bool{"local": true, "remote": true, "unknown": true}
	apiFormats := map[string]bool{"ollama": true, "openai-compat": true}
	credentials := map[string]bool{"none": true, "available": true, "reference_unavailable": true}
	for i, projectedProvider := range p.Providers {
		if !contractIdentifier(projectedProvider.Name) ||
			len(projectedProvider.Endpoint) > maxProjectionEndpointLen ||
			(projectedProvider.Endpoint != "" && strings.ContainsFunc(projectedProvider.Endpoint, func(r rune) bool {
				return unicode.In(r, unicode.Cc, unicode.Cf) || r > unicode.MaxASCII
			})) ||
			!classifications[projectedProvider.Classification] ||
			!apiFormats[projectedProvider.APIFormat] ||
			!credentials[projectedProvider.CredentialState] {
			return fmt.Errorf("provider[%d] = %+v", i, projectedProvider)
		}
		if i > 0 && p.Providers[i-1].Name >= projectedProvider.Name {
			return fmt.Errorf("providers are not unique canonical name order")
		}
	}

	codes := make(map[string]bool, len(settingsDiagnosticCodes))
	for _, code := range settingsDiagnosticCodes {
		codes[code] = true
	}
	kinds := map[string]bool{"": true, "use_case": true, "role": true, "model": true, "provider": true}
	for i, diagnostic := range p.Diagnostics {
		if !codes[diagnostic.Code] || !kinds[diagnostic.SubjectKind] ||
			(diagnostic.SubjectName != "" && !contractIdentifier(diagnostic.SubjectName)) {
			return fmt.Errorf("diagnostic[%d] = %+v", i, diagnostic)
		}
		if i > 0 && !diagnosticBefore(p.Diagnostics[i-1], diagnostic) {
			return fmt.Errorf("diagnostics are not unique canonical order")
		}
	}
	return nil
}

func contractObject(raw json.RawMessage, where string) (map[string]json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, fmt.Errorf("%s is not an object", where)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &object); err != nil {
		return nil, fmt.Errorf("%s: %v", where, err)
	}
	return object, nil
}

func contractField(object map[string]json.RawMessage, key, where string) (json.RawMessage, error) {
	raw, ok := object[key]
	if !ok {
		return nil, fmt.Errorf("%s missing %q", where, key)
	}
	return raw, nil
}

func contractStringField(object map[string]json.RawMessage, key, where string) (string, error) {
	raw, err := contractField(object, key, where)
	if err != nil {
		return "", err
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '"' {
		return "", fmt.Errorf("%s.%s is not a string", where, key)
	}
	var value string
	if err := json.Unmarshal(trimmed, &value); err != nil {
		return "", fmt.Errorf("%s.%s: %v", where, key, err)
	}
	return value, nil
}

func contractBoolField(object map[string]json.RawMessage, key, where string) error {
	raw, err := contractField(object, key, where)
	if err != nil {
		return err
	}
	value := string(bytes.TrimSpace(raw))
	if value != "true" && value != "false" {
		return fmt.Errorf("%s.%s is not a boolean", where, key)
	}
	return nil
}

func contractArrayField(object map[string]json.RawMessage, key, where string) ([]json.RawMessage, error) {
	raw, err := contractField(object, key, where)
	if err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return nil, fmt.Errorf("%s.%s is not an array", where, key)
	}
	var values []json.RawMessage
	if err := json.Unmarshal(trimmed, &values); err != nil {
		return nil, fmt.Errorf("%s.%s: %v", where, key, err)
	}
	return values, nil
}

func contractObjectField(object map[string]json.RawMessage, key, where string) (map[string]json.RawMessage, error) {
	raw, err := contractField(object, key, where)
	if err != nil {
		return nil, err
	}
	return contractObject(raw, where+"."+key)
}

func contractOptionalIdentifierField(object map[string]json.RawMessage, key, where string) error {
	if _, ok := object[key]; !ok {
		return nil
	}
	value, err := contractStringField(object, key, where)
	if err != nil {
		return err
	}
	if !contractIdentifier(value) {
		return fmt.Errorf("%s.%s is not an Identifier", where, key)
	}
	return nil
}

func contractOptionalPositiveIntField(object map[string]json.RawMessage, key, where string) error {
	raw, ok := object[key]
	if !ok {
		return nil
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || (trimmed[0] != '-' && (trimmed[0] < '0' || trimmed[0] > '9')) {
		return fmt.Errorf("%s.%s is not an integer", where, key)
	}
	var value int64
	if err := json.Unmarshal(trimmed, &value); err != nil || value < 1 || value > 2147483647 {
		return fmt.Errorf("%s.%s is not in 1..2147483647", where, key)
	}
	return nil
}

// structuralCheck verifies the raw JSON shape of a projection: every required
// key present at every level, arrays non-null (including nested
// effectiveCapabilities). Value validity (enums, bounds) belongs to
// validateSettingsProjection; presence is checked here because typed decoding
// erases the difference between an explicit zero value and an absent key. The
// small raw-shape helpers above distinguish absent, null, and typed zero
// values without introducing a schema package.
func structuralCheck(projection json.RawMessage) error {
	root, err := contractObject(projection, "projection")
	if err != nil {
		return err
	}
	state, err := contractStringField(root, "state", "projection")
	if err != nil {
		return err
	}
	if _, err := contractStringField(root, "sourceOrigin", "projection"); err != nil {
		return err
	}
	loaded := state == "ready" || state == "limited"
	_, hasRevision := root["revision"]
	if loaded != hasRevision {
		return fmt.Errorf("projection revision presence does not match state %q", state)
	}
	if hasRevision {
		if _, err := contractStringField(root, "revision", "projection"); err != nil {
			return err
		}
	}
	for _, key := range []string{"readOnly", "editable"} {
		if err := contractBoolField(root, key, "projection"); err != nil {
			return err
		}
	}

	routes, err := contractArrayField(root, "routes", "projection")
	if err != nil {
		return err
	}
	for i, raw := range routes {
		where := fmt.Sprintf("projection.routes[%d]", i)
		fields, err := contractObject(raw, where)
		if err != nil {
			return err
		}
		for _, key := range []string{"useCase", "role"} {
			if _, err := contractStringField(fields, key, where); err != nil {
				return err
			}
		}
	}

	models, err := contractArrayField(root, "models", "projection")
	if err != nil {
		return err
	}
	for i, raw := range models {
		where := fmt.Sprintf("projection.models[%d]", i)
		fields, err := contractObject(raw, where)
		if err != nil {
			return err
		}
		for _, key := range []string{"role", "modelName", "provider", "type", "thinkMode"} {
			if _, err := contractStringField(fields, key, where); err != nil {
				return err
			}
		}
		if err := contractOptionalIdentifierField(fields, "parameters", where); err != nil {
			return err
		}
		for _, key := range []string{"contextWindow", "dimensions"} {
			if err := contractOptionalPositiveIntField(fields, key, where); err != nil {
				return err
			}
		}
		for _, key := range []string{"effectiveCapabilities", "exposedCapabilities", "routedUseCases"} {
			if _, err := contractArrayField(fields, key, where); err != nil {
				return err
			}
		}
		facts, err := contractObjectField(fields, "capabilityFacts", where)
		if err != nil {
			return err
		}
		for _, key := range []string{"caps", "knownCaps"} {
			if _, err := contractArrayField(facts, key, where+".capabilityFacts"); err != nil {
				return err
			}
		}
		if err := contractBoolField(fields, "removable", where); err != nil {
			return err
		}
	}

	providers, err := contractArrayField(root, "providers", "projection")
	if err != nil {
		return err
	}
	for i, raw := range providers {
		where := fmt.Sprintf("projection.providers[%d]", i)
		fields, err := contractObject(raw, where)
		if err != nil {
			return err
		}
		for _, key := range []string{"name", "endpoint", "classification", "apiFormat", "credentialState"} {
			if _, err := contractStringField(fields, key, where); err != nil {
				return err
			}
		}
	}

	diagnostics, err := contractArrayField(root, "diagnostics", "projection")
	if err != nil {
		return err
	}
	for i, raw := range diagnostics {
		where := fmt.Sprintf("projection.diagnostics[%d]", i)
		fields, err := contractObject(raw, where)
		if err != nil {
			return err
		}
		for _, key := range []string{"code", "subjectKind", "subjectName"} {
			if _, err := contractStringField(fields, key, where); err != nil {
				return err
			}
		}
		if err := contractBoolField(fields, "blocking", where); err != nil {
			return err
		}
	}
	return nil
}

// TestSettingsContractCorpus keeps the Go and TS validators honest against the
// same fixtures: accept fixtures must decode strictly and validate; reject
// fixtures must fail decoding or validation.
func TestSettingsContractCorpus(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("testdata", "settings_contract", "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("corpus missing: %v (%d files)", err, len(files))
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var entry struct {
			Verdict    string          `json:"verdict"`
			Projection json.RawMessage `json:"projection"`
		}
		if err := json.Unmarshal(raw, &entry); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		structuralErr := structuralCheck(entry.Projection)
		var p SettingsProjection
		dec := json.NewDecoder(bytes.NewReader(entry.Projection))
		dec.DisallowUnknownFields()
		decodeErr := dec.Decode(&p)
		var validateErr error
		if decodeErr == nil {
			validateErr = validateSettingsProjection(p)
		}
		switch entry.Verdict {
		case "accept":
			if structuralErr != nil || decodeErr != nil || validateErr != nil {
				t.Fatalf("%s: accept fixture rejected (structural=%v decode=%v validate=%v)", f, structuralErr, decodeErr, validateErr)
			}
		case "reject":
			if structuralErr == nil && decodeErr == nil && validateErr == nil {
				t.Fatalf("%s: reject fixture passed every check", f)
			}
		default:
			t.Fatalf("%s: verdict %q", f, entry.Verdict)
		}
	}
}

// TestCapabilityVocabularyPinned fails when a go-llm bump changes the
// canonical capability set, forcing the TS validator's closed list (and the
// corpus) to be updated in the same change instead of breaking in the UI.
func TestCapabilityVocabularyPinned(t *testing.T) {
	want := []string{"chat", "generate", "stream", "embed", "tool_call", "thinking", "insert"}
	got := provider.CanonicalCapabilityNames
	if len(got) != len(want) {
		t.Fatalf("capability vocabulary changed: %v (update frontend/src/types/golem.ts CAPABILITY_NAMES and the settings contract corpus in the same change)", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("capability vocabulary changed at %d: %v", i, got)
		}
	}
}

func TestProjectedOriginCollapsesUnknown(t *testing.T) {
	if got := projectedOrigin(sourceOrigin("future_branch")); got != "none" {
		t.Fatalf("unknown origin projected as %q, want none", got)
	}
	if got := projectedOrigin(""); got != "none" {
		t.Fatalf("zero origin projected as %q, want none", got)
	}
}

type settingsDiagnosticMappingCase struct {
	Input       string `json:"input"`
	Output      string `json:"output"`
	KeepSubject bool   `json:"keepSubject"`
	Blocking    bool   `json:"blocking"`
}

func loadSettingsDiagnosticMapping(t *testing.T) []settingsDiagnosticMappingCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "settings_diagnostic_mapping.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []settingsDiagnosticMappingCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	return cases
}

func TestMapConfigDiagnosticContract(t *testing.T) {
	cases := loadSettingsDiagnosticMapping(t)
	if len(cases) != 28 {
		t.Fatalf("mapping rows = %d, want 27 upstream codes plus unknown", len(cases))
	}
	if got := cases[len(cases)-1].Input; got != "certified_future_code" {
		t.Fatalf("last mapping input = %q, want unknown-future sentinel", got)
	}

	seen := map[string]bool{}
	for _, tc := range cases {
		if seen[tc.Input] {
			t.Fatalf("duplicate mapping input %q", tc.Input)
		}
		seen[tc.Input] = true
		t.Run(tc.Input, func(t *testing.T) {
			got := mapConfigDiagnostic(config.Diagnostic{
				Code:        config.ErrorCode(tc.Input),
				SubjectKind: config.SubjectProvider,
				Subject:     "p1",
			})
			wantKind, wantName := "", ""
			if tc.KeepSubject {
				wantKind, wantName = "provider", "p1"
			}
			if got.Code != tc.Output || got.SubjectKind != wantKind ||
				got.SubjectName != wantName || got.Blocking != tc.Blocking {
				t.Fatalf("mapConfigDiagnostic = %+v, want code=%q kind=%q name=%q blocking=%v",
					got, tc.Output, wantKind, wantName, tc.Blocking)
			}
		})
	}
}

func TestMapConfigDiagnosticSubjectKinds(t *testing.T) {
	cases := []struct {
		name     string
		kind     config.SubjectKind
		wantKind string
		wantName string
	}{
		{name: "none", kind: config.SubjectNone},
		{name: "provider", kind: config.SubjectProvider, wantKind: "provider", wantName: "subject"},
		{name: "role", kind: config.SubjectRole, wantKind: "role", wantName: "subject"},
		{name: "use_case", kind: config.SubjectUseCase, wantKind: "use_case", wantName: "subject"},
		{name: "unknown", kind: config.SubjectKind("future_kind")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mapConfigDiagnostic(config.Diagnostic{
				Code: config.CodeModelInvalid, SubjectKind: tc.kind, Subject: "subject",
			})
			if got.Code != codeModelInvalid || got.SubjectKind != tc.wantKind ||
				got.SubjectName != tc.wantName || !got.Blocking {
				t.Fatalf("mapConfigDiagnostic = %+v", got)
			}
		})
	}
}

func TestSettingsDiagnosticCodesSliceAOrder(t *testing.T) {
	want := []string{
		"config_missing", "json_invalid", "config_invalid",
		"agent_role_missing", "agent_capabilities_insufficient",
		"provider_endpoint_unsupported", "projection_limited",
		"duplicate_keys", "provider_required", "provider_name_invalid",
		"provider_endpoint_invalid", "provider_format_invalid",
		"slot_policy_invalid", "model_invalid", "think_invalid",
		"provider_not_found", "defaults_invalid", "key_reference_malformed",
		"key_reference_unavailable", "selector_conflict",
		"identifier_not_editable",
	}
	if fmt.Sprint(settingsDiagnosticCodes) != fmt.Sprint(want) {
		t.Fatalf("diagnostic codes = %v, want %v", settingsDiagnosticCodes, want)
	}
}

func TestSettingsProjectionOracleAcceptsSliceADiagnostics(t *testing.T) {
	p := emptyProjection("limited", originUserConfig)
	p.Revision = testSettingsRevision
	p.Editable = false
	p.Diagnostics = []Diagnostic{
		{Code: codeDefaultsInvalid, SubjectKind: "use_case", SubjectName: "agent", Blocking: true},
		{Code: codeIdentifierNotEditable},
	}
	if err := validateSettingsProjection(p); err != nil {
		t.Fatalf("Slice-A diagnostics rejected: %v", err)
	}
}

func TestProjectionUsesTypedLoadDiagnostic(t *testing.T) {
	loaded := loadedAgentConfig{
		Origin: originUserConfig,
		ConfigDiagnostic: config.Diagnostic{
			Code:        config.CodeKeyReferenceUnavailable,
			SubjectKind: config.SubjectProvider,
			Subject:     "hosted",
		},
		HasConfigDiagnostic: true,
	}
	p := buildSettingsProjection(loaded,
		fmt.Errorf("%w: configuration failed to load", ErrAgentConfigInvalid))
	if p.State != "invalid" || len(p.Diagnostics) != 1 {
		t.Fatalf("projection = %+v", p)
	}
	d := p.Diagnostics[0]
	if d.Code != codeKeyReferenceUnavailable || d.SubjectKind != "provider" ||
		d.SubjectName != "hosted" || !d.Blocking {
		t.Fatalf("diagnostic = %+v", d)
	}
}

// TestProjectionLoadErrorDiagnosticSubjectBounded: the load-error/typed-
// diagnostic path is the only appendDiagnostic site that historically skipped
// boundSubject. An oversized subject (from a future go-llm upstream — today's
// pinned version truncates well under the bound, but nothing asserts that)
// must never cross the boundary unbounded.
func TestProjectionLoadErrorDiagnosticSubjectBounded(t *testing.T) {
	loaded := loadedAgentConfig{
		Origin: originUserConfig,
		ConfigDiagnostic: config.Diagnostic{
			Code:        config.CodeKeyReferenceUnavailable,
			SubjectKind: config.SubjectProvider,
			Subject:     strings.Repeat("s", 300),
		},
		HasConfigDiagnostic: true,
	}
	p := buildSettingsProjection(loaded,
		fmt.Errorf("%w: configuration failed to load", ErrAgentConfigInvalid))
	if len(p.Diagnostics) != 1 {
		t.Fatalf("diagnostics = %+v", p.Diagnostics)
	}
	d := p.Diagnostics[0]
	// boundSubject's actual behavior for an over-limit subject: drop it
	// entirely (SubjectKind/SubjectName both cleared), not truncate it.
	if d.Code != codeKeyReferenceUnavailable || d.SubjectKind != "" ||
		d.SubjectName != "" || !d.Blocking {
		t.Fatalf("diagnostic = %+v", d)
	}
	if err := validateSettingsProjection(p); err != nil {
		t.Fatalf("oversized-subject diagnostic rejected by the oracle: %v", err)
	}
}

func TestProjectionForcesTypedLoadDiagnosticBlocking(t *testing.T) {
	loaded := loadedAgentConfig{
		Origin: originUserConfig,
		ConfigDiagnostic: config.Diagnostic{
			Code:        config.CodeDuplicateKeys,
			SubjectKind: config.SubjectProvider,
			Subject:     "local",
		},
		HasConfigDiagnostic: true,
	}
	p := buildSettingsProjection(loaded,
		fmt.Errorf("%w: configuration failed to load", ErrAgentConfigInvalid))
	if len(p.Diagnostics) != 1 || p.Diagnostics[0].Code != codeDuplicateKeys ||
		!p.Diagnostics[0].Blocking {
		t.Fatalf("diagnostics = %+v", p.Diagnostics)
	}
}

// TestProjectionLoadErrorConfigNotFoundProjectsAsMissing: mapConfigDiagnostic
// maps config.CodeConfigNotFound to codeConfigMissing, so a load-error branch
// that always emits state "invalid" would produce a self-contradicting
// invalid/config_missing pair. A typed config_not_found diagnostic must
// project as the Missing document, not Invalid.
func TestProjectionLoadErrorConfigNotFoundProjectsAsMissing(t *testing.T) {
	loaded := loadedAgentConfig{
		Origin:              originUserConfig,
		ConfigDiagnostic:    config.Diagnostic{Code: config.CodeConfigNotFound},
		HasConfigDiagnostic: true,
	}
	p := buildSettingsProjection(loaded,
		fmt.Errorf("%w: configuration failed to load", ErrAgentConfigInvalid))
	if p.State != "missing" || p.SourceOrigin != "none" {
		t.Fatalf("projection = %+v", p)
	}
	if len(p.Diagnostics) != 1 || p.Diagnostics[0].Code != codeConfigMissing || !p.Diagnostics[0].Blocking {
		t.Fatalf("diagnostics = %+v", p.Diagnostics)
	}
}

func TestProjectionUnknownDiagnosticFailsClosed(t *testing.T) {
	loaded := loadedAgentConfig{
		Origin: originUserConfig,
		ConfigDiagnostic: config.Diagnostic{
			Code:        config.ErrorCode("certified_future_code"),
			SubjectKind: config.SubjectUseCase,
			Subject:     "agent",
		},
		HasConfigDiagnostic: true,
	}
	p := buildSettingsProjection(loaded,
		fmt.Errorf("%w: configuration failed to load", ErrAgentConfigInvalid))
	if len(p.Diagnostics) != 1 {
		t.Fatalf("diagnostics = %+v", p.Diagnostics)
	}
	d := p.Diagnostics[0]
	if d.Code != codeConfigInvalid || d.SubjectKind != "" ||
		d.SubjectName != "" || !d.Blocking {
		t.Fatalf("diagnostic = %+v", d)
	}
}

package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode"

	"github.com/kstruzzieri/go-llm/config"
	"github.com/kstruzzieri/go-llm/provider"
)

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

// TestBuildSettingsProjectionFromRealLoad drives config.Load end to end so
// defaults materialization (empty api_format -> "ollama") and ${ENV} key
// expansion are covered — the direct-unmarshal fixture cannot see those.
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
	loaded, err := config.Load(p)
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	proj := buildSettingsProjection(loadedAgentConfig{
		Config: loaded, SourcePath: p, LexicalPath: p, Origin: originUserConfig,
	}, nil)
	if proj.State != "ready" {
		t.Fatalf("state: %q", proj.State)
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
	if p.State != "ready" {
		t.Fatalf("state: %q", p.State)
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

// forbiddenIdentifierRunes is the contract's explicit identifier reject list:
// C0/C1 controls plus the bidi/format runes that can reorder or hide
// characters (soft hyphen, zero-widths, LRM/RLM, bidi embeddings/overrides,
// word joiner..invisible operators, bidi isolates, BOM/ZWNBSP). It MUST stay
// identical to FORBIDDEN_IDENTIFIER_RUNES in frontend/src/types/golem.ts — a
// JS regex cannot express the full Cf category, so the contract is this
// explicit list on both sides, or a corpus fixture with an exotic Cf rune
// would split verdicts between the oracles. The builder's scrub is BROADER
// (all of Cc/Cf), which is safe: producer stricter than contract.
var forbiddenIdentifierRunes = &unicode.RangeTable{
	R16: []unicode.Range16{
		{Lo: 0x0000, Hi: 0x001F, Stride: 1},
		{Lo: 0x007F, Hi: 0x009F, Stride: 1},
		{Lo: 0x00AD, Hi: 0x00AD, Stride: 1},
		{Lo: 0x200B, Hi: 0x200F, Stride: 1},
		{Lo: 0x202A, Hi: 0x202E, Stride: 1},
		{Lo: 0x2060, Hi: 0x2064, Stride: 1},
		{Lo: 0x2066, Hi: 0x2069, Stride: 1},
		{Lo: 0xFEFF, Hi: 0xFEFF, Stride: 1},
	},
	LatinOffset: 2,
}

// validateSettingsProjection checks every enum and bound of the Phase 1
// contract. It is the Go twin of the frontend validator; the corpus keeps the
// two honest against the same fixtures.
func validateSettingsProjection(p SettingsProjection) error {
	states := map[string]bool{"missing": true, "invalid": true, "limited": true, "ready": true}
	if !states[p.State] {
		return fmt.Errorf("state %q", p.State)
	}
	origins := map[string]bool{"none": true, "env": true, "working_directory": true, "user_config": true, "legacy": true}
	if !origins[p.SourceOrigin] {
		return fmt.Errorf("sourceOrigin %q", p.SourceOrigin)
	}
	if len(p.Routes) > maxProjectionEntries || len(p.Models) > maxProjectionEntries ||
		len(p.Providers) > maxProjectionEntries || len(p.Diagnostics) > maxProjectionDiagnostics {
		return fmt.Errorf("collection over bound")
	}
	// badIdent: over the byte bound, or carrying a forbidden rune the producer
	// contractually never emits (builder scrubs Cc/Cf to U+FFFD first).
	badIdent := func(s string) bool {
		return len(s) > maxProjectionIdentifierLen ||
			strings.ContainsFunc(s, func(r rune) bool { return unicode.Is(forbiddenIdentifierRunes, r) })
	}
	caps := map[string]bool{}
	for _, name := range provider.CanonicalCapabilityNames {
		caps[name] = true
	}
	for _, r := range p.Routes {
		if badIdent(r.UseCase) || badIdent(r.Role) {
			return fmt.Errorf("route %+v", r)
		}
	}
	for _, m := range p.Models {
		if badIdent(m.Role) || badIdent(m.ModelName) || badIdent(m.Provider) || badIdent(m.Type) || badIdent(m.ThinkMode) {
			return fmt.Errorf("model %+v", m)
		}
		if len(m.EffectiveCapabilities) > len(provider.CanonicalCapabilityNames) {
			return fmt.Errorf("capabilities over vocabulary size")
		}
		for _, c := range m.EffectiveCapabilities {
			if !caps[c] {
				return fmt.Errorf("capability %q", c)
			}
		}
	}
	classifications := map[string]bool{"local": true, "remote": true, "unknown": true}
	credentials := map[string]bool{"none": true, "available": true, "reference_unavailable": true}
	for _, pr := range p.Providers {
		if pr.Name == "" || badIdent(pr.Name) || badIdent(pr.APIFormat) || len(pr.Endpoint) > maxProjectionEndpointLen {
			return fmt.Errorf("provider %+v", pr)
		}
		if !classifications[pr.Classification] {
			return fmt.Errorf("classification %q", pr.Classification)
		}
		if !credentials[pr.CredentialState] {
			return fmt.Errorf("credentialState %q", pr.CredentialState)
		}
	}
	codes := map[string]bool{}
	for _, c := range settingsDiagnosticCodes {
		codes[c] = true
	}
	kinds := map[string]bool{
		"": true, "role": true, "model": true, "provider": true, "use_case": true,
	}
	for _, d := range p.Diagnostics {
		if !codes[d.Code] {
			return fmt.Errorf("diagnostic code %q", d.Code)
		}
		if !kinds[d.SubjectKind] {
			return fmt.Errorf("subjectKind %q", d.SubjectKind)
		}
		if badIdent(d.SubjectName) {
			return fmt.Errorf("subjectName over bound or forbidden rune")
		}
	}
	return nil
}

// structuralCheck verifies the raw JSON shape of a projection: every required
// key present at every level, arrays non-null (including nested
// effectiveCapabilities). Value validity (enums, bounds) belongs to
// validateSettingsProjection; presence is checked here because typed decoding
// erases the difference between an explicit zero value and an absent key.
func structuralCheck(projection json.RawMessage) error {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(projection, &root); err != nil {
		return err
	}
	for _, key := range []string{"state", "sourceOrigin"} {
		raw, ok := root[key]
		if !ok {
			return fmt.Errorf("missing key %q", key)
		}
		trimmed := bytes.TrimSpace(raw)
		if len(trimmed) == 0 || trimmed[0] != '"' {
			return fmt.Errorf("key %q is not a string", key)
		}
	}
	requiredItemKeys := map[string][]string{
		"routes":      {"useCase", "role"},
		"models":      {"role", "modelName", "provider", "type", "effectiveCapabilities", "thinkMode"},
		"providers":   {"name", "endpoint", "classification", "apiFormat", "credentialState"},
		"diagnostics": {"code", "subjectKind", "subjectName", "blocking"},
	}
	for _, key := range []string{"routes", "models", "providers", "diagnostics"} {
		raw, ok := root[key]
		if !ok {
			return fmt.Errorf("missing key %q", key)
		}
		trimmed := bytes.TrimSpace(raw)
		if len(trimmed) == 0 || trimmed[0] != '[' {
			return fmt.Errorf("key %q is not an array", key)
		}
		var items []json.RawMessage
		if err := json.Unmarshal(raw, &items); err != nil {
			return fmt.Errorf("key %q: %v", key, err)
		}
		for i, item := range items {
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(item, &fields); err != nil {
				return fmt.Errorf("%s[%d]: %v", key, i, err)
			}
			for _, field := range requiredItemKeys[key] {
				fieldRaw, ok := fields[field]
				if !ok {
					return fmt.Errorf("%s[%d] missing %q", key, i, field)
				}
				ft := bytes.TrimSpace(fieldRaw)
				switch field {
				case "effectiveCapabilities":
					if len(ft) == 0 || ft[0] != '[' {
						return fmt.Errorf("%s[%d].%s is not an array", key, i, field)
					}
				case "blocking":
					if string(ft) != "true" && string(ft) != "false" {
						return fmt.Errorf("%s[%d].%s is not a boolean", key, i, field)
					}
				default:
					if len(ft) == 0 || ft[0] != '"' {
						return fmt.Errorf("%s[%d].%s is not a string", key, i, field)
					}
				}
			}
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

package ai

import (
	"errors"
	"sort"

	"github.com/kstruzzieri/go-llm/config"
	"github.com/kstruzzieri/go-llm/provider"
)

// Response bounds for the settings projection (mirrored exactly by the
// frontend validators and the testdata/settings_contract corpus). Exceeding
// them never redefines go-llm validity: the runtime target still resolves,
// the projection is withheld as state "limited" instead.
const (
	maxProjectionEntries       = 256
	maxProjectionIdentifierLen = 256
	maxProjectionEndpointLen   = 1024
	// maxProjectionDiagnostics is the worst case the builder can emit: one
	// provider_endpoint_unsupported per provider plus one agent diagnostic.
	maxProjectionDiagnostics = maxProjectionEntries + 1
)

// SettingsProjection is the Wails-facing read-only view of the effective Golem
// configuration. It never carries filesystem paths, raw JSON, API keys,
// environment variable names, or raw go-llm error text.
type SettingsProjection struct {
	State        string               `json:"state"`        // missing | invalid | limited | ready
	SourceOrigin string               `json:"sourceOrigin"` // none | env | working_directory | user_config | legacy
	Routes       []RouteProjection    `json:"routes"`
	Models       []ModelProjection    `json:"models"`
	Providers    []ProviderProjection `json:"providers"`
	Diagnostics  []Diagnostic         `json:"diagnostics"`
}

// RouteProjection is one defaults.* entry: use case -> model role.
type RouteProjection struct {
	UseCase string `json:"useCase"`
	Role    string `json:"role"`
}

// ModelProjection is one models-map entry. Role is the map key (a role name);
// ModelName is the provider's model ID — different namespaces, both shown.
type ModelProjection struct {
	Role                  string   `json:"role"`
	ModelName             string   `json:"modelName"`
	Provider              string   `json:"provider"`
	Type                  string   `json:"type"`
	EffectiveCapabilities []string `json:"effectiveCapabilities"`
	ThinkMode             string   `json:"thinkMode"`
}

// ProviderProjection is one provider. Endpoint is the NormalizeEndpoint
// canonical form, "" when not derivable (Classification then "unknown").
// CredentialState is presence, not a usability promise; reference_unavailable
// becomes reachable only with the Phase 2 document layer.
type ProviderProjection struct {
	Name            string `json:"name"`
	Endpoint        string `json:"endpoint"`
	Classification  string `json:"classification"` // local | remote | unknown
	APIFormat       string `json:"apiFormat"`
	CredentialState string `json:"credentialState"` // none | available | reference_unavailable
}

// Diagnostic is one allowlisted configuration finding. SubjectName is a
// length-bounded role/model/provider name; never a path or value.
type Diagnostic struct {
	Code        string `json:"code"`
	SubjectKind string `json:"subjectKind"` // "" | role | model | provider
	SubjectName string `json:"subjectName"`
	Blocking    bool   `json:"blocking"`
}

// emptyProjection returns a projection with empty (non-nil) collections so
// the boundary never serializes null where the contract says array.
func emptyProjection(state string, origin sourceOrigin) SettingsProjection {
	o := origin
	if o == "" {
		o = originNone
	}
	return SettingsProjection{
		State:        state,
		SourceOrigin: string(o),
		Routes:       []RouteProjection{},
		Models:       []ModelProjection{},
		Providers:    []ProviderProjection{},
		Diagnostics:  []Diagnostic{},
	}
}

// buildSettingsProjection maps one load outcome onto the safe projection.
// Pure: no I/O, no service state. loadErr non-nil means loaded.Config is nil.
func buildSettingsProjection(loaded loadedAgentConfig, loadErr error) SettingsProjection {
	if loadErr != nil {
		if errors.Is(loadErr, ErrAgentConfigMissing) {
			p := emptyProjection("missing", originNone)
			p.Diagnostics = append(p.Diagnostics, Diagnostic{Code: "config_missing", Blocking: true})
			return p
		}
		p := emptyProjection("invalid", loaded.Origin)
		code := "config_invalid"
		if errors.Is(loadErr, errConfigJSONSyntax) {
			code = "json_invalid"
		}
		p.Diagnostics = append(p.Diagnostics, Diagnostic{Code: code, Blocking: true})
		return p
	}

	cfg := loaded.Config
	if exceedsProjectionBounds(cfg) {
		p := emptyProjection("limited", loaded.Origin)
		// A limited projection must not conceal an unusable agent route: keep
		// at most one bounded blocking agent diagnostic (spec 3.2 amendment).
		if d, ok := selectedAgentBlockingDiagnostic(cfg); ok {
			p.Diagnostics = append(p.Diagnostics, d)
		}
		p.Diagnostics = append(p.Diagnostics, Diagnostic{Code: "projection_limited"})
		sortDiagnostics(p.Diagnostics)
		return p
	}

	p := emptyProjection("ready", loaded.Origin)

	for useCase, role := range cfg.Defaults {
		p.Routes = append(p.Routes, RouteProjection{UseCase: useCase, Role: role})
	}
	sort.Slice(p.Routes, func(i, j int) bool { return p.Routes[i].UseCase < p.Routes[j].UseCase })

	for role, m := range cfg.Models {
		p.Models = append(p.Models, ModelProjection{
			Role:                  role,
			ModelName:             m.Name,
			Provider:              m.Provider,
			Type:                  m.Type,
			EffectiveCapabilities: canonicalizeCapabilities(m.ResolvedCapabilities()),
			ThinkMode:             m.ThinkMode,
		})
	}
	sort.Slice(p.Models, func(i, j int) bool { return p.Models[i].Role < p.Models[j].Role })

	agentProvider := selectedAgentProvider(cfg)
	for name, pc := range cfg.Providers {
		row := ProviderProjection{Name: name, APIFormat: pc.APIFormat, CredentialState: "none"}
		if pc.APIKey != "" {
			// Post-Load the key is expanded, so presence implies the ${ENV}
			// reference (if any) resolved. reference_unavailable is Phase 2.
			row.CredentialState = "available"
		}
		endpoint, local, err := NormalizeEndpoint(pc.BaseURL)
		switch {
		case err != nil:
			row.Classification = "unknown"
			p.Diagnostics = append(p.Diagnostics, Diagnostic{
				Code:        "provider_endpoint_unsupported",
				SubjectKind: "provider",
				SubjectName: name,
				Blocking:    name == agentProvider,
			})
		case local:
			row.Endpoint, row.Classification = endpoint, "local"
		default:
			row.Endpoint, row.Classification = endpoint, "remote"
		}
		p.Providers = append(p.Providers, row)
	}
	sort.Slice(p.Providers, func(i, j int) bool { return p.Providers[i].Name < p.Providers[j].Name })

	p.Diagnostics = append(p.Diagnostics, agentRouteDiagnostics(cfg)...)
	sortDiagnostics(p.Diagnostics)
	return p
}

// exceedsProjectionBounds reports whether any collection, identifier, or
// derived endpoint is over the response bounds.
func exceedsProjectionBounds(cfg *config.Config) bool {
	if len(cfg.Defaults) > maxProjectionEntries ||
		len(cfg.Models) > maxProjectionEntries ||
		len(cfg.Providers) > maxProjectionEntries {
		return true
	}
	over := func(s string) bool { return len(s) > maxProjectionIdentifierLen }
	for useCase, role := range cfg.Defaults {
		if over(useCase) || over(role) {
			return true
		}
	}
	for role, m := range cfg.Models {
		if over(role) || over(m.Name) || over(m.Provider) || over(m.Type) || over(m.ThinkMode) {
			return true
		}
	}
	for name, pc := range cfg.Providers {
		if over(name) || over(pc.APIFormat) {
			return true
		}
		if endpoint, _, err := NormalizeEndpoint(pc.BaseURL); err == nil && len(endpoint) > maxProjectionEndpointLen {
			return true
		}
	}
	return false
}

// selectedAgentProvider names the provider on the agent route, "" when the
// route is incomplete.
func selectedAgentProvider(cfg *config.Config) string {
	role, ok := cfg.RoleForUseCase("agent")
	if !ok {
		return ""
	}
	m := cfg.RoleConfig(role)
	if m == nil {
		return ""
	}
	return m.Provider
}

// selectedAgentBlockingDiagnostic returns the single most relevant blocking
// diagnostic for the agent route, with its subject bounded (dropped when over
// the identifier limit). Used by the limited path only.
func selectedAgentBlockingDiagnostic(cfg *config.Config) (Diagnostic, bool) {
	if ds := agentRouteDiagnostics(cfg); len(ds) > 0 {
		return boundSubject(ds[0]), true
	}
	if name := selectedAgentProvider(cfg); name != "" {
		if pc := cfg.Provider(name); pc != nil {
			if _, _, err := NormalizeEndpoint(pc.BaseURL); err != nil {
				return boundSubject(Diagnostic{
					Code:        "provider_endpoint_unsupported",
					SubjectKind: "provider",
					SubjectName: name,
					Blocking:    true,
				}), true
			}
		}
	}
	return Diagnostic{}, false
}

func boundSubject(d Diagnostic) Diagnostic {
	if len(d.SubjectName) > maxProjectionIdentifierLen {
		d.SubjectKind = ""
		d.SubjectName = ""
	}
	return d
}

// agentRouteDiagnostics re-states ResolveAgentTarget's role/capability checks
// as diagnostics. Endpoint problems are reported per provider by the caller.
func agentRouteDiagnostics(cfg *config.Config) []Diagnostic {
	role, ok := cfg.RoleForUseCase("agent")
	if !ok {
		return []Diagnostic{{Code: "agent_role_missing", Blocking: true}}
	}
	m := cfg.RoleConfig(role)
	if m == nil || m.Provider == "" || cfg.Provider(m.Provider) == nil {
		return []Diagnostic{{Code: "agent_role_missing", SubjectKind: "role", SubjectName: role, Blocking: true}}
	}
	caps, err := provider.ParseCapsStrict(m.ResolvedCapabilities())
	if err != nil {
		// Unreachable post-Load (validate rejects unknown capabilities); the
		// coarse load-failure path owns that case. Guard anyway.
		return []Diagnostic{{Code: "agent_capabilities_insufficient", SubjectKind: "model", SubjectName: role, Blocking: true}}
	}
	if !caps.Has(requiredAgentCaps) {
		return []Diagnostic{{Code: "agent_capabilities_insufficient", SubjectKind: "model", SubjectName: role, Blocking: true}}
	}
	return nil
}

// canonicalizeCapabilities lowercases, deduplicates, and orders tokens by the
// canonical vocabulary; ResolvedCapabilities preserves user case/order/dups,
// which must not leak shape into the contract.
func canonicalizeCapabilities(tokens []string) []string {
	caps, err := provider.ParseCapsStrict(tokens)
	if err != nil {
		return []string{} // unreachable post-Load validation; render no chips
	}
	out := make([]string, 0, len(provider.CanonicalCapabilityNames))
	for _, name := range provider.CanonicalCapabilityNames {
		bit, err := provider.ParseCapsStrict([]string{name})
		if err != nil {
			continue
		}
		if caps.Has(bit) {
			out = append(out, name)
		}
	}
	return out
}

// sortDiagnostics: blocking first, then code, then subject name.
func sortDiagnostics(ds []Diagnostic) {
	sort.Slice(ds, func(i, j int) bool {
		if ds[i].Blocking != ds[j].Blocking {
			return ds[i].Blocking
		}
		if ds[i].Code != ds[j].Code {
			return ds[i].Code < ds[j].Code
		}
		return ds[i].SubjectName < ds[j].SubjectName
	})
}

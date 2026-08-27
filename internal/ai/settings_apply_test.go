package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Result-side oracles. Apply/cancel/profile results are PRODUCED by Go and
// consumed by the TypeScript validator, so the closed rules live here as a
// test twin of frontend/src/types/golemConfig.ts; the shared corpus
// (testdata/settings_apply_contract) keeps the two honest. Request validation
// is the opposite direction — it is production code in settings_apply.go,
// because the request is the trust boundary.
// ---------------------------------------------------------------------------

var applyConsentOutcomes = map[string]bool{"unchanged": true, "recorded": true, "uncertain": true}

var applyConflictKinds = map[string]bool{"target": true, "profile_source": true, "challenge": true}

// validChallengeToken mirrors the §5.6 rule: opaque, 1..256 UTF-8 bytes, and
// (like every other string that reaches the UI) free of control runes.
func validChallengeToken(token string) bool {
	return token != "" && len(token) <= maxChallengeTokenBytes &&
		sanitizeIdentifier(token) == token
}

// validChangeID checks the stable change identity carried by a drop set:
// "<namespace>:<identifier>" over the four §3.3 namespaces. A bare identifier,
// an unknown namespace, or a CHANGE KIND used as one ("provider-key-set:"
// rather than "provider-key:") is a contract break, not a bounded string.
func validChangeID(id string) bool {
	namespace, identity, ok := strings.Cut(id, ":")
	return ok && changeIdentityNamespaces[namespace] && validRequestIdentifier(identity)
}

func validateDropSets(drops []ChangeDropSet) error {
	if len(drops) == 0 || len(drops) > maxProjectionEntries {
		return fmt.Errorf("drops = %d entries", len(drops))
	}
	seen := map[string]bool{}
	for i, drop := range drops {
		if !validChangeID(drop.ChangeID) {
			return fmt.Errorf("drops[%d].changeId = %q", i, drop.ChangeID)
		}
		if seen[drop.ChangeID] {
			return fmt.Errorf("drops[%d] repeats change id %q", i, drop.ChangeID)
		}
		seen[drop.ChangeID] = true
		if !canonicalDropFields(drop.Fields) {
			return fmt.Errorf("drops[%d].fields = %v", i, drop.Fields)
		}
	}
	return nil
}

func validateApplyChallenge(c *ApplyChallenge) error {
	if c == nil {
		return fmt.Errorf("challenge missing")
	}
	if !validChallengeToken(c.Token) {
		return fmt.Errorf("challenge token")
	}
	// expiresAt is a Unix-millisecond instant: positive, and inside the range
	// JavaScript can represent exactly (the frontend reads it as a number).
	if c.ExpiresAt < 1 || c.ExpiresAt > 9007199254740991 {
		return fmt.Errorf("challenge expiresAt = %d", c.ExpiresAt)
	}
	d := c.Destination
	if !validRequestIdentifier(d.Provider) || !validRequestIdentifier(d.Model) ||
		!validRequestEndpoint(d.Endpoint) || d.Classification != "remote" {
		return fmt.Errorf("challenge destination = %+v", d)
	}
	return nil
}

// validateSettingsApplyResult enforces the §5.6 result union: the status
// decides exactly which optional members may be present, and every absent
// member must stay absent (a busy result carrying a projection is a contract
// break, not a harmless extra).
func validateSettingsApplyResult(r SettingsApplyResult) error {
	present := map[string]bool{
		"projection":     r.Projection != nil,
		"warning":        r.Warning != "",
		"challenge":      r.Challenge != nil,
		"drops":          r.Drops != nil,
		"conflict":       r.Conflict != "",
		"consentOutcome": r.ConsentOutcome != "",
		"diagnostics":    r.Diagnostics != nil,
	}
	allowed := map[string][]string{
		"applied":                    {"projection", "warning"},
		"consent_required":           {"challenge"},
		"drop_confirmation_required": {"drops"},
		"conflict":                   {"conflict", "projection", "consentOutcome"},
		"diagnostics":                {"diagnostics", "consentOutcome"},
		"busy":                       {},
		"limited":                    {"diagnostics"},
	}
	names, ok := allowed[r.Status]
	if !ok {
		return fmt.Errorf("status %q", r.Status)
	}
	for name, isPresent := range present {
		if isPresent && !contains(names, name) {
			return fmt.Errorf("status %q carries %q", r.Status, name)
		}
	}

	switch r.Status {
	case "applied":
		if r.Projection == nil {
			return fmt.Errorf("applied without a projection")
		}
		if r.Warning != "" && r.Warning != "durability_uncertain" {
			return fmt.Errorf("warning %q", r.Warning)
		}
		return validateSettingsProjection(*r.Projection)
	case "consent_required":
		return validateApplyChallenge(r.Challenge)
	case "drop_confirmation_required":
		return validateDropSets(r.Drops)
	case "conflict":
		if !applyConflictKinds[r.Conflict] || !applyConsentOutcomes[r.ConsentOutcome] {
			return fmt.Errorf("conflict %q/%q", r.Conflict, r.ConsentOutcome)
		}
		if r.Projection != nil {
			return validateSettingsProjection(*r.Projection)
		}
		return nil
	case "diagnostics":
		if !applyConsentOutcomes[r.ConsentOutcome] {
			return fmt.Errorf("consentOutcome %q", r.ConsentOutcome)
		}
		if len(r.Diagnostics) == 0 {
			return fmt.Errorf("diagnostics result carries none")
		}
		for i, d := range r.Diagnostics {
			if !d.Blocking {
				return fmt.Errorf("diagnostics[%d] is not blocking", i)
			}
		}
		return validateDiagnostics(r.Diagnostics)
	case "limited":
		if len(r.Diagnostics) == 0 {
			return fmt.Errorf("limited result carries no diagnostics")
		}
		return validateDiagnostics(r.Diagnostics)
	}
	return nil
}

func validateCancelSettingsApplyResult(r CancelSettingsApplyResult) error {
	if r.Status != "cancelled" {
		return fmt.Errorf("cancel status %q", r.Status)
	}
	return nil
}

// validateProfileDraftProjection reuses the full-projection oracle: a draft is
// exactly a projection minus sourceOrigin and revision, so the two omitted
// fields are supplied here and every remaining rule (entity order, capability
// facts, limited cause, ready writability) is checked once, in one place.
// The draft-only rules are the state subset and the credential-free promise.
func validateProfileDraftProjection(d ProfileDraftProjection) error {
	if d.State != "ready" && d.State != "limited" {
		return fmt.Errorf("draft state %q", d.State)
	}
	for i, p := range d.Providers {
		if p.CredentialState != "none" {
			return fmt.Errorf("draft provider[%d] carries credential state %q", i, p.CredentialState)
		}
	}
	return validateSettingsProjection(SettingsProjection{
		State: d.State, SourceOrigin: "none", Revision: testSettingsRevision,
		ReadOnly: d.ReadOnly, Editable: d.Editable, Routes: d.Routes,
		Models: d.Models, Providers: d.Providers, Diagnostics: d.Diagnostics,
	})
}

var profileDiagnosticCodes = map[string]bool{
	"invalid_id": true, "not_found": true, "curated_read_only": true,
	"store_unsafe": true, "io": true, "config_invalid": true,
	"active_config_invalid": true, "profile_limit": true,
}

func validateGolemProfileLoadResult(r GolemProfileLoadResult) error {
	switch r.Status {
	case "loaded":
		if r.Diagnostics != nil {
			return fmt.Errorf("loaded result carries diagnostics")
		}
		if !validProfileID(r.ProfileID) || !validRevision(r.SourceRevision) {
			return fmt.Errorf("profile %q/%q", r.ProfileID, r.SourceRevision)
		}
		if r.Projection == nil {
			return fmt.Errorf("loaded result carries no projection")
		}
		return validateProfileDraftProjection(*r.Projection)
	case "diagnostics":
		if r.ProfileID != "" || r.SourceRevision != "" || r.Projection != nil {
			return fmt.Errorf("diagnostics result carries loaded members")
		}
		if len(r.Diagnostics) == 0 || len(r.Diagnostics) > maxProjectionEntries {
			return fmt.Errorf("profile diagnostics = %d", len(r.Diagnostics))
		}
		for i, d := range r.Diagnostics {
			if !profileDiagnosticCodes[d.Code] {
				return fmt.Errorf("profile diagnostic[%d] code %q", i, d.Code)
			}
			if d.ProfileID != "" && !validProfileID(d.ProfileID) {
				return fmt.Errorf("profile diagnostic[%d] id %q", i, d.ProfileID)
			}
		}
		return nil
	}
	return fmt.Errorf("profile load status %q", r.Status)
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Raw-shape checks. Typed decoding erases the difference between an absent key
// and a typed zero value, so the fixtures that turn on presence (a required
// boolean, an optional string that must never be emitted empty) are checked
// against the raw JSON — the same split settings_test.go's structuralCheck
// already draws for the projection.
// ---------------------------------------------------------------------------

func nonEmptyOptionalString(object map[string]json.RawMessage, key, where string) error {
	if _, ok := object[key]; !ok {
		return nil
	}
	value, err := contractStringField(object, key, where)
	if err != nil {
		return err
	}
	if value == "" {
		return fmt.Errorf("%s.%s is present but empty", where, key)
	}
	return nil
}

func applyResultStructuralCheck(raw json.RawMessage) error {
	root, err := contractObject(raw, "result")
	if err != nil {
		return err
	}
	if _, err := contractStringField(root, "status", "result"); err != nil {
		return err
	}
	if err := nonEmptyOptionalString(root, "warning", "result"); err != nil {
		return err
	}
	if _, ok := root["diagnostics"]; ok {
		if err := diagnosticsStructuralCheck(root, "result"); err != nil {
			return err
		}
	}
	if _, ok := root["projection"]; ok {
		return structuralCheck(root["projection"])
	}
	return nil
}

func profileLoadStructuralCheck(raw json.RawMessage) error {
	root, err := contractObject(raw, "profileLoad")
	if err != nil {
		return err
	}
	if _, err := contractStringField(root, "status", "profileLoad"); err != nil {
		return err
	}
	for _, key := range []string{"profileId", "sourceRevision"} {
		if err := nonEmptyOptionalString(root, key, "profileLoad"); err != nil {
			return err
		}
	}
	if diagnostics, ok := root["diagnostics"]; ok {
		entries, err := contractArrayField(root, "diagnostics", "profileLoad")
		if err != nil {
			return err
		}
		_ = diagnostics
		for i, entry := range entries {
			where := fmt.Sprintf("profileLoad.diagnostics[%d]", i)
			fields, err := contractObject(entry, where)
			if err != nil {
				return err
			}
			if _, err := contractStringField(fields, "code", where); err != nil {
				return err
			}
			if err := nonEmptyOptionalString(fields, "profileId", where); err != nil {
				return err
			}
		}
	}
	if _, ok := root["projection"]; ok {
		return draftStructuralCheck(root["projection"])
	}
	return nil
}

// ---------------------------------------------------------------------------
// The shared corpus.
// ---------------------------------------------------------------------------

type applyFixture struct {
	Verdict  string          `json:"verdict"`
	Document string          `json:"document"`
	Mode     string          `json:"mode"`
	Value    json.RawMessage `json:"value"`
}

func fixtureApplyMode(f applyFixture) (applyMode, error) {
	switch f.Mode {
	case "apply":
		return applyModeExisting, nil
	case "create":
		return applyModeCreate, nil
	}
	return applyModeExisting, fmt.Errorf("mode %q", f.Mode)
}

// checkApplyFixture returns nil exactly when every layer accepts the fixture.
// Requests go through plain json.Unmarshal on purpose: that is what the Wails
// binding does, so this proves the strict decoding lives on the TYPES (their
// UnmarshalJSON) rather than in a decoder only the tests configure.
func checkApplyFixture(f applyFixture) error {
	switch f.Document {
	case "apply_request":
		mode, err := fixtureApplyMode(f)
		if err != nil {
			return err
		}
		var req SettingsApplyRequest
		if err := json.Unmarshal(f.Value, &req); err != nil {
			return err
		}
		return validateSettingsApplyRequest(req, mode)
	case "confirm_request":
		mode, err := fixtureApplyMode(f)
		if err != nil {
			return err
		}
		var req ConfirmSettingsApplyRequest
		if err := json.Unmarshal(f.Value, &req); err != nil {
			return err
		}
		return validateConfirmSettingsApplyRequest(req, mode)
	case "apply_result":
		if err := applyResultStructuralCheck(f.Value); err != nil {
			return err
		}
		var result SettingsApplyResult
		if err := strictDecodeFixture(f.Value, &result); err != nil {
			return err
		}
		return validateSettingsApplyResult(result)
	case "cancel_result":
		var result CancelSettingsApplyResult
		if err := strictDecodeFixture(f.Value, &result); err != nil {
			return err
		}
		return validateCancelSettingsApplyResult(result)
	case "profile_load_result":
		if err := profileLoadStructuralCheck(f.Value); err != nil {
			return err
		}
		var result GolemProfileLoadResult
		if err := strictDecodeFixture(f.Value, &result); err != nil {
			return err
		}
		return validateGolemProfileLoadResult(result)
	}
	return fmt.Errorf("document %q", f.Document)
}

func strictDecodeFixture(raw json.RawMessage, target any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	return dec.Decode(target)
}

func TestSettingsApplyContractCorpus(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("testdata", "settings_apply_contract", "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("apply corpus missing: %v (%d files)", err, len(files))
	}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var fixture applyFixture
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		checkErr := checkApplyFixture(fixture)
		switch fixture.Verdict {
		case "accept":
			if checkErr != nil {
				t.Fatalf("%s: accept fixture rejected: %v", file, checkErr)
			}
		case "reject":
			if checkErr == nil {
				t.Fatalf("%s: reject fixture passed every check", file)
			}
		default:
			t.Fatalf("%s: verdict %q", file, fixture.Verdict)
		}
	}
}

// TestApplyCorpusCoversEveryVariant fails when a union member loses its
// fixtures: the corpus is the contract, so a silently deleted variant must not
// pass as "all fixtures green".
func TestApplyCorpusCoversEveryVariant(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("testdata", "settings_apply_contract", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	documents := map[string]int{}
	kinds := map[string]int{}
	statuses := map[string]int{}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var fixture applyFixture
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		documents[fixture.Document]++
		if fixture.Verdict != "accept" {
			continue
		}
		var probe struct {
			Status  string `json:"status"`
			Changes []struct {
				Kind string `json:"kind"`
			} `json:"changes"`
		}
		if err := json.Unmarshal(fixture.Value, &probe); err == nil {
			if probe.Status != "" && fixture.Document == "apply_result" {
				statuses[probe.Status]++
			}
			for _, change := range probe.Changes {
				kinds[change.Kind]++
			}
		}
	}
	for _, document := range []string{
		"apply_request", "confirm_request", "apply_result", "cancel_result",
		"profile_load_result",
	} {
		if documents[document] == 0 {
			t.Fatalf("corpus has no %s fixture", document)
		}
	}
	for kind := range changeKinds {
		if kinds[kind] == 0 {
			t.Fatalf("corpus accepts no %q change", kind)
		}
	}
	for _, status := range []string{
		"applied", "consent_required", "drop_confirmation_required", "conflict",
		"diagnostics", "busy", "limited",
	} {
		if statuses[status] == 0 {
			t.Fatalf("corpus accepts no %q result", status)
		}
	}
}

// ---------------------------------------------------------------------------
// Focused request-validation tests: the boundary rules the corpus states as
// verdicts, restated as behavior with an explicit expectation.
// ---------------------------------------------------------------------------

func applyRequestJSON(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "settings_apply_contract", name))
	if err != nil {
		t.Fatal(err)
	}
	var fixture applyFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.Value
}

// TestApplyRequestRejectsUnknownFieldsThroughPlainUnmarshal proves the Wails
// decoding path (encoding/json with no test-only decoder options) rejects an
// unknown field. Without UnmarshalJSON on the request types, Wails would
// silently drop it.
func TestApplyRequestRejectsUnknownFieldsThroughPlainUnmarshal(t *testing.T) {
	cases := []string{
		"reject-apply-request-unknown-top-key.json",
		"reject-apply-request-unknown-change-key.json",
		"reject-apply-request-cross-variant-field.json",
		"reject-apply-request-source-unknown-key.json",
		"reject-apply-request-route-model-facts-unknown-key.json",
		"reject-apply-request-route-capability-facts-unknown-key.json",
	}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			var req SettingsApplyRequest
			if err := json.Unmarshal(applyRequestJSON(t, name), &req); err == nil {
				t.Fatal("plain json.Unmarshal accepted an unknown field")
			}
		})
	}
}

// TestApplyRequestKeysNeverEscape locks the trust boundary from the other
// side: a decoded request holds key VALUES, and nothing that leaves the
// backend may carry them. Results are marshaled here to prove the result union
// has no member that could hold one.
func TestApplyRequestKeysNeverEscapeInResults(t *testing.T) {
	var req SettingsApplyRequest
	if err := json.Unmarshal(applyRequestJSON(t, "accept-apply-request-every-change-kind.json"), &req); err != nil {
		t.Fatal(err)
	}
	if req.Keys["hosted"] == "" {
		t.Fatalf("fixture no longer carries a key value: %+v", req.Keys)
	}
	results := []SettingsApplyResult{
		{Status: "busy"},
		{Status: "applied", Projection: &SettingsProjection{
			State: "ready", SourceOrigin: "user_config", Revision: testSettingsRevision,
			Editable: true, Routes: []RouteProjection{}, Models: []ModelProjection{},
			Providers: []ProviderProjection{}, Diagnostics: []Diagnostic{},
		}},
		{Status: "consent_required", Challenge: &ApplyChallenge{
			Token: "opaque", ExpiresAt: 1, Destination: ApplyDestination{
				Provider: "hosted", Model: "wire-model",
				Endpoint: "https://api.example.com/v1", Classification: "remote",
			},
		}},
	}
	for i, result := range results {
		encoded, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(encoded), req.Keys["hosted"]) ||
			strings.Contains(string(encoded), "sk-") {
			t.Fatalf("result %d leaks key material: %s", i, encoded)
		}
	}
}

func TestApplyRequestModeRules(t *testing.T) {
	base := func() SettingsApplyRequest {
		var req SettingsApplyRequest
		if err := json.Unmarshal(applyRequestJSON(t, "accept-apply-request-minimal.json"), &req); err != nil {
			t.Fatal(err)
		}
		return req
	}
	t.Run("apply requires a target revision", func(t *testing.T) {
		req := base()
		req.TargetRevision = nil
		if err := validateSettingsApplyRequest(req, applyModeExisting); err == nil {
			t.Fatal("apply accepted a request without targetRevision")
		}
	})
	t.Run("create forbids a target revision", func(t *testing.T) {
		req := base()
		req.Source = ApplySource{Kind: "blank"}
		if err := validateSettingsApplyRequest(req, applyModeCreate); err == nil {
			t.Fatal("create accepted a targetRevision")
		}
	})
	t.Run("create forbids the applied source", func(t *testing.T) {
		req := base()
		req.TargetRevision = nil
		if err := validateSettingsApplyRequest(req, applyModeCreate); err == nil {
			t.Fatal("create accepted source:applied")
		}
	})
}

// TestApplyRequestIdentifierByteBoundary: the bound is UTF-8 BYTES, so a
// multi-byte rune must be counted as its encoded length on both sides of the
// boundary. 128 two-byte runes are exactly at the limit; one more byte is over.
func TestApplyRequestIdentifierByteBoundary(t *testing.T) {
	if !validRequestIdentifier(strings.Repeat("é", 128)) {
		t.Fatal("256-byte identifier rejected")
	}
	if validRequestIdentifier(strings.Repeat("é", 128) + "a") {
		t.Fatal("257-byte identifier accepted")
	}
	if validRequestIdentifier(strings.Repeat("é", 129)) {
		t.Fatal("258-byte identifier accepted")
	}
}

func TestApplyRequestKeyValueRules(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "literal", value: "sk-literal", want: true},
		{name: "at limit", value: strings.Repeat("k", 4096), want: true},
		{name: "empty", value: ""},
		{name: "over limit", value: strings.Repeat("k", 4097)},
		{name: "interpolated", value: "${OPENAI_API_KEY}"},
		{name: "embedded interpolation", value: "prefix-${X}"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validKeyValue(tc.value); got != tc.want {
				t.Fatalf("validKeyValue(%d bytes) = %v, want %v", len(tc.value), got, tc.want)
			}
		})
	}
}

package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"

	"github.com/kstruzzieri/go-llm/provider"
)

// The closed settings WRITE transport (spec §5.6). Requests are the trust
// boundary: everything below decodes strictly (unknown field, unknown union
// member, or explicit null is a rejection, never a silently dropped value) and
// validates against the same bounds the read-only projection uses. The shared
// corpus in testdata/settings_apply_contract keeps this and
// frontend/src/types/golemConfig.ts byte-identical.
//
// Key VALUES cross frontend -> backend inside SettingsApplyRequest.Keys and
// nowhere else. No result type below has a member that can carry one.

const (
	// maxApplyKeyValueBytes bounds an API key value (§5.6: 1..4096 UTF-8
	// bytes). Everything else reuses the projection bounds so one change can
	// never move a limit on only one side of the boundary.
	maxApplyKeyValueBytes = 4096
	// maxChallengeTokenBytes bounds the opaque consent-challenge token.
	maxChallengeTokenBytes = 256
	// maxModelFactNumber is the §5.6 numeric-fact ceiling (int32 max).
	maxModelFactNumber = 2147483647
)

// Change kinds. The set is closed: an unknown kind is a contract break.
const (
	changeKindRoute            = "route"
	changeKindRouteUnassign    = "route-unassign"
	changeKindProviderAdd      = "provider-add"
	changeKindProviderUpdate   = "provider-update"
	changeKindProviderRemove   = "provider-remove"
	changeKindProviderKeySet   = "provider-key-set"
	changeKindProviderKeyClear = "provider-key-clear"
	changeKindRoleRemove       = "role-remove"
)

var changeKinds = map[string]bool{
	changeKindRoute: true, changeKindRouteUnassign: true,
	changeKindProviderAdd: true, changeKindProviderUpdate: true,
	changeKindProviderRemove: true, changeKindProviderKeySet: true,
	changeKindProviderKeyClear: true, changeKindRoleRemove: true,
}

// Apply source kinds.
const (
	applySourceApplied = "applied"
	applySourceProfile = "profile"
	applySourceBlank   = "blank"
)

// Drop fields (§5.2b): the model-specific members a real retarget would lose.
const (
	dropFieldSlots     = "slots"
	dropFieldThinkTags = "think_tags"
)

var (
	revisionPattern  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	profileIDPattern = regexp.MustCompile(`^(curated|user)/[a-z0-9][a-z0-9-]{0,63}$`)

	modelFactTypes  = map[string]bool{"dense": true, "moe": true, "embedding": true}
	applyThinkModes = map[string]bool{
		"": true, "none": true, "always": true, "toggle": true, "auto": true,
	}
	applyAPIFormats = map[string]bool{"ollama": true, "openai-compat": true}
)

// Boundary errors are fixed strings. A request field can hold anything the
// frontend sent, so no error below interpolates one: these values reach the
// host log, and §5.4 keeps user content out of it.
var (
	errApplyUnknownKind       = errors.New("settings apply: unknown union member")
	errApplyMissingField      = errors.New("settings apply: required field missing")
	errApplyNullField         = errors.New("settings apply: null is not a value")
	errApplyInvalidField      = errors.New("settings apply: field is out of contract")
	errApplyRevision          = errors.New("settings apply: target revision does not match the call")
	errApplyBounds            = errors.New("settings apply: collection is out of bounds")
	errApplyDuplicateChange   = errors.New("settings apply: duplicate or contradictory change identity")
	errApplyKeyCorrespondence = errors.New("settings apply: keys do not correspond 1:1 with key-set changes")
	errApplyKeyValue          = errors.New("settings apply: key values must be non-empty literals")
)

// applyMode distinguishes the two entry points. Apply targets an existing
// document and REQUIRES a target revision; Create establishes a new one and
// forbids both the revision and the applied source.
type applyMode int

const (
	applyModeExisting applyMode = iota
	applyModeCreate
)

// ---------------------------------------------------------------------------
// Presence-preserving scalars. encoding/json cannot otherwise tell an absent
// optional from a typed zero, and the frontend validator can (Object.hasOwn) —
// so the two would disagree on `{"contextWindow": 0}`. An explicit null is a
// rejection, not an absence: the frontend omits what it did not touch.
// ---------------------------------------------------------------------------

type optionalString struct {
	Value string
	Set   bool
}

func (o *optionalString) UnmarshalJSON(data []byte) error {
	if isJSONNull(data) {
		return errApplyNullField
	}
	if err := json.Unmarshal(data, &o.Value); err != nil {
		return err
	}
	o.Set = true
	return nil
}

func (o optionalString) pointer() *string {
	if !o.Set {
		return nil
	}
	value := o.Value
	return &value
}

type optionalInt struct {
	Value int
	Set   bool
}

func (o *optionalInt) UnmarshalJSON(data []byte) error {
	if isJSONNull(data) {
		return errApplyNullField
	}
	if err := json.Unmarshal(data, &o.Value); err != nil {
		return err
	}
	o.Set = true
	return nil
}

func (o optionalInt) pointer() *int {
	if !o.Set {
		return nil
	}
	value := o.Value
	return &value
}

func isJSONNull(data []byte) bool {
	return string(bytes.TrimSpace(data)) == "null"
}

// strictUnmarshal is the one decode primitive: unknown fields are errors, and
// trailing content after the value is an error too.
func strictUnmarshal(data []byte, target any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return err
	}
	if dec.More() {
		return errApplyInvalidField
	}
	return nil
}

// ---------------------------------------------------------------------------
// Request transport
// ---------------------------------------------------------------------------

// SettingsApplyRequest is the complete staged write. TargetRevision is nil
// exactly when the caller omitted it (Create); Changes and Keys are non-null
// collections.
type SettingsApplyRequest struct {
	TargetRevision *string           `json:"targetRevision,omitempty"`
	Source         ApplySource       `json:"source"`
	Changes        []Change          `json:"changes"`
	Keys           map[string]string `json:"keys"`
}

func (r *SettingsApplyRequest) UnmarshalJSON(data []byte) error {
	var wire struct {
		TargetRevision optionalString    `json:"targetRevision"`
		Source         ApplySource       `json:"source"`
		Changes        []Change          `json:"changes"`
		Keys           map[string]string `json:"keys"`
	}
	if err := strictUnmarshal(data, &wire); err != nil {
		return err
	}
	*r = SettingsApplyRequest{
		TargetRevision: wire.TargetRevision.pointer(),
		Source:         wire.Source,
		Changes:        wire.Changes,
		Keys:           wire.Keys,
	}
	return nil
}

// ApplySource is the closed source union: the applied document, a stored
// profile at a known revision, or a blank bootstrap.
type ApplySource struct {
	Kind           string `json:"kind"`
	ProfileID      string `json:"profileId,omitempty"`
	SourceRevision string `json:"sourceRevision,omitempty"`
}

func (s *ApplySource) UnmarshalJSON(data []byte) error {
	var probe struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return err
	}
	switch probe.Kind {
	case applySourceApplied, applySourceBlank:
		var wire struct {
			Kind string `json:"kind"`
		}
		if err := strictUnmarshal(data, &wire); err != nil {
			return err
		}
		*s = ApplySource{Kind: wire.Kind}
	case applySourceProfile:
		var wire struct {
			Kind           string `json:"kind"`
			ProfileID      string `json:"profileId"`
			SourceRevision string `json:"sourceRevision"`
		}
		if err := strictUnmarshal(data, &wire); err != nil {
			return err
		}
		*s = ApplySource(wire)
	default:
		return errApplyUnknownKind
	}
	return nil
}

// ModelFacts is a route change's complete model description. The optional
// members are nil exactly when the caller omitted them; upstream reads a nil
// numeric fact as zero.
type ModelFacts struct {
	Provider      string  `json:"provider"`
	Model         string  `json:"model"`
	Type          string  `json:"type"`
	Parameters    *string `json:"parameters,omitempty"`
	ContextWindow *int    `json:"contextWindow,omitempty"`
	Dimensions    *int    `json:"dimensions,omitempty"`
}

func (f *ModelFacts) UnmarshalJSON(data []byte) error {
	var wire struct {
		Provider      string         `json:"provider"`
		Model         string         `json:"model"`
		Type          string         `json:"type"`
		Parameters    optionalString `json:"parameters"`
		ContextWindow optionalInt    `json:"contextWindow"`
		Dimensions    optionalInt    `json:"dimensions"`
	}
	if err := strictUnmarshal(data, &wire); err != nil {
		return err
	}
	*f = ModelFacts{
		Provider: wire.Provider, Model: wire.Model, Type: wire.Type,
		Parameters:    wire.Parameters.pointer(),
		ContextWindow: wire.ContextWindow.pointer(),
		Dimensions:    wire.Dimensions.pointer(),
	}
	return nil
}

// Change is one staged mutation. Only the members its Kind declares are ever
// populated: UnmarshalJSON decodes each variant through its own strict struct,
// so a member borrowed from another variant is an unknown field. Required
// members are enforced at decode time (that is the only place absence and a
// typed zero are still distinguishable); validateChange then enforces value
// rules. The backend never sends a Change to the frontend, so there is no
// matching MarshalJSON.
type Change struct {
	Kind                   string           `json:"kind"`
	UseCase                string           `json:"useCase,omitempty"`
	Role                   string           `json:"role,omitempty"`
	Name                   string           `json:"name,omitempty"`
	Endpoint               *string          `json:"endpoint,omitempty"`
	APIFormat              *string          `json:"apiFormat,omitempty"`
	ModelFacts             *ModelFacts      `json:"modelFacts,omitempty"`
	CapabilityFacts        *CapabilityFacts `json:"capabilityFacts,omitempty"`
	ExposedCaps            []string         `json:"exposedCaps,omitempty"`
	ThinkMode              string           `json:"thinkMode,omitempty"`
	ConfirmUnknown         bool             `json:"confirmUnknown,omitempty"`
	ConfirmUnknownUseCases []string         `json:"confirmUnknownUseCases,omitempty"`
	ConfirmDrops           []string         `json:"confirmDrops,omitempty"`
}

func (c *Change) UnmarshalJSON(data []byte) error {
	var probe struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return err
	}
	switch probe.Kind {
	case changeKindRoute:
		return c.unmarshalRoute(data)
	case changeKindRouteUnassign:
		var wire struct {
			Kind    string `json:"kind"`
			UseCase string `json:"useCase"`
		}
		if err := strictUnmarshal(data, &wire); err != nil {
			return err
		}
		*c = Change{Kind: wire.Kind, UseCase: wire.UseCase}
	case changeKindProviderAdd:
		var wire struct {
			Kind      string         `json:"kind"`
			Name      string         `json:"name"`
			Endpoint  optionalString `json:"endpoint"`
			APIFormat optionalString `json:"apiFormat"`
		}
		if err := strictUnmarshal(data, &wire); err != nil {
			return err
		}
		if !wire.Endpoint.Set {
			return errApplyMissingField
		}
		*c = Change{Kind: wire.Kind, Name: wire.Name,
			Endpoint: wire.Endpoint.pointer(), APIFormat: wire.APIFormat.pointer()}
	case changeKindProviderUpdate:
		var wire struct {
			Kind      string         `json:"kind"`
			Name      string         `json:"name"`
			Endpoint  optionalString `json:"endpoint"`
			APIFormat optionalString `json:"apiFormat"`
		}
		if err := strictUnmarshal(data, &wire); err != nil {
			return err
		}
		*c = Change{Kind: wire.Kind, Name: wire.Name,
			Endpoint: wire.Endpoint.pointer(), APIFormat: wire.APIFormat.pointer()}
	case changeKindProviderRemove, changeKindProviderKeySet, changeKindProviderKeyClear:
		var wire struct {
			Kind string `json:"kind"`
			Name string `json:"name"`
		}
		if err := strictUnmarshal(data, &wire); err != nil {
			return err
		}
		*c = Change{Kind: wire.Kind, Name: wire.Name}
	case changeKindRoleRemove:
		var wire struct {
			Kind string `json:"kind"`
			Role string `json:"role"`
		}
		if err := strictUnmarshal(data, &wire); err != nil {
			return err
		}
		*c = Change{Kind: wire.Kind, Role: wire.Role}
	default:
		return errApplyUnknownKind
	}
	return nil
}

func (c *Change) unmarshalRoute(data []byte) error {
	var wire struct {
		Kind                   string           `json:"kind"`
		UseCase                string           `json:"useCase"`
		ModelFacts             *ModelFacts      `json:"modelFacts"`
		CapabilityFacts        *CapabilityFacts `json:"capabilityFacts"`
		ExposedCaps            []string         `json:"exposedCaps"`
		ThinkMode              *string          `json:"thinkMode"`
		ConfirmUnknown         *bool            `json:"confirmUnknown"`
		ConfirmUnknownUseCases []string         `json:"confirmUnknownUseCases"`
		ConfirmDrops           []string         `json:"confirmDrops"`
	}
	if err := strictUnmarshal(data, &wire); err != nil {
		return err
	}
	// Every member above without a `?` in §5.6 is required. A nil here is
	// either an absent key or an explicit null; both are contract breaks.
	if wire.ModelFacts == nil || wire.CapabilityFacts == nil || wire.ExposedCaps == nil ||
		wire.ThinkMode == nil || wire.ConfirmUnknown == nil {
		return errApplyMissingField
	}
	*c = Change{
		Kind: wire.Kind, UseCase: wire.UseCase,
		ModelFacts: wire.ModelFacts, CapabilityFacts: wire.CapabilityFacts,
		ExposedCaps: wire.ExposedCaps, ThinkMode: *wire.ThinkMode,
		ConfirmUnknown:         *wire.ConfirmUnknown,
		ConfirmUnknownUseCases: wire.ConfirmUnknownUseCases,
		ConfirmDrops:           wire.ConfirmDrops,
	}
	return nil
}

// ConfirmSettingsApplyRequest is Call 2. Call 1 retained no request, so the
// frontend resends the whole thing alongside the opaque challenge token.
type ConfirmSettingsApplyRequest struct {
	ChallengeToken string               `json:"challengeToken"`
	Request        SettingsApplyRequest `json:"request"`
}

func (r *ConfirmSettingsApplyRequest) UnmarshalJSON(data []byte) error {
	var wire struct {
		ChallengeToken string               `json:"challengeToken"`
		Request        SettingsApplyRequest `json:"request"`
	}
	if err := strictUnmarshal(data, &wire); err != nil {
		return err
	}
	*r = ConfirmSettingsApplyRequest(wire)
	return nil
}

// ---------------------------------------------------------------------------
// Result transport. Produced by the backend, validated by
// frontend/src/types/golemConfig.ts; the status decides which members exist.
// ---------------------------------------------------------------------------

// SettingsApplyResult is the closed apply/create/confirm outcome.
type SettingsApplyResult struct {
	Status         string              `json:"status"`
	Projection     *SettingsProjection `json:"projection,omitempty"`
	Warning        string              `json:"warning,omitempty"`
	Challenge      *ApplyChallenge     `json:"challenge,omitempty"`
	Drops          []ChangeDropSet     `json:"drops,omitempty"`
	Conflict       string              `json:"conflict,omitempty"`
	ConsentOutcome string              `json:"consentOutcome,omitempty"`
	Diagnostics    []Diagnostic        `json:"diagnostics,omitempty"`
}

// ApplyChallenge is the consent handshake. The token is opaque and single-use;
// the record behind it holds no document, path, or key.
type ApplyChallenge struct {
	Token       string           `json:"token"`
	ExpiresAt   int64            `json:"expiresAt"`
	Destination ApplyDestination `json:"destination"`
}

// ApplyDestination is the bounded egress identity shown in the consent
// prompt — never an API key, never a path.
type ApplyDestination struct {
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	Endpoint       string `json:"endpoint"`
	Classification string `json:"classification"`
}

// ChangeDropSet names one staged change and the model-specific fields a real
// retarget would drop. ChangeID is the stable "<kind>:<identity>" form.
type ChangeDropSet struct {
	ChangeID string   `json:"changeId"`
	Fields   []string `json:"fields"`
}

// CancelSettingsApplyResult has exactly one success variant; cancel is
// idempotent, so an absent or expired token is already cancelled.
type CancelSettingsApplyResult struct {
	Status string `json:"status"`
}

// ProfileDraftProjection is a profile preview: the settings projection minus
// sourceOrigin and revision, always credential-free.
type ProfileDraftProjection struct {
	State       string               `json:"state"`
	ReadOnly    bool                 `json:"readOnly"`
	Editable    bool                 `json:"editable"`
	Routes      []RouteProjection    `json:"routes"`
	Models      []ModelProjection    `json:"models"`
	Providers   []ProviderProjection `json:"providers"`
	Diagnostics []Diagnostic         `json:"diagnostics"`
}

// ProfileDiagnostic is the closed profile-store finding. Paths never cross.
type ProfileDiagnostic struct {
	Code      string `json:"code"`
	ProfileID string `json:"profileId,omitempty"`
}

// GolemProfileLoadResult carries a draft preview plus the provenance the
// frontend needs to stage a profile-source Apply.
type GolemProfileLoadResult struct {
	Status         string                  `json:"status"`
	ProfileID      string                  `json:"profileId,omitempty"`
	SourceRevision string                  `json:"sourceRevision,omitempty"`
	Projection     *ProfileDraftProjection `json:"projection,omitempty"`
	Diagnostics    []ProfileDiagnostic     `json:"diagnostics,omitempty"`
}

// ---------------------------------------------------------------------------
// Shared predicates
// ---------------------------------------------------------------------------

// validRequestIdentifier is the §5.6 Identifier rule, measured the same way
// the projection measures it: non-empty, at most maxProjectionIdentifierLen
// UTF-8 BYTES, and free of Cc/Cf runes. sanitizeIdentifier is the single
// definition of that rune set, so an identifier survives it unchanged exactly
// when it is safe to emit.
func validRequestIdentifier(value string) bool {
	return value != "" && len(value) <= maxProjectionIdentifierLen &&
		sanitizeIdentifier(value) == value
}

// validRequestEndpoint bounds an authored endpoint. It stays ASCII for the
// same reason the projection's does: a non-ASCII host is a homoglyph risk and
// is never resolvable as authored (punycode is the supported form).
func validRequestEndpoint(value string) bool {
	if value == "" || len(value) > maxProjectionEndpointLen {
		return false
	}
	return !strings.ContainsFunc(value, func(r rune) bool {
		return r < 0x20 || r > 0x7E
	})
}

func validRevision(value string) bool { return revisionPattern.MatchString(value) }

func validProfileID(value string) bool { return profileIDPattern.MatchString(value) }

// validKeyValue: 1..4096 UTF-8 bytes and literal-only. A value containing
// "${" is refused backend-side even though go-llm would expand it — Firn
// stages literals, and an environment reference here would be a credential
// the user cannot see.
func validKeyValue(value string) bool {
	return value != "" && len(value) <= maxApplyKeyValueBytes && !strings.Contains(value, "${")
}

// canonicalCapabilityNames reports whether values are known capability names
// in canonical order with no duplicates. A nil or empty list is canonical;
// callers check presence separately.
func canonicalCapabilityNames(values []string) bool {
	previous := -1
	for _, value := range values {
		index := slices.Index(provider.CanonicalCapabilityNames, value)
		if index <= previous {
			return false
		}
		previous = index
	}
	return true
}

// capabilitySubset reports whether every entry of values appears in known
// (§5.6 `caps ⊆ knownCaps`).
func capabilitySubset(values, known []string) bool {
	for _, value := range values {
		if !slices.Contains(known, value) {
			return false
		}
	}
	return true
}

// canonicalDropFields: non-empty, unique, ascending, drawn from the closed
// drop vocabulary. Ascending byte order puts "slots" before "think_tags".
func canonicalDropFields(values []string) bool {
	if len(values) == 0 || len(values) > 2 {
		return false
	}
	for i, value := range values {
		if value != dropFieldSlots && value != dropFieldThinkTags {
			return false
		}
		if i > 0 && values[i-1] >= value {
			return false
		}
	}
	return true
}

// sortedUniqueIdentifiers: every entry is an Identifier, strictly ascending in
// UTF-8 byte order, and the list is within the collection bound.
func sortedUniqueIdentifiers(values []string) bool {
	if len(values) == 0 || len(values) > maxProjectionEntries {
		return false
	}
	for i, value := range values {
		if !validRequestIdentifier(value) {
			return false
		}
		if i > 0 && values[i-1] >= value {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

// validateSettingsApplyRequest enforces every §5.6 request rule that survives
// decoding: entry-point rules, bounds, value contracts, stable-identity
// uniqueness, and the exact key-set/keys bijection. Semantic feasibility
// (does the role exist, does the model meet the floor) belongs to the
// preparation pipeline, not here.
func validateSettingsApplyRequest(req SettingsApplyRequest, mode applyMode) error {
	if err := validateApplySource(req.Source, mode); err != nil {
		return err
	}
	switch mode {
	case applyModeExisting:
		if req.TargetRevision == nil || !validRevision(*req.TargetRevision) {
			return errApplyRevision
		}
	case applyModeCreate:
		if req.TargetRevision != nil {
			return errApplyRevision
		}
	}
	// A write with no change is not a write. Both collections are non-null.
	if len(req.Changes) == 0 || len(req.Changes) > maxProjectionEntries {
		return errApplyBounds
	}
	if req.Keys == nil || len(req.Keys) > maxProjectionEntries {
		return errApplyBounds
	}
	for name, value := range req.Keys {
		if !validRequestIdentifier(name) {
			return errApplyInvalidField
		}
		if !validKeyValue(value) {
			return errApplyKeyValue
		}
	}

	identities := map[string]bool{}
	keySets := map[string]bool{}
	removedProviders := map[string]bool{}
	keyedProviders := map[string]bool{}
	for _, change := range req.Changes {
		if err := validateChange(change); err != nil {
			return err
		}
		namespace, identity := changeIdentity(change)
		token := namespace + "\x00" + identity
		if identities[token] {
			return errApplyDuplicateChange
		}
		identities[token] = true
		switch change.Kind {
		case changeKindProviderRemove:
			removedProviders[change.Name] = true
		case changeKindProviderKeySet:
			keySets[change.Name] = true
			keyedProviders[change.Name] = true
		case changeKindProviderKeyClear:
			keyedProviders[change.Name] = true
		}
	}
	// Removing a provider and touching its key in the same Apply contradict:
	// the key operation would target an entity this same request deletes.
	for name := range removedProviders {
		if keyedProviders[name] {
			return errApplyDuplicateChange
		}
	}
	// Exact 1:1 correspondence: every provider-key-set carries exactly one
	// key value, and no other change (and no stray entry) may carry one.
	if len(keySets) != len(req.Keys) {
		return errApplyKeyCorrespondence
	}
	for name := range keySets {
		if _, ok := req.Keys[name]; !ok {
			return errApplyKeyCorrespondence
		}
	}
	return nil
}

func validateApplySource(source ApplySource, mode applyMode) error {
	switch source.Kind {
	case applySourceApplied:
		// Create establishes a document that does not exist yet, so there is
		// no applied source to copy from.
		if mode == applyModeCreate {
			return errApplyUnknownKind
		}
	case applySourceBlank:
	case applySourceProfile:
		if !validProfileID(source.ProfileID) || !validRevision(source.SourceRevision) {
			return errApplyInvalidField
		}
		return nil
	default:
		return errApplyUnknownKind
	}
	if source.ProfileID != "" || source.SourceRevision != "" {
		return errApplyInvalidField
	}
	return nil
}

// changeIdentity is the stable (namespace, identity) pair a change mutates.
// Provider definition changes and provider key changes are separate
// namespaces on purpose: adding a provider and setting its key in one Apply is
// the normal flow, while two definition changes for one provider are not.
func changeIdentity(change Change) (namespace, identity string) {
	switch change.Kind {
	case changeKindRoute, changeKindRouteUnassign:
		return "use_case", change.UseCase
	case changeKindProviderAdd, changeKindProviderUpdate, changeKindProviderRemove:
		return "provider", change.Name
	case changeKindProviderKeySet, changeKindProviderKeyClear:
		return "provider_key", change.Name
	case changeKindRoleRemove:
		return "role", change.Role
	}
	return "unknown", change.Kind
}

func validateChange(change Change) error {
	switch change.Kind {
	case changeKindRoute:
		return validateRouteChange(change)
	case changeKindRouteUnassign:
		if !validRequestIdentifier(change.UseCase) {
			return errApplyInvalidField
		}
	case changeKindProviderAdd:
		if !validRequestIdentifier(change.Name) ||
			change.Endpoint == nil || !validRequestEndpoint(*change.Endpoint) {
			return errApplyInvalidField
		}
		if change.APIFormat != nil && !applyAPIFormats[*change.APIFormat] {
			return errApplyInvalidField
		}
	case changeKindProviderUpdate:
		if !validRequestIdentifier(change.Name) {
			return errApplyInvalidField
		}
		// An update that touches nothing is not a change.
		if change.Endpoint == nil && change.APIFormat == nil {
			return errApplyMissingField
		}
		if change.Endpoint != nil && !validRequestEndpoint(*change.Endpoint) {
			return errApplyInvalidField
		}
		if change.APIFormat != nil && !applyAPIFormats[*change.APIFormat] {
			return errApplyInvalidField
		}
	case changeKindProviderRemove, changeKindProviderKeySet, changeKindProviderKeyClear:
		if !validRequestIdentifier(change.Name) {
			return errApplyInvalidField
		}
	case changeKindRoleRemove:
		if !validRequestIdentifier(change.Role) {
			return errApplyInvalidField
		}
	default:
		return errApplyUnknownKind
	}
	return nil
}

func validateRouteChange(change Change) error {
	if !validRequestIdentifier(change.UseCase) || !applyThinkModes[change.ThinkMode] {
		return errApplyInvalidField
	}
	if change.ModelFacts == nil || change.CapabilityFacts == nil || change.ExposedCaps == nil {
		return errApplyMissingField
	}
	facts := *change.ModelFacts
	if !validRequestIdentifier(facts.Provider) || !validRequestIdentifier(facts.Model) ||
		!modelFactTypes[facts.Type] {
		return errApplyInvalidField
	}
	if facts.Parameters != nil && !validRequestIdentifier(*facts.Parameters) {
		return errApplyInvalidField
	}
	for _, number := range []*int{facts.ContextWindow, facts.Dimensions} {
		if number != nil && (*number < 1 || *number > maxModelFactNumber) {
			return errApplyInvalidField
		}
	}
	caps := *change.CapabilityFacts
	if caps.Caps == nil || caps.KnownCaps == nil {
		return errApplyMissingField
	}
	if !canonicalCapabilityNames(caps.Caps) || !canonicalCapabilityNames(caps.KnownCaps) ||
		!canonicalCapabilityNames(change.ExposedCaps) {
		return errApplyInvalidField
	}
	if !capabilitySubset(caps.Caps, caps.KnownCaps) ||
		!capabilitySubset(change.ExposedCaps, caps.KnownCaps) {
		return errApplyInvalidField
	}
	// Confirmation arrays are omitted when empty and must otherwise be the
	// exact backend-derived set; shape is checked here, equality when the
	// preparation pipeline knows what it derived.
	if change.ConfirmUnknownUseCases != nil && !sortedUniqueIdentifiers(change.ConfirmUnknownUseCases) {
		return errApplyInvalidField
	}
	if change.ConfirmDrops != nil && !canonicalDropFields(change.ConfirmDrops) {
		return errApplyInvalidField
	}
	return nil
}

// validateConfirmSettingsApplyRequest validates Call 2: an opaque bounded
// token plus the complete original request, revalidated in the mode the
// challenge was issued for.
func validateConfirmSettingsApplyRequest(req ConfirmSettingsApplyRequest, mode applyMode) error {
	if req.ChallengeToken == "" || len(req.ChallengeToken) > maxChallengeTokenBytes ||
		sanitizeIdentifier(req.ChallengeToken) != req.ChallengeToken {
		return errApplyInvalidField
	}
	return validateSettingsApplyRequest(req.Request, mode)
}

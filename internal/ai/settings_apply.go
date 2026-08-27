package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"maps"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/kstruzzieri/go-llm/config"
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

// Stable change-identity namespaces (spec §3.3). There are exactly four, and
// they are NOT the change kinds: provider add/update/remove share one provider
// identity, and key set/clear share the independent key identity, so an add and
// a key operation on one provider can coexist.
const (
	identityRoute       = "route"
	identityProvider    = "provider"
	identityProviderKey = "provider-key"
	identityRole        = "role"
)

var changeIdentityNamespaces = map[string]bool{
	identityRoute: true, identityProvider: true,
	identityProviderKey: true, identityRole: true,
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

// optionalStringSlice is the same guarantee for an optional ARRAY member.
// Decoding null straight into a []string silently yields nil — indistinguishable
// from an absent key — so the confirmation arrays would accept null in Go while
// the frontend rejects it.
type optionalStringSlice struct {
	Values []string
	Set    bool
}

func (o *optionalStringSlice) UnmarshalJSON(data []byte) error {
	if isJSONNull(data) {
		return errApplyNullField
	}
	if err := json.Unmarshal(data, &o.Values); err != nil {
		return err
	}
	o.Set = true
	return nil
}

// slice returns nil when absent and the decoded (never nil) array when present,
// so an explicitly empty array stays distinguishable from an omitted one.
func (o optionalStringSlice) slice() []string {
	if !o.Set {
		return nil
	}
	if o.Values == nil {
		return []string{}
	}
	return o.Values
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
		Kind                   string              `json:"kind"`
		UseCase                string              `json:"useCase"`
		ModelFacts             *ModelFacts         `json:"modelFacts"`
		CapabilityFacts        *CapabilityFacts    `json:"capabilityFacts"`
		ExposedCaps            []string            `json:"exposedCaps"`
		ThinkMode              *string             `json:"thinkMode"`
		ConfirmUnknown         *bool               `json:"confirmUnknown"`
		ConfirmUnknownUseCases optionalStringSlice `json:"confirmUnknownUseCases"`
		ConfirmDrops           optionalStringSlice `json:"confirmDrops"`
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
		ConfirmUnknownUseCases: wire.ConfirmUnknownUseCases.slice(),
		ConfirmDrops:           wire.ConfirmDrops.slice(),
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
// retarget would drop. ChangeID is the §3.3 stable identity (changeStableID).
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
		id := changeStableID(change)
		if identities[id] {
			return errApplyDuplicateChange
		}
		identities[id] = true
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

// changeStableID is the §3.3 stable change identity — `<namespace>:<identity>`
// over exactly the four namespaces above. It is the one identity vocabulary:
// duplicate/contradiction detection keys on it, and the drop sets a preparation
// pipeline reports name changes with it (one id per semantic target, never one
// per change kind). Splitting on the FIRST ":" recovers the namespace exactly,
// because no namespace contains one.
func changeStableID(change Change) string {
	switch change.Kind {
	case changeKindRoute, changeKindRouteUnassign:
		return identityRoute + ":" + change.UseCase
	case changeKindProviderAdd, changeKindProviderUpdate, changeKindProviderRemove:
		return identityProvider + ":" + change.Name
	case changeKindProviderKeySet, changeKindProviderKeyClear:
		return identityProviderKey + ":" + change.Name
	case changeKindRoleRemove:
		return identityRole + ":" + change.Role
	}
	// Unreachable: validateChange rejects an unknown kind first.
	return ""
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

// ---------------------------------------------------------------------------
// Preparation pipeline (spec §5.2, Call 1).
//
// ONE function serves Apply and Confirm: fresh-load the active target, compare
// its independent CAS token, build the source document, run every staged
// mutation in the dependency-safe order, and check Firn's floors and
// projection bounds. It returns the prepared document plus non-secret
// metadata, or the exact result the caller returns verbatim.
//
// It NEVER writes bytes and NEVER retains prepared state: Call 2 re-runs the
// whole thing from fresh reads, which is the only reliable way to keep the two
// validation paths from drifting.
// ---------------------------------------------------------------------------

// consentUnchanged is the consent outcome before any grant is attempted;
// preparation never grants, so it is the only one this file can report.
const consentUnchanged = "unchanged"

// settingsWriteTarget is the authorized identity of the file a prepared write
// would replace: the canonical (symlink-free) path the document was actually
// read from, the discovery branch that selected it, and the revision that was
// compared. The path is backend-only and never crosses the Wails boundary
// (§5.4). Create leaves it empty — establishing a new destination belongs to
// the save step.
type settingsWriteTarget struct {
	path     string
	origin   sourceOrigin
	revision string
}

// preparedSettingsApply is one non-writing preparation outcome: the complete
// mutated document plus the metadata the save and consent steps need. prior is
// the freshly loaded active config as it was BEFORE the mutations (nil for
// Create), so the caller can resolve the pre- and post-apply destinations.
type preparedSettingsApply struct {
	doc    *config.Document
	target settingsWriteTarget
	prior  *config.Config
}

func prepareSettingsApply(req SettingsApplyRequest, mode applyMode) (*preparedSettingsApply, *SettingsApplyResult) {
	// The request is the trust boundary and Confirm resends it in full, so
	// both entry points revalidate here rather than trusting Call 1's verdict.
	if err := validateSettingsApplyRequest(req, mode); err != nil {
		return nil, blockingDiagnostics(Diagnostic{Code: codeInvalidArgument})
	}
	target, active, result := loadApplyTarget(mode, req.TargetRevision)
	if result != nil {
		return nil, result
	}
	var prior *config.Config
	if active != nil {
		prior = active.Config() // pre-mutation snapshot; Config returns a copy
	}
	doc, consumed, result := applySourceDocument(req, active)
	if result != nil {
		return nil, result
	}
	if result := applyStagedChanges(doc, req, consumed); result != nil {
		return nil, result
	}
	if result := checkPreparedDocument(doc, req); result != nil {
		return nil, result
	}
	return &preparedSettingsApply{doc: doc, target: target, prior: prior}, nil
}

// loadApplyTarget freshly loads the active target and compares the caller's
// independent CAS token — or, for Create, establishes that no target exists at
// all. Both write gates are recomputed here on the document as it is right
// now: go-llm's own ReadOnly and Firn's identity-safety editable, which is
// exactly what "state is not ready" means. A cached snapshot is never
// consulted, so a UI that was bypassed cannot smuggle a stale gate through.
// A target that moved out from under the draft splits three ways (§5.6): it is
// gone, or a Create found one where there was none -> conflict:'target'; it is
// newly unreadable -> config_invalid; it is newly read-only or carries an
// identifier Firn cannot write -> limited. Only the conflict raised on a target
// that DID reload safely may carry a projection.
func loadApplyTarget(mode applyMode, wantRevision *string) (settingsWriteTarget, *config.Document, *SettingsApplyResult) {
	doc, loaded, err := loadAgentConfigDocument()
	if mode == applyModeCreate {
		// Create is offered only for config_missing. A target that appeared —
		// readable or not — is the Create race, and an unreadable one was never
		// safely reloaded, so it carries no projection.
		if errors.Is(err, ErrAgentConfigMissing) {
			return settingsWriteTarget{origin: originNone}, nil, nil
		}
		if err != nil {
			return settingsWriteTarget{}, nil, conflictTarget(nil)
		}
		projection := buildSettingsProjection(loaded, nil)
		return settingsWriteTarget{}, nil, conflictTarget(&projection)
	}
	if err != nil {
		// Gone or moved. Existence is the honest test, not the sentinel: a set
		// $GO_LLM_CONFIG naming a deleted file fails discovery as "invalid",
		// because the override always decides the source.
		if errors.Is(err, ErrAgentConfigMissing) || !targetPathExists(loaded.LexicalPath) {
			return settingsWriteTarget{}, nil, conflictTarget(nil)
		}
		// Newly invalid: the draft was built on a document that no longer
		// parses or validates. Not a conflict — there is nothing to reconcile
		// against until the file is repaired externally.
		return settingsWriteTarget{}, nil, blockingDiagnostics(Diagnostic{Code: codeConfigInvalid})
	}
	projection := buildSettingsProjection(loaded, nil)
	if wantRevision == nil || *wantRevision != loaded.Revision {
		return settingsWriteTarget{}, nil, conflictTarget(&projection)
	}
	// Both write gates, recomputed on the document as it is right now: go-llm's
	// own ReadOnly and Firn's identity-safety editable, which together are what
	// "state is not ready" means. A cached snapshot is never consulted, so a UI
	// that was bypassed cannot smuggle a stale gate through.
	if projection.State != "ready" {
		return settingsWriteTarget{}, nil, limitedResult(projection.Diagnostics)
	}
	return settingsWriteTarget{
		path: loaded.SourcePath, origin: loaded.Origin, revision: loaded.Revision,
	}, doc, nil
}

// targetPathExists reports whether the discovered source is still there at all.
// The lexical path is classification-only — it is never written to.
func targetPathExists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Lstat(path)
	return err == nil
}

// applySourceDocument produces the document the staged changes run against and
// the stable ids of any change the source itself already consumed.
func applySourceDocument(req SettingsApplyRequest, active *config.Document) (*config.Document, map[string]bool, *SettingsApplyResult) {
	switch req.Source.Kind {
	case applySourceApplied:
		if active == nil {
			// Unreachable: Create forbids the applied source, and Apply either
			// loaded a document or already returned a result.
			return nil, nil, blockingDiagnostics(Diagnostic{Code: codeInvalidArgument})
		}
		return active, nil, nil
	case applySourceBlank:
		return blankSourceDocument(req)
	case applySourceProfile:
		// The profile branch (fresh Store.Load, revision check, credential
		// scrub) is not wired yet. Refuse loudly: falling through to the
		// applied document would silently write the wrong configuration.
		return nil, nil, blockingDiagnostics(Diagnostic{Code: codeProfileSourceUnavailable})
	}
	return nil, nil, blockingDiagnostics(Diagnostic{Code: codeInvalidArgument})
}

// blankSourceDocument extracts the two seed changes a blank draft needs — one
// provider add plus the agent route that references it — and consumes them
// into NewDocument. They are never replayed; every other change then runs once
// in the normal mutation order. The agent floor is NOT checked here: the
// finished document is what has to satisfy it, and checkPreparedDocument
// checks exactly that, once, for every routed floor use case.
func blankSourceDocument(req SettingsApplyRequest) (*config.Document, map[string]bool, *SettingsApplyResult) {
	var agentRoute, seedProvider *Change
	for i := range req.Changes {
		if req.Changes[i].Kind == changeKindRoute && req.Changes[i].UseCase == useCaseAgent {
			agentRoute = &req.Changes[i]
			break
		}
	}
	if agentRoute == nil {
		return nil, nil, blockingDiagnostics(Diagnostic{Code: codeAgentRoleMissing})
	}
	facts := *agentRoute.ModelFacts
	for i := range req.Changes {
		if req.Changes[i].Kind == changeKindProviderAdd && req.Changes[i].Name == facts.Provider {
			seedProvider = &req.Changes[i]
			break
		}
	}
	if seedProvider == nil {
		return nil, nil, blockingDiagnostics(Diagnostic{
			Code: codeProviderNotFound, SubjectKind: "provider", SubjectName: facts.Provider,
		})
	}
	role, ok := generateRoleName(useCaseAgent, nil)
	if !ok {
		return nil, nil, blockingDiagnostics(Diagnostic{Code: codeInvalidArgument})
	}
	doc, err := config.NewDocument(config.BootstrapSpec{
		ProviderName: seedProvider.Name,
		Provider: config.ProviderSpec{
			BaseURL: *seedProvider.Endpoint, APIFormat: derefString(seedProvider.APIFormat),
		},
		Role: role,
		Model: config.ModelSpec{
			Name: facts.Model, Type: facts.Type, Parameters: derefString(facts.Parameters),
			ContextWindow: derefInt(facts.ContextWindow), Dimensions: derefInt(facts.Dimensions),
			Capabilities: overrideCapabilities(agentRoute.ExposedCaps), ThinkMode: agentRoute.ThinkMode,
		},
	}, config.DocumentOptions{})
	if err != nil {
		return nil, nil, actionDiagnostics(err)
	}
	return doc, map[string]bool{
		changeStableID(*agentRoute):   true,
		changeStableID(*seedProvider): true,
	}, nil
}

// ---------------------------------------------------------------------------
// Route classification. A route change is use-case-keyed, but what it does to
// the document depends on what that use case resolves to today.
// ---------------------------------------------------------------------------

type routeAction int

const (
	// routeCreate: nothing is bound, so a new role is born and then bound.
	routeCreate routeAction = iota
	// routeFork: the current role also serves someone else, so the complete
	// authored role is forked and only this use case moves.
	routeFork
	// routeRetarget: the current role serves this use case alone.
	routeRetarget
	// routeOverride: same model — a selector-wide capability/think edit that
	// must NOT go through SetRoleModel (whose replace semantics would clear
	// the omitted ThinkTags and Slots).
	routeOverride
)

type routePlan struct {
	change   Change
	selector modelSelector
	action   routeAction
	role     string // the role the use case resolves to today ("" when unbound)
	newRole  string // the generated role for create/fork
	drops    []string
}

// planRouteChanges classifies every route change against the pre-mutation
// document, derives the generated role names, and runs the two non-writing
// handshakes — exact drop confirmation and exact unknown-use-case
// confirmation — before anything mutates.
func planRouteChanges(base *config.Config, changes []Change, consumed map[string]bool) ([]routePlan, *SettingsApplyResult) {
	routes := stagedChanges(changes, consumed, changeKindRoute)
	routed, _ := roleUsage(base)
	fallbacks := fallbackReferencedRoles(base)
	taken := make(map[string]bool, len(base.Models))
	for role := range base.Models {
		taken[role] = true
	}

	plans := make([]routePlan, 0, len(routes))
	var drops []ChangeDropSet
	for _, change := range routes {
		facts := *change.ModelFacts
		plan := routePlan{
			change:   change,
			selector: modelSelector{provider: facts.Provider, model: facts.Model},
		}
		role, bound := base.Defaults[change.UseCase]
		current, exists := base.Models[role]
		switch {
		case !bound || !exists:
			plan.action = routeCreate
		case sameModelFacts(current, facts):
			plan.action, plan.role = routeOverride, role
		case len(routed[role]) > 1 || fallbacks[role]:
			plan.action, plan.role = routeFork, role
		default:
			plan.action, plan.role = routeRetarget, role
		}
		if plan.action == routeFork || plan.action == routeRetarget {
			plan.drops = roleDropSet(current)
		}
		if plan.action == routeCreate || plan.action == routeFork {
			name, ok := generateRoleName(change.UseCase, taken)
			if !ok {
				return nil, blockingDiagnostics(Diagnostic{
					Code: codeInvalidArgument, SubjectKind: "use_case", SubjectName: change.UseCase,
				})
			}
			plan.newRole, taken[name] = name, true
		}
		if !slices.Equal(plan.drops, change.ConfirmDrops) {
			if len(plan.drops) == 0 {
				// Nothing is dropped, so the stale confirmation cannot even be
				// expressed as a drop set.
				return nil, blockingDiagnostics(Diagnostic{
					Code: codeInvalidArgument, SubjectKind: "use_case", SubjectName: change.UseCase,
				})
			}
			drops = append(drops, ChangeDropSet{
				ChangeID: changeStableID(change), Fields: plan.drops,
			})
		}
		plans = append(plans, plan)
	}
	if len(drops) > 0 {
		return nil, &SettingsApplyResult{Status: "drop_confirmation_required", Drops: drops}
	}
	if result := verifyRouteConfirmations(base, routed, plans); result != nil {
		return nil, result
	}
	if result := verifySelectorGroups(plans); result != nil {
		return nil, result
	}
	return plans, nil
}

// verifyRouteConfirmations checks the request's unknown-use-case
// acknowledgement against the set Firn derives itself: every default the
// mutation affects that has no Firn capability floor. The frontend cannot be
// trusted to compute it, and a mismatch means the user was shown a different
// set than the one about to change.
//
// The required set is derived PER SELECTOR, not per use case (§3.3: the field
// is selector-scoped and must be byte-identical across every staged route on
// one provider+model). Deriving it per use case would make a legitimate
// request unsatisfiable — two floorless use cases staged onto one model would
// each require their own value while the selector check requires one shared
// value.
func verifyRouteConfirmations(base *config.Config, routed map[string][]string, plans []routePlan) *SettingsApplyResult {
	affected := map[modelSelector]map[string]bool{}
	for _, plan := range plans {
		group, ok := affected[plan.selector]
		if !ok {
			group = map[string]bool{}
			affected[plan.selector] = group
		}
		group[plan.change.UseCase] = true
		for role := range gateRolesFor(base, plan) {
			for _, useCase := range routed[role] {
				group[useCase] = true
			}
		}
	}
	unknown := map[modelSelector][]string{}
	for selector, group := range affected {
		names := make([]string, 0, len(group))
		for useCase := range group {
			if _, ok := firnUseCaseFloors[useCase]; !ok {
				names = append(names, useCase)
			}
		}
		slices.Sort(names)
		unknown[selector] = names
	}
	for _, plan := range plans {
		required := unknown[plan.selector]
		if !slices.Equal(required, plan.change.ConfirmUnknownUseCases) ||
			(len(required) > 0 && !plan.change.ConfirmUnknown) {
			return blockingDiagnostics(Diagnostic{
				Code: codeEligibilityUnknown, SubjectKind: "use_case", SubjectName: plan.change.UseCase,
			})
		}
	}
	return nil
}

// gateRolesFor mirrors upstream's eligibility gate: the role being changed,
// plus — when the change asserts an explicit capability override, or is itself
// selector-wide — every role already sharing the target selector, because that
// override becomes their persisted truth too.
func gateRolesFor(base *config.Config, plan routePlan) map[string]bool {
	roles := map[string]bool{}
	if plan.role != "" {
		roles[plan.role] = true
	}
	if plan.action == routeOverride || len(plan.change.ExposedCaps) > 0 {
		for role, m := range base.Models {
			if (modelSelector{provider: m.Provider, model: m.Name}) == plan.selector {
				roles[role] = true
			}
		}
	}
	return roles
}

// verifySelectorGroups enforces §3.3 backend-side: every staged route pointing
// at one provider+model must carry byte-identical selector-scoped fields,
// because they compile into ONE selector-wide truth.
func verifySelectorGroups(plans []routePlan) *SettingsApplyResult {
	first := map[modelSelector]Change{}
	for _, plan := range plans {
		other, seen := first[plan.selector]
		if !seen {
			first[plan.selector] = plan.change
			continue
		}
		if !sameSelectorFields(other, plan.change) {
			return blockingDiagnostics(Diagnostic{
				Code: codeSelectorConflict, SubjectKind: "model", SubjectName: plan.selector.model,
			})
		}
	}
	return nil
}

func sameSelectorFields(a, b Change) bool {
	return slices.Equal(a.ExposedCaps, b.ExposedCaps) &&
		slices.Equal(a.CapabilityFacts.Caps, b.CapabilityFacts.Caps) &&
		slices.Equal(a.CapabilityFacts.KnownCaps, b.CapabilityFacts.KnownCaps) &&
		slices.Equal(a.ConfirmUnknownUseCases, b.ConfirmUnknownUseCases) &&
		a.ThinkMode == b.ThinkMode && a.ConfirmUnknown == b.ConfirmUnknown
}

// ---------------------------------------------------------------------------
// Mutation. Dependency-safe order, removals last: provider adds/updates ->
// key set/clear -> role create/fork/retarget/override and bind -> unbind and
// guarded role removal -> provider removal.
// ---------------------------------------------------------------------------

func applyStagedChanges(doc *config.Document, req SettingsApplyRequest, consumed map[string]bool) *SettingsApplyResult {
	base := doc.Config() // pre-mutation view: classification only
	plans, result := planRouteChanges(base, req.Changes, consumed)
	if result != nil {
		return result
	}

	for _, change := range stagedChanges(req.Changes, consumed, changeKindProviderAdd) {
		if err := doc.AddProvider(change.Name, config.ProviderSpec{
			BaseURL: *change.Endpoint, APIFormat: derefString(change.APIFormat),
		}); err != nil {
			return actionDiagnostics(err)
		}
	}
	for _, change := range stagedChanges(req.Changes, consumed, changeKindProviderUpdate) {
		// UpdateProvider replaces the complete authored value, so the edit has
		// to be overlaid onto AuthoredProvider — otherwise an endpoint change
		// would silently erase the format, the timeout, and the stored key.
		spec, err := doc.AuthoredProvider(change.Name)
		if err != nil {
			return actionDiagnostics(err)
		}
		if change.Endpoint != nil {
			spec.BaseURL = *change.Endpoint
		}
		if change.APIFormat != nil {
			spec.APIFormat = *change.APIFormat
		}
		if err := doc.UpdateProvider(change.Name, spec); err != nil {
			return actionDiagnostics(err)
		}
	}
	for _, change := range stagedChanges(req.Changes, consumed, changeKindProviderKeySet) {
		// The 1:1 keys bijection is a validated request invariant.
		if err := doc.SetProviderAPIKey(change.Name, req.Keys[change.Name]); err != nil {
			return actionDiagnostics(err)
		}
	}
	for _, change := range stagedChanges(req.Changes, consumed, changeKindProviderKeyClear) {
		if err := doc.ClearProviderAPIKey(change.Name); err != nil {
			return actionDiagnostics(err)
		}
	}
	if result := applyRoutePlans(doc, plans); result != nil {
		return result
	}
	for _, change := range stagedChanges(req.Changes, consumed, changeKindRouteUnassign) {
		// The agent route is Firn's own run path: §4.3 never offers Unassign
		// for it, and §5.2 makes the backend enforce that independently of the
		// reducer. go-llm deliberately leaves the floor host-side, so this is
		// the only gate between a bypassed UI and an unrunnable configuration.
		if change.UseCase == useCaseAgent {
			return blockingDiagnostics(Diagnostic{Code: codeAgentRoleMissing})
		}
		if err := doc.UnbindUseCase(change.UseCase); err != nil {
			return actionDiagnostics(err)
		}
	}
	// Only explicit removals run here. The spec also allows auto-removing a
	// role this same Apply generated and then orphaned, which no valid request
	// can produce: a route change and a route-unassign share one stable
	// identity, so a use case cannot be both rebound and unbound in one
	// request, and nothing else can orphan a role born in this batch.
	for _, change := range stagedChanges(req.Changes, consumed, changeKindRoleRemove) {
		if err := doc.RemoveRole(change.Role); err != nil {
			return actionDiagnostics(err)
		}
	}
	for _, change := range stagedChanges(req.Changes, consumed, changeKindProviderRemove) {
		if err := doc.RemoveProvider(change.Name); err != nil {
			return actionDiagnostics(err)
		}
	}
	return nil
}

// applyRoutePlans runs the role-level mutations, then exactly one override per
// selector, then the binds for the roles it created.
func applyRoutePlans(doc *config.Document, plans []routePlan) *SettingsApplyResult {
	binds := make([][2]string, 0, len(plans))
	overrides := make([]routePlan, 0, len(plans))
	overridden := map[modelSelector]bool{}
	for _, plan := range plans {
		facts := roleFacts(plan.change)
		opts, err := roleOptions(plan)
		if err != nil {
			// Unreachable: request validation already requires canonical
			// capability names from the closed vocabulary.
			return blockingDiagnostics(Diagnostic{Code: codeInvalidArgument})
		}
		switch plan.action {
		case routeCreate:
			if err := doc.AddRoleModel(plan.newRole, facts, opts); err != nil {
				return actionDiagnostics(err)
			}
			binds = append(binds, [2]string{plan.change.UseCase, plan.newRole})
		case routeFork:
			if err := doc.ForkRoleModel(plan.role, plan.newRole, facts, config.ForkRoleModelOpts{
				SetRoleModelOpts: opts, ConfirmDrops: plan.change.ConfirmDrops,
			}); err != nil {
				return forkRefusal(plan, err)
			}
			binds = append(binds, [2]string{plan.change.UseCase, plan.newRole})
		case routeRetarget:
			if _, err := doc.SetRoleModel(plan.role, facts, opts); err != nil {
				return actionDiagnostics(err)
			}
		case routeOverride:
			if !overridden[plan.selector] {
				overridden[plan.selector] = true
				overrides = append(overrides, plan)
			}
		}
	}
	for _, plan := range overrides {
		caps, known, err := changeCapabilities(plan.change)
		if err != nil {
			return blockingDiagnostics(Diagnostic{Code: codeInvalidArgument})
		}
		if err := doc.SetRoleOverrides(
			provider.ModelKey{Provider: plan.selector.provider, Model: plan.selector.model},
			config.RoleOverrides{
				Capabilities: overrideCapabilities(plan.change.ExposedCaps),
				ThinkMode:    plan.change.ThinkMode,
			},
			config.SetRoleOverridesOpts{
				Requirements: floorRequirements(), Caps: caps, KnownMask: known,
				ConfirmUnknown: plan.change.ConfirmUnknown,
			}); err != nil {
			return actionDiagnostics(err)
		}
	}
	for _, bind := range binds {
		if err := doc.BindUseCase(bind[0], bind[1]); err != nil {
			return actionDiagnostics(err)
		}
	}
	return nil
}

// checkPreparedDocument is the last non-writing gate. NewDocument and
// BindUseCase guarantee go-llm validity only, so every use case this request
// routed is re-checked against Firn's floor on the FINISHED document; and a
// result Firn could not project is a result Firn must not write blind.
func checkPreparedDocument(doc *config.Document, req SettingsApplyRequest) *SettingsApplyResult {
	cfg := doc.Config()
	for _, change := range req.Changes {
		if change.Kind != changeKindRoute {
			continue
		}
		floor, ok := firnUseCaseFloors[change.UseCase]
		if !ok {
			continue
		}
		if !routeMeetsFloor(cfg, change.UseCase, floor) {
			return blockingDiagnostics(Diagnostic{
				Code: codeEligibilityIneligible, SubjectKind: "use_case", SubjectName: change.UseCase,
			})
		}
	}
	// §5.6: the post-mutation document is projected here, and a result that
	// would exceed a projection bound returns `limited` before consent/save —
	// the same status the load-time bound check returns, for the same reason.
	if exceedsProjectionBounds(cfg) {
		return limitedResult([]Diagnostic{{Code: codeProjectionLimited}})
	}
	return nil
}

func routeMeetsFloor(cfg *config.Config, useCase string, floor provider.Capability) bool {
	role, ok := cfg.RoleForUseCase(useCase)
	if !ok {
		return false
	}
	m := cfg.RoleConfig(role)
	if m == nil {
		return false
	}
	caps, err := provider.ParseCapsStrict(m.ResolvedCapabilities())
	return err == nil && caps.Has(floor)
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

// stagedChanges returns every change of one kind that the source did not
// consume, ordered by stable identity so one request always mutates in one
// order regardless of how the frontend arranged the array.
func stagedChanges(changes []Change, consumed map[string]bool, kind string) []Change {
	out := make([]Change, 0, len(changes))
	for _, change := range changes {
		if change.Kind == kind && !consumed[changeStableID(change)] {
			out = append(out, change)
		}
	}
	slices.SortFunc(out, func(a, b Change) int {
		return strings.Compare(changeStableID(a), changeStableID(b))
	})
	return out
}

func roleFacts(change Change) config.ModelFacts {
	facts := *change.ModelFacts
	return config.ModelFacts{
		Key:           provider.ModelKey{Provider: facts.Provider, Model: facts.Model},
		Type:          facts.Type,
		Parameters:    derefString(facts.Parameters),
		ContextWindow: derefInt(facts.ContextWindow),
		Dimensions:    derefInt(facts.Dimensions),
	}
}

func roleOptions(plan routePlan) (config.SetRoleModelOpts, error) {
	caps, known, err := changeCapabilities(plan.change)
	if err != nil {
		return config.SetRoleModelOpts{}, err
	}
	return config.SetRoleModelOpts{
		Requirements: floorRequirements(),
		Caps:         caps,
		KnownMask:    known,
		// A role that does not exist yet is routed by nothing, so upstream's
		// gate can only ever return unknown/no_requirements for it. The
		// eligibility question for the route being created is answered instead
		// by the exact unknown-use-case confirmation above and by Firn's floor
		// check on the finished document; an INELIGIBLE verdict — an override
		// that would break a live sibling route — is still refused here.
		ConfirmUnknown: plan.change.ConfirmUnknown || plan.newRole != "",
		Capabilities:   overrideCapabilities(plan.change.ExposedCaps),
		ThinkMode:      plan.change.ThinkMode,
	}, nil
}

func changeCapabilities(change Change) (caps, known provider.Capability, err error) {
	if caps, err = provider.ParseCapsStrict(change.CapabilityFacts.Caps); err != nil {
		return 0, 0, err
	}
	known, err = provider.ParseCapsStrict(change.CapabilityFacts.KnownCaps)
	return caps, known, err
}

// floorRequirements is the per-call copy of the floor table handed to
// upstream's eligibility gate. The gate reads only the affected use cases, and
// a use case Firn has no floor for evaluates as unknown by design.
func floorRequirements() map[string]provider.Capability {
	return maps.Clone(firnUseCaseFloors)
}

// overrideCapabilities maps the exposed-capability contract onto upstream's
// override semantics: a non-empty list is the explicit selector-wide override,
// an empty one clears it so capabilities derive from the model type again.
func overrideCapabilities(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	return append([]string(nil), values...)
}

// sameModelFacts reports whether the change asks for the model the role
// already has. Only then is the edit selector-scoped, and only then may it use
// SetRoleOverrides, which preserves every omitted authored field.
func sameModelFacts(m config.ModelConfig, facts ModelFacts) bool {
	return m.Provider == facts.Provider && m.Name == facts.Model && m.Type == facts.Type &&
		m.Parameters == derefString(facts.Parameters) &&
		m.ContextWindow == derefInt(facts.ContextWindow) &&
		m.Dimensions == derefInt(facts.Dimensions)
}

// roleDropSet is the exact set of projection-hidden fields a real retarget
// drops, computed the way upstream computes it for a fork: Slots can never be
// re-asserted onto a different model, and Firn never re-asserts ThinkTags
// (their values never cross the boundary). Ascending order puts "slots" first.
func roleDropSet(m config.ModelConfig) []string {
	var out []string
	if m.Slots != 0 {
		out = append(out, dropFieldSlots)
	}
	if m.ThinkTags != nil {
		out = append(out, dropFieldThinkTags)
	}
	return out
}

func fallbackReferencedRoles(cfg *config.Config) map[string]bool {
	refs := map[string]bool{}
	for _, m := range cfg.Models {
		for _, fallback := range m.Fallbacks {
			refs[fallback] = true
		}
	}
	return refs
}

// generateRoleName derives a new role name backend-side: "<useCase>-m", then
// "-m-2", "-m-3", …. The use-case prefix is trimmed at a UTF-8 rune boundary
// so the whole identifier stays inside the 256-byte bound, and candidates
// dedupe against the authored roles UNION every name generated earlier in the
// same preparation batch — two use cases whose trimmed prefixes coincide must
// not resolve to one role. Sanitized display values are never an input.
func generateRoleName(useCase string, taken map[string]bool) (string, bool) {
	for attempt := 1; attempt <= maxProjectionEntries+1; attempt++ {
		suffix := "-m"
		if attempt > 1 {
			suffix += "-" + strconv.Itoa(attempt)
		}
		name := trimToBytes(useCase, maxProjectionIdentifierLen-len(suffix)) + suffix
		if !taken[name] {
			return name, true
		}
	}
	return "", false
}

// trimToBytes cuts s to at most limit bytes without splitting a rune.
func trimToBytes(s string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if len(s) <= limit {
		return s
	}
	for limit > 0 && !utf8.RuneStart(s[limit]) {
		limit--
	}
	return s[:limit]
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

// blockingDiagnostics builds the §5.6 diagnostics result: every subject is
// sanitized and bounded before it can reach the UI or the host log, and the
// array is canonically ordered and duplicate-free like the projection's.
func blockingDiagnostics(ds ...Diagnostic) *SettingsApplyResult {
	return &SettingsApplyResult{
		Status: "diagnostics", ConsentOutcome: consentUnchanged,
		Diagnostics: canonicalDiagnostics(ds, true),
	}
}

// limitedResult refuses a write because the target itself is not writable —
// go-llm read-only, a Firn-unwritable identifier, or a document Firn cannot
// project. The projection's own diagnostics say which.
func limitedResult(ds []Diagnostic) *SettingsApplyResult {
	out := canonicalDiagnostics(ds, false)
	if len(out) == 0 {
		out = canonicalDiagnostics([]Diagnostic{{Code: codeProjectionLimited}}, false)
	}
	return &SettingsApplyResult{Status: "limited", Diagnostics: out}
}

// conflictTarget reports that the active target moved: it is gone, it appeared
// where Create expected nothing, or its revision is not the one the draft was
// built on. A projection rides along ONLY when the target was safely reloaded
// (§5.6), so the UI can recover without a second call; otherwise it is nil.
func conflictTarget(projection *SettingsProjection) *SettingsApplyResult {
	return &SettingsApplyResult{
		Status: "conflict", Conflict: "target", Projection: projection,
		ConsentOutcome: consentUnchanged,
	}
}

// forkRefusal turns an upstream fork refusal into the right result: a drop
// refusal is the non-writing drop_confirmation_required handshake (upstream is
// the authority on the exact set), anything else is a typed diagnostic.
func forkRefusal(plan routePlan, err error) *SettingsApplyResult {
	if fields, ok := config.DropSetOf(err); ok && canonicalDropFields(fields) {
		return &SettingsApplyResult{Status: "drop_confirmation_required",
			Drops: []ChangeDropSet{{ChangeID: changeStableID(plan.change), Fields: fields}}}
	}
	return actionDiagnostics(err)
}

// actionDiagnostics maps an upstream MUTATION failure onto the closed Firn
// vocabulary. Spec §5.1 defers the nine action-only codes to "Phase 3 action
// responses" — this is that mapping, and it is deliberately NOT
// mapConfigDiagnostic, which fails those codes closed because they cannot
// arise from a load. The three codes the pinned upstream added after §5.6
// froze the Firn vocabulary (role_exists, role_in_use, use_case_not_found) map
// onto the closest existing meaning rather than inventing copy the total
// message map does not have.
func actionDiagnostics(err error) *SettingsApplyResult {
	d, ok := config.DiagnosticOf(err)
	if !ok {
		return blockingDiagnostics(Diagnostic{Code: codeConfigInvalid})
	}
	mapped := Diagnostic{SubjectKind: actionSubjectKind(d.SubjectKind), SubjectName: d.Subject}
	if mapped.SubjectKind == "" {
		mapped.SubjectName = ""
	}
	switch d.Code {
	case config.CodeInvalidArgument, config.CodeRoleExists, config.CodeRoleInUse:
		mapped.Code = codeInvalidArgument
	case config.CodeRoleNotFound, config.CodeUseCaseNotFound:
		mapped.Code = codeRoleNotFound
	case config.CodeProviderExists:
		mapped.Code = codeProviderExists
	case config.CodeProviderInUse:
		mapped.Code = codeProviderInUse
	case config.CodeEligibilityIneligible:
		mapped.Code = codeEligibilityIneligible
	case config.CodeEligibilityUnknown:
		mapped.Code = codeEligibilityUnknown
	default:
		// Everything else keeps the single load-time mapping table.
		return blockingDiagnostics(mapConfigDiagnostic(d))
	}
	return blockingDiagnostics(mapped)
}

func actionSubjectKind(kind config.SubjectKind) string {
	switch kind {
	case config.SubjectProvider:
		return "provider"
	case config.SubjectRole:
		return "role"
	case config.SubjectUseCase:
		return "use_case"
	case config.SubjectNone:
	}
	return ""
}

func canonicalDiagnostics(ds []Diagnostic, blocking bool) []Diagnostic {
	out := make([]Diagnostic, 0, len(ds))
	for _, d := range ds {
		d.SubjectName = sanitizeIdentifier(d.SubjectName)
		d = boundSubject(d)
		if blocking {
			d.Blocking = true
		}
		out = append(out, d)
	}
	sortDiagnostics(out)
	return slices.Compact(out)
}

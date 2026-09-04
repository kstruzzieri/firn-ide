package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/kstruzzieri/go-llm/config"
)

// Defense in depth for the raw Golem read path. Since the frontend adapter
// routes the object-returning Golem calls through the runtime's raw Call.ByID
// (frontend/src/wails/bindings.ts), the wire-contract validators see exactly
// what Go marshals -- nothing defaults a missing key and nothing rewrites a
// null collection to []. Two producer-side properties therefore have to hold,
// and both are asserted here rather than repaired on the frontend:
//
//   - every required key is always emitted (an `omitempty` that crept onto a
//     required field drops its key at the zero value), and
//   - every required collection marshals as [], never null.

// ---------------------------------------------------------------------------
// Required keys
// ---------------------------------------------------------------------------

// contractResultTarget returns a fresh decode target for one result document
// of the shared apply corpus, or nil for the request documents (those are
// inputs; the frontend never parses one as a call result).
func contractResultTarget(document string) any {
	switch document {
	case "apply_result":
		return &SettingsApplyResult{}
	case "cancel_result":
		return &CancelSettingsApplyResult{}
	case "profile_load_result":
		return &GolemProfileLoadResult{}
	default:
		return nil
	}
}

// jsonKeys reports every object key present in v, addressed by path.
func jsonKeys(v any, where string, out map[string]bool) {
	switch typed := v.(type) {
	case map[string]any:
		for key, child := range typed {
			out[where+"."+key] = true
			jsonKeys(child, where+"."+key, out)
		}
	case []any:
		for i, child := range typed {
			jsonKeys(child, fmt.Sprintf("%s[%d]", where, i), out)
		}
	}
}

func decodedKeys(t *testing.T, raw []byte, where string) map[string]bool {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("%s: %v", where, err)
	}
	keys := map[string]bool{}
	jsonKeys(v, "", keys)
	return keys
}

// checkKeyParity decodes raw into target, marshals it back, and reports every
// key the round trip lost or invented. A key lost here is a key the frontend
// validator would reject as missing, because it now sees the raw payload.
func checkKeyParity(t *testing.T, raw []byte, target any, where string) {
	t.Helper()
	if err := json.Unmarshal(raw, target); err != nil {
		t.Fatalf("%s: decode: %v", where, err)
	}
	round, err := json.Marshal(target)
	if err != nil {
		t.Fatalf("%s: marshal: %v", where, err)
	}
	want := decodedKeys(t, raw, where)
	got := decodedKeys(t, round, where)
	var lost, added []string
	for key := range want {
		if !got[key] {
			lost = append(lost, key)
		}
	}
	for key := range got {
		if !want[key] {
			added = append(added, key)
		}
	}
	sort.Strings(lost)
	sort.Strings(added)
	if len(lost) > 0 {
		t.Errorf("%s: round trip dropped %v (a required field grew an omitempty tag)", where, lost)
	}
	if len(added) > 0 {
		t.Errorf("%s: round trip invented %v", where, added)
	}
}

// TestContractResultsKeepEveryWireKey replays every accept fixture of the two
// shared corpora through its Go result type: what comes back out must carry
// the same keys, at every level, that the fixture carried in. The required set
// is the fixtures' own, so nothing here is a hand-maintained list.
func TestContractResultsKeepEveryWireKey(t *testing.T) {
	projections, err := filepath.Glob(filepath.Join("testdata", "settings_contract", "accept-*.json"))
	if err != nil || len(projections) == 0 {
		t.Fatalf("projection corpus missing: %v (%d files)", err, len(projections))
	}
	for _, file := range projections {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var entry struct {
			Projection json.RawMessage `json:"projection"`
		}
		if err := json.Unmarshal(raw, &entry); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		checkKeyParity(t, entry.Projection, &SettingsProjection{}, file)
	}

	results, err := filepath.Glob(filepath.Join("testdata", "settings_apply_contract", "accept-*.json"))
	if err != nil || len(results) == 0 {
		t.Fatalf("apply corpus missing: %v (%d files)", err, len(results))
	}
	covered := 0
	for _, file := range results {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var fixture applyFixture
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		target := contractResultTarget(fixture.Document)
		if target == nil {
			continue
		}
		covered++
		checkKeyParity(t, fixture.Value, target, file)
	}
	if covered == 0 {
		t.Fatal("apply corpus carries no result fixtures")
	}
}

// ---------------------------------------------------------------------------
// Required collections
// ---------------------------------------------------------------------------

// requiredNilSlices walks v and returns the path of every slice field whose
// json tag has no omitempty -- a required array by contract -- that is nil, and
// would therefore marshal as null.
func requiredNilSlices(v reflect.Value, where string, out *[]string) {
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface:
		if !v.IsNil() {
			requiredNilSlices(v.Elem(), where, out)
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			field := v.Type().Field(i)
			if !field.IsExported() {
				continue
			}
			tag := strings.Split(field.Tag.Get("json"), ",")
			name := tag[0]
			if name == "-" {
				continue
			}
			if name == "" {
				name = field.Name
			}
			optional := false
			for _, opt := range tag[1:] {
				if opt == "omitempty" {
					optional = true
				}
			}
			child := v.Field(i)
			path := where + "." + name
			if child.Kind() == reflect.Slice && !optional && child.IsNil() {
				*out = append(*out, path)
			}
			requiredNilSlices(child, path, out)
		}
	case reflect.Slice:
		for i := 0; i < v.Len(); i++ {
			requiredNilSlices(v.Index(i), fmt.Sprintf("%s[%d]", where, i), out)
		}
	}
}

func assertNoRequiredNilSlices(t *testing.T, where string, value any) {
	t.Helper()
	var nils []string
	requiredNilSlices(reflect.ValueOf(value), where, &nils)
	if len(nils) > 0 {
		sort.Strings(nils)
		t.Errorf("%s: nil required collections %v marshal as null, but the contract says array", where, nils)
	}
}

// TestContractResultCollectionsNeverMarshalNull exercises the real producers --
// not hand-built literals -- and asserts none of them hands the Wails layer a
// nil required collection. TurnAdmission and its members declare no required
// collection at all, so the walk has nothing to check there; if one is ever
// added, TestContractResultsKeepEveryWireKey and this test both start caring
// about how it is initialized.
func TestContractResultCollectionsNeverMarshalNull(t *testing.T) {
	// The pure projection builder, on the branches that carry no entities.
	assertNoRequiredNilSlices(t, "missing",
		buildSettingsProjection(loadedAgentConfig{Origin: originUserConfig}, ErrAgentConfigMissing))
	assertNoRequiredNilSlices(t, "invalid",
		buildSettingsProjection(loadedAgentConfig{Origin: originUserConfig}, ErrAgentConfigInvalid))
	// A syntactically fine document with no providers, models or defaults: the
	// ready branch with every collection legitimately empty.
	empty := buildSettingsProjection(projectionLoaded(&config.Config{}), nil)
	assertNoRequiredNilSlices(t, "ready-empty", empty)
	assertNoRequiredNilSlices(t, "ready-empty-clone", empty.clone())
	// A populated document, so the per-model capability slices are walked too.
	populated := buildSettingsProjection(projectionLoaded(projectionConfig()), nil)
	assertNoRequiredNilSlices(t, "ready", populated)
	assertNoRequiredNilSlices(t, "ready-clone", populated.clone())

	// The service-level producers behind GetGolemSettings, ReloadGolemSettings,
	// GetGolemStatus and CancelGolemSettingsApply. ProfileDraftProjection is
	// not built here: LoadGolemProfile copies its collections straight off a
	// SettingsProjection, which the cases above already cover.
	h := newServiceHarness(t, "http://127.0.0.1:1")
	settings, err := h.svc.Settings()
	if err != nil {
		t.Fatalf("Settings: %v", err)
	}
	assertNoRequiredNilSlices(t, "Service.Settings", settings)

	reloaded, err := h.svc.ReloadSettings()
	if err != nil {
		t.Fatalf("ReloadSettings: %v", err)
	}
	assertNoRequiredNilSlices(t, "Service.ReloadSettings", reloaded)

	status, err := h.svc.Status(StatusRequest{})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	assertNoRequiredNilSlices(t, "Service.Status", status)

	assertNoRequiredNilSlices(t, "Service.CancelSettingsApply", h.svc.CancelSettingsApply("no-such-token"))
}

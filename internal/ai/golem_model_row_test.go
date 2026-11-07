package ai

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// #490's contract fixtures. The Golem model row and its picker are frontend
// surfaces, so the backend's part of the contract is two files the frontend
// tests read: the projection Firn emits for the design's hybrid-cc profile,
// and the document the existing planner writes for the one change the picker
// stages there. Set FIRN_UPDATE_GOLDEN=1 to rewrite the projection after an
// intended change; the written document is compared, never rewritten.

// golemModelRowDir is absolute: the apply harness changes directory.
var golemModelRowDir = func() string {
	dir, err := filepath.Abs(filepath.Join("testdata", "golem_model_row"))
	if err != nil {
		panic(err)
	}
	return dir
}()

func readGolemModelRowFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(golemModelRowDir, name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return raw
}

// indentJSON re-encodes raw with sorted keys and two-space indent, so two
// documents compare by value and a golden file diffs line by line.
func indentJSON(t *testing.T, raw []byte) []byte {
	t.Helper()
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("decode: %v\n%s", err, raw)
	}
	out, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	return append(out, '\n')
}

func TestGolemModelRowHybridCCProjection(t *testing.T) {
	h := newApplyHarness(t, string(readGolemModelRowFixture(t, "hybrid-cc.models.json")))
	result, err := h.svc.ReloadSettings()
	if err != nil {
		t.Fatalf("ReloadSettings: %v", err)
	}
	if result.Busy || result.Projection.State != "ready" {
		t.Fatalf("reload = busy %v, state %q; want a Ready projection", result.Busy, result.Projection.State)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := indentJSON(t, raw)
	golden := filepath.Join(golemModelRowDir, "hybrid-cc.reload.json")
	if os.Getenv("FIRN_UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(golden, got, 0o644); err != nil {
			t.Fatalf("write golden: %v", err)
		}
	}
	if want := readGolemModelRowFixture(t, "hybrid-cc.reload.json"); !bytes.Equal(got, want) {
		t.Errorf("hybrid-cc projection drifted from %s; rerun with FIRN_UPDATE_GOLDEN=1 if intended:\n%s", golden, got)
	}
}

// The picker's Use model sends the request the frontend test pins in
// hybrid-cc.use-glm.request.json — the same request the agent route editor and
// the page's Apply send for that pick. Through the existing planner and
// revision check it writes exactly hybrid-cc.use-glm.written.json.
func TestGolemModelRowUseModelWritesTheRouteEditorDocument(t *testing.T) {
	h := newApplyHarness(t, string(readGolemModelRowFixture(t, "hybrid-cc.models.json")))
	var pinned struct {
		Changes []Change `json:"changes"`
	}
	if err := json.Unmarshal(readGolemModelRowFixture(t, "hybrid-cc.use-glm.request.json"), &pinned); err != nil {
		t.Fatalf("request fixture: %v", err)
	}
	if len(pinned.Changes) != 1 || pinned.Changes[0].UseCase != "agent" {
		t.Fatalf("request fixture carries %+v; want the picker's one agent route change", pinned.Changes)
	}
	// commandcode is already reachable through agent's fallbacks, so the
	// reachable destination set does not grow and no challenge is issued.
	res, err := h.svc.ApplySettings(h.request(t, pinned.Changes...))
	if err != nil {
		t.Fatalf("ApplySettings: %v", err)
	}
	if res.Status != "applied" {
		t.Fatalf("ApplySettings status = %q (%+v), want applied", res.Status, res)
	}
	got := indentJSON(t, h.targetBytes(t))
	want := indentJSON(t, readGolemModelRowFixture(t, "hybrid-cc.use-glm.written.json"))
	if !bytes.Equal(got, want) {
		t.Errorf("written document differs from hybrid-cc.use-glm.written.json:\n%s", got)
	}
}

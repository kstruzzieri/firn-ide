package ai

import (
	"encoding/json"
	"testing"
)

// sizedSelectorJSON holds one model with a declared context window on a
// selector a route can join: analysis runs sized-model with 32768 tokens.
const sizedSelectorJSON = `{
  "providers": {"ollama": {"base_url": "http://localhost:11434"}},
  "models": {
    "agent-m": {"name": "agent-model", "provider": "ollama", "type": "dense",
      "capabilities": ["chat", "stream", "tool_call"]},
    "sized-m": {"name": "sized-model", "provider": "ollama", "type": "dense",
      "context_window": 32768}
  },
  "defaults": {"agent": "agent-m", "analysis": "sized-m"}
}`

// TestApplySettingsDeclaredContextWindow pins the backend half of #506's
// Declare form field: the window a route change declares is the
// context_window written for the route's role, a blank field writes none, and
// go-llm refuses a declared name that joins a selector with a different
// nonzero window (config.selectorPairConflict). The form pre-checks that
// conflict; this is the refusal it keeps the user from reaching.
func TestApplySettingsDeclaredContextWindow(t *testing.T) {
	window := func(n int) *int { return &n }
	for _, tc := range []struct {
		name       string
		model      string
		window     *int
		wantStatus string
		// wantWindow is the written role's raw context_window; "" when absent.
		wantWindow string
	}{
		{"a declared window is written", "fresh-model", window(65536), "applied", "65536"},
		{"a blank field writes no context_window", "fresh-model", nil, "applied", ""},
		{"a blank field joins a sized selector without its window", "sized-model", nil, "applied", ""},
		{"the selector's own window joins it", "sized-model", window(32768), "applied", "32768"},
		{"a different window on the selector is refused", "sized-model", window(65536), "diagnostics", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newApplyHarness(t, sizedSelectorJSON)
			before := h.targetBytes(t)
			change := routeChange("chat", "ollama", tc.model, "chat", "stream")
			change.ModelFacts.ContextWindow = tc.window
			res, err := h.svc.ApplySettings(h.request(t, change))
			if err != nil {
				t.Fatalf("ApplySettings: %v", err)
			}
			if res.Status != tc.wantStatus {
				t.Fatalf("ApplySettings = %+v, want status %s", res, tc.wantStatus)
			}
			if tc.wantStatus != "applied" {
				if len(res.Diagnostics) != 1 || res.Diagnostics[0].Code != codeSelectorConflict {
					t.Fatalf("diagnostics = %+v, want one %s", res.Diagnostics, codeSelectorConflict)
				}
				if string(h.targetBytes(t)) != string(before) {
					t.Fatal("a refused join changed the target")
				}
				return
			}
			var doc struct {
				Defaults map[string]string `json:"defaults"`
			}
			if err := json.Unmarshal(h.targetBytes(t), &doc); err != nil {
				t.Fatalf("written target: %v", err)
			}
			role := writtenModels(t, h)[doc.Defaults["chat"]]
			if role == nil {
				t.Fatalf("chat routes to %q, which the target does not define", doc.Defaults["chat"])
			}
			got, present := role["context_window"]
			if tc.wantWindow == "" {
				if present {
					t.Fatalf("chat's role %q carries context_window %s, want none", doc.Defaults["chat"], got)
				}
				return
			}
			if string(got) != tc.wantWindow {
				t.Fatalf("chat's role %q context_window = %s, want %s", doc.Defaults["chat"], got, tc.wantWindow)
			}
		})
	}
}

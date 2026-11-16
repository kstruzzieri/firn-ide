package ai

import (
	"context"
	"encoding/json"
	"testing"

	agenttools "github.com/kstruzzieri/go-llm/agent/tools"
	"github.com/kstruzzieri/go-llm/provider"
)

// TestRunFinishedModelIsTheAdmittedTarget pins the contract the chat receipt
// rests on (#492): the panel labels a finished turn with the destination
// StartTurn admitted it for, so the model golem reports in run.finished must be
// that same target. Chat has one fixed target and no backup, so a mismatch here
// would mean the receipt names a model that did not answer.
func TestRunFinishedModelIsTheAdmittedTarget(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	id, _ := h.bind(t)
	// The provider names a different model on the wire; the receipt and
	// run.finished both name the configured target, never provider text.
	backend := &scriptedProvider{name: "hosted", steps: []provider.ChatResponse{
		{Content: "an answer", Model: "provider-reported-name"},
	}}
	h.svc.newRunner = func(ctx context.Context, root string, target providerTarget, guard agenttools.ScopeGuard, sessions sessionStore) (Runner, error) {
		return newGolemRunner(ctx, root, target, guard, sessions, backend, nil, golemTuning{})
	}

	req := turnFor(runIdentityFor(id, "project"))
	admission, err := h.svc.StartTurn(context.Background(), req)
	if err != nil {
		t.Fatalf("StartTurn: %v", err)
	}
	if admission.State != "accepted" {
		t.Fatalf("admission state = %q, want accepted", admission.State)
	}
	if typ := waitRelayedTerminal(t, h.rec, req.Identity.RunID); typ != "run.finished" {
		t.Fatalf("terminal = %q, want run.finished", typ)
	}

	var finished *RelayedEvent
	for _, r := range h.rec.relayed() {
		if r.RunID == req.Identity.RunID && r.Type == "run.finished" {
			finished = &r
		}
	}
	var payload struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(finished.Payload, &payload); err != nil {
		t.Fatalf("unmarshal run.finished payload: %v", err)
	}
	want := admission.Destination.Provider + "/" + admission.Destination.Model
	if admission.Destination.Provider == "" || admission.Destination.Model == "" {
		t.Fatalf("admitted destination = %+v, want a provider and a model", admission.Destination)
	}
	if payload.Model != want {
		t.Fatalf("run.finished model = %q, want the admitted target %q", payload.Model, want)
	}
}

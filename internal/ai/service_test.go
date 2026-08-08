package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"firn/internal/filesystem"
	"github.com/kstruzzieri/go-llm/agent"
	agenttools "github.com/kstruzzieri/go-llm/agent/tools"
	"github.com/kstruzzieri/go-llm/config"
	"github.com/kstruzzieri/go-llm/conversation"
	"github.com/kstruzzieri/go-llm/golem"
	"github.com/kstruzzieri/go-llm/provider"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Test doubles and helpers
// ---------------------------------------------------------------------------

const (
	svcKeyMarker      = "API_KEY_MARKER"
	svcSpareKeyMarker = "UNSELECTED_KEY_MARKER"
)

// emitRecorder captures every host emit call; hook (if set) runs synchronously
// outside the recorder lock so it may call back into the Service.
type emitRecorder struct {
	mu     sync.Mutex
	events []emittedEvent
	hook   func(name string, args []any)
}

type emittedEvent struct {
	name string
	args []any
}

func (r *emitRecorder) emit(name string, args ...any) {
	r.mu.Lock()
	r.events = append(r.events, emittedEvent{name: name, args: args})
	hook := r.hook
	r.mu.Unlock()
	if hook != nil {
		hook(name, args)
	}
}

func (r *emitRecorder) setHook(hook func(string, []any)) {
	r.mu.Lock()
	r.hook = hook
	r.mu.Unlock()
}

func (r *emitRecorder) snapshot() []emittedEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]emittedEvent(nil), r.events...)
}

func (r *emitRecorder) count(name string) int {
	n := 0
	for _, e := range r.snapshot() {
		if e.name == name {
			n++
		}
	}
	return n
}

func (r *emitRecorder) relayed() []RelayedEvent {
	var out []RelayedEvent
	for _, e := range r.snapshot() {
		if e.name == eventGolemEvent && len(e.args) == 1 {
			if rel, ok := e.args[0].(RelayedEvent); ok {
				out = append(out, rel)
			}
		}
	}
	return out
}

func (r *emitRecorder) runStatuses() []RunStatusEvent {
	var out []RunStatusEvent
	for _, e := range r.snapshot() {
		if e.name == eventGolemRunStatus && len(e.args) == 1 {
			if ev, ok := e.args[0].(RunStatusEvent); ok {
				out = append(out, ev)
			}
		}
	}
	return out
}

func assertEmitsClean(t *testing.T, rec *emitRecorder, markers ...string) {
	t.Helper()
	for _, e := range rec.snapshot() {
		raw, err := json.Marshal(e.args)
		if err != nil {
			t.Fatalf("marshal emitted args for %s: %v", e.name, err)
		}
		for _, m := range markers {
			if strings.Contains(string(raw), m) {
				t.Fatalf("host event %s leaks %q: %s", e.name, m, raw)
			}
		}
	}
}

// fakeRunner is a scriptable Runner with counters. A runner without its own
// run fn reads the factory's CURRENT default at call time, so setRun affects
// cached (reused) runners too.
type fakeRunner struct {
	mu      sync.Mutex
	run     func(context.Context, golem.Turn, golem.EventSink) (agent.Result, error)
	factory *fakeFactory
	runs    int
	cancels []string
	closed  int
}

func (f *fakeRunner) Run(ctx context.Context, turn golem.Turn, sink golem.EventSink) (agent.Result, error) {
	f.mu.Lock()
	f.runs++
	fn := f.run
	f.mu.Unlock()
	if fn == nil && f.factory != nil {
		f.factory.mu.Lock()
		fn = f.factory.run
		f.factory.mu.Unlock()
	}
	if fn == nil {
		return agent.Result{}, nil
	}
	return fn(ctx, turn, sink)
}

func (f *fakeRunner) Cancel(runID string) bool {
	f.mu.Lock()
	f.cancels = append(f.cancels, runID)
	f.mu.Unlock()
	return true
}

func (f *fakeRunner) Close() error {
	f.mu.Lock()
	f.closed++
	f.mu.Unlock()
	return nil
}

func (f *fakeRunner) closedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

func (f *fakeRunner) cancelCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.cancels)
}

// factoryCall records one runner construction.
type factoryCall struct {
	root     string
	target   providerTarget
	guard    agenttools.ScopeGuard
	sessions golem.SessionStore
	runner   *fakeRunner
}

// fakeFactory is a scriptable runnerFactory with optional entry/release
// barriers for lock-window races.
type fakeFactory struct {
	mu      sync.Mutex
	calls   []factoryCall
	fail    error
	run     func(context.Context, golem.Turn, golem.EventSink) (agent.Result, error)
	makeRun func(idx int, root string, target providerTarget, sessions golem.SessionStore) func(context.Context, golem.Turn, golem.EventSink) (agent.Result, error)
	onCall  func(factoryCall)
	enter   chan struct{}
	release chan struct{}
}

func (f *fakeFactory) factory() runnerFactory {
	return func(_ context.Context, root string, target providerTarget, guard agenttools.ScopeGuard, sessions golem.SessionStore) (Runner, error) {
		f.mu.Lock()
		enter, release := f.enter, f.release
		f.mu.Unlock()
		if enter != nil {
			enter <- struct{}{}
		}
		if release != nil {
			<-release
		}
		f.mu.Lock()
		if f.fail != nil {
			err := f.fail
			f.mu.Unlock()
			return nil, err
		}
		r := &fakeRunner{factory: f}
		if f.makeRun != nil {
			r.run = f.makeRun(len(f.calls), root, target, sessions)
		}
		call := factoryCall{root: root, target: target, guard: guard, sessions: sessions, runner: r}
		f.calls = append(f.calls, call)
		onCall := f.onCall
		f.mu.Unlock()
		if onCall != nil {
			onCall(call)
		}
		return r, nil
	}
}

func (f *fakeFactory) setRun(fn func(context.Context, golem.Turn, golem.EventSink) (agent.Result, error)) {
	f.mu.Lock()
	f.run = fn
	f.mu.Unlock()
}

func (f *fakeFactory) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func (f *fakeFactory) call(t *testing.T, i int) factoryCall {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if i >= len(f.calls) {
		t.Fatalf("factory call %d requested, only %d made", i, len(f.calls))
	}
	return f.calls[i]
}

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

// agentConfigJSON is a valid go-llm config with an explicit defaults.agent
// (no fallback chain) plus a second, unselected provider carrying its own key.
func agentConfigJSON(endpoint string) string {
	return fmt.Sprintf(`{
  "providers": {
    "hosted": {"base_url": %q, "api_format": "openai-compat", "api_key": %q},
    "spare": {"base_url": "http://localhost:9999", "api_format": "openai-compat", "api_key": %q}
  },
  "models": {
    "agent-m": {"name": "wire-model", "provider": "hosted", "type": "dense", "capabilities": ["chat", "stream", "tool_call"]},
    "spare-m": {"name": "spare-model", "provider": "spare", "type": "dense", "capabilities": ["chat", "stream", "tool_call"]}
  },
  "defaults": {"agent": "agent-m", "chat": "spare-m"}
}`, endpoint, svcKeyMarker, svcSpareKeyMarker)
}

// fixtureConfigLoader writes cfg outside any repository and returns a
// loadConfig replacement resolving it (the normal external-user-config case).
func fixtureConfigLoader(t *testing.T, cfgJSON string) func() (loadedAgentConfig, error) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "models-fixture.json")
	if err := os.WriteFile(path, []byte(cfgJSON), 0o600); err != nil {
		t.Fatalf("write config fixture: %v", err)
	}
	source := canonicalPath(t, path)
	return func() (loadedAgentConfig, error) {
		cfg, err := config.Load(source)
		if err != nil {
			return loadedAgentConfig{}, fmt.Errorf("%w: fixture failed to load: %v", ErrAgentConfigInvalid, err)
		}
		return loadedAgentConfig{Config: cfg, SourcePath: source}, nil
	}
}

type svcHarness struct {
	svc         *Service
	rec         *emitRecorder
	factory     *fakeFactory
	consentPath string
}

// newServiceHarness builds a Service with the four test seams replaced:
// fixture loadConfig, fake runner factory, real clock, real UUIDs.
func newServiceHarness(t *testing.T, endpoint string) *svcHarness {
	t.Helper()
	rec := &emitRecorder{}
	cpath := filepath.Join(t.TempDir(), "consent", "grants.json")
	svc := NewService(context.Background(), filesystem.NewOS(), cpath, rec.emit)
	svc.loadConfig = fixtureConfigLoader(t, agentConfigJSON(endpoint))
	f := &fakeFactory{}
	svc.newRunner = f.factory()
	h := &svcHarness{svc: svc, rec: rec, factory: f, consentPath: cpath}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		err := svc.Close(ctx)
		if errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("cleanup Close timed out: leaked run or admission")
		}
	})
	return h
}

func (h *svcHarness) bind(t *testing.T) (RepositoryIdentity, string) {
	t.Helper()
	repo := newRepo(t)
	id, err := h.svc.BindRepository(repo)
	if err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
	return id, repo
}

func runIdentityFor(repo RepositoryIdentity, workspaceID string) RunIdentity {
	return RunIdentity{
		RepoEpoch:      repo.RepoEpoch,
		WorkspaceID:    workspaceID,
		ConversationID: ConversationID(repo.RepoKey, workspaceID),
		RunID:          uuid.NewString(),
	}
}

func turnFor(id RunIdentity) TurnRequest {
	return TurnRequest{Identity: id, Message: "hello"}
}

func publicCode(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	var pe PublicError
	if !errors.As(err, &pe) {
		t.Fatalf("error %v (%T) is not a PublicError", err, err)
	}
	return pe.Code
}

func waitUntil(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func activeRunCount(svc *Service) int {
	svc.lifecycleMu.Lock()
	defer svc.lifecycleMu.Unlock()
	return len(svc.active)
}

func convRecordOf(svc *Service, conversationID string) *conversationRecord {
	svc.lifecycleMu.Lock()
	defer svc.lifecycleMu.Unlock()
	return svc.conversations[conversationID]
}

func convStateOf(conv *conversationRecord) convState {
	conv.mu.Lock()
	defer conv.mu.Unlock()
	return conv.state
}

func drainRuns(t *testing.T, svc *Service) {
	t.Helper()
	waitUntil(t, "active runs to drain", func() bool { return activeRunCount(svc) == 0 })
}

func onceClose(ch chan struct{}) func() {
	var once sync.Once
	return func() { once.Do(func() { close(ch) }) }
}

// startCountingServer listens on 0.0.0.0 (Remote classification) and counts
// every connection and request.
func startCountingServer(t *testing.T) (endpoint string, requests *int32) {
	t.Helper()
	ln, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	var reqs int32
	srv := &http.Server{Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		atomic.AddInt32(&reqs, 1)
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	return fmt.Sprintf("http://0.0.0.0:%d", ln.Addr().(*net.TCPAddr).Port), &reqs
}

// startLocalCountingServer is the same on 127.0.0.1 (Local classification).
func startLocalCountingServer(t *testing.T) (endpoint string, requests *int32) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	var reqs int32
	srv := &http.Server{Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		atomic.AddInt32(&reqs, 1)
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	return fmt.Sprintf("http://127.0.0.1:%d", ln.Addr().(*net.TCPAddr).Port), &reqs
}

func consentGrantCount(t *testing.T, path string) int {
	t.Helper()
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return 0
	}
	if err != nil {
		t.Fatalf("read consent file: %v", err)
	}
	var doc consentFile
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parse consent file: %v", err)
	}
	return len(doc.Grants)
}

func stampEvent(turn golem.Turn, typ string, seq uint64, payload string) golem.Event {
	return golem.Event{
		Protocol: golem.ProtocolVersion,
		ThreadID: turn.ThreadID,
		RunID:    turn.RunID,
		Seq:      seq,
		Type:     typ,
		Payload:  json.RawMessage(payload),
	}
}

// ---------------------------------------------------------------------------
// B5.1 — SanitizeError
// ---------------------------------------------------------------------------

func TestServiceSanitizeErrorAllowlist(t *testing.T) {
	rootMarker := "/abs/repo/root-marker"
	cfgMarker := "/home/user/.config/go-llm/models-marker.json"
	consentMarker := "/home/user/consent-marker.json"
	markers := []string{rootMarker, cfgMarker, consentMarker, svcKeyMarker}
	seed := fmt.Sprintf("root=%s cfg=%s consent=%s key=%s", rootMarker, cfgMarker, consentMarker, svcKeyMarker)

	cases := []struct {
		name string
		err  error
		code string
		msg  string
	}{
		{"config_missing", fmt.Errorf("%w: %s", ErrAgentConfigMissing, seed), "config_missing", "Golem configuration was not found."},
		{"config_invalid", fmt.Errorf("%w: %s", ErrAgentConfigInvalid, seed), "config_invalid", "Golem configuration is invalid."},
		{"consent_unavailable", fmt.Errorf("%w: %s", ErrConsentUnavailable, seed), "consent_unavailable", "Remote consent storage is unavailable."},
		{"request_rejected", fmt.Errorf("%w: epoch for %s", ErrRequestRejected, seed), "request_rejected", "The Golem request is invalid or stale."},
		{"workspace_unavailable", fmt.Errorf("%w: stat %q: %s", ErrWorkspaceUnavailable, rootMarker, seed), "workspace_unavailable", "The Golem workspace is unavailable."},
		{"run_failed", fmt.Errorf("%w: dial: %s", ErrRunFailed, seed), "run_failed", "The Golem run failed."},
		{"catch_all_unknown", fmt.Errorf("mystery: %s", seed), "golem_unavailable", "Golem is unavailable."},
		{"catch_all_internal", errServiceClosing, "golem_unavailable", "Golem is unavailable."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pe := SanitizeError(tc.err)
			if pe.Code != tc.code || pe.Message != tc.msg {
				t.Fatalf("SanitizeError = %+v, want code %q message %q", pe, tc.code, tc.msg)
			}
			if pe.Error() != tc.msg {
				t.Fatalf("Error() = %q, want the message only", pe.Error())
			}
			encoded, err := json.Marshal(RunStatusEvent{State: "failed", Message: pe.Message})
			if err != nil {
				t.Fatal(err)
			}
			for _, m := range markers {
				if strings.Contains(pe.Message, m) || strings.Contains(string(encoded), m) {
					t.Fatalf("sanitized output leaks %q", m)
				}
			}
		})
	}

	t.Run("wails_facing_error_strings", func(t *testing.T) {
		h := newServiceHarness(t, "http://127.0.0.1:1")
		// Unbound service: the ErrWorkspaceUnavailable chain (whose wrapped text
		// carries paths from Bind causes) must surface as the fixed message only.
		_, err := h.svc.StartTurn(context.Background(), turnFor(RunIdentity{RepoEpoch: 1, WorkspaceID: "project", ConversationID: "x", RunID: uuid.NewString()}))
		if err == nil || err.Error() != "The Golem workspace is unavailable." {
			t.Fatalf("unbound StartTurn error = %v, want the fixed workspace message", err)
		}
		missing := filepath.Join(t.TempDir(), "missing", "repo-path-marker")
		_, err = h.svc.BindRepository(missing)
		if err == nil || err.Error() != "The Golem workspace is unavailable." {
			t.Fatalf("failed bind error = %v, want the fixed workspace message", err)
		}
		if strings.Contains(err.Error(), "repo-path-marker") {
			t.Fatalf("bind error leaks the path: %v", err)
		}
	})
}

// ---------------------------------------------------------------------------
// B5.1 — admission and identity validation
// ---------------------------------------------------------------------------

func TestServiceStartTurnAdmissionValidation(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repoID, _ := h.bind(t)
	base := runIdentityFor(repoID, "project")
	ctx := context.Background()

	valid := uuid.NewString()
	badRunIDs := map[string]string{
		"uppercase":    strings.ToUpper(valid),
		"braced":       "{" + valid + "}",
		"urn":          "urn:uuid:" + valid,
		"unhyphenated": strings.ReplaceAll(valid, "-", ""),
		"non_v4":       valid[:14] + "1" + valid[15:],
		"non_rfc4122":  valid[:19] + "d" + valid[20:],
		"garbage":      "not-a-uuid",
		"empty":        "",
	}
	for name, runID := range badRunIDs {
		t.Run("run_id_"+name, func(t *testing.T) {
			id := base
			id.RunID = runID
			_, err := h.svc.StartTurn(ctx, turnFor(id))
			if code := publicCode(t, err); code != "request_rejected" {
				t.Fatalf("code = %q, want request_rejected for run ID %q", code, runID)
			}
		})
	}

	t.Run("empty_message", func(t *testing.T) {
		req := turnFor(runIdentityFor(repoID, "project"))
		req.Message = ""
		_, err := h.svc.StartTurn(ctx, req)
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("oversized_message", func(t *testing.T) {
		req := turnFor(runIdentityFor(repoID, "project"))
		req.Message = strings.Repeat("a", MaxTurnMessageBytes+1)
		_, err := h.svc.StartTurn(ctx, req)
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("stale_epoch", func(t *testing.T) {
		id := runIdentityFor(repoID, "project")
		id.RepoEpoch = repoID.RepoEpoch + 7
		_, err := h.svc.StartTurn(ctx, turnFor(id))
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("zero_epoch", func(t *testing.T) {
		id := runIdentityFor(repoID, "project")
		id.RepoEpoch = 0
		_, err := h.svc.StartTurn(ctx, turnFor(id))
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("unknown_workspace", func(t *testing.T) {
		id := runIdentityFor(repoID, "no-such-workspace")
		_, err := h.svc.StartTurn(ctx, turnFor(id))
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("wrong_conversation_id", func(t *testing.T) {
		id := runIdentityFor(repoID, "project")
		id.ConversationID = ConversationID(repoID.RepoKey, "frontend")
		_, err := h.svc.StartTurn(ctx, turnFor(id))
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("context_refs", func(t *testing.T) {
		req := turnFor(runIdentityFor(repoID, "project"))
		req.ContextRefs = []string{"ref-1"}
		_, err := h.svc.StartTurn(ctx, req)
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})

	if got := h.factory.callCount(); got != 0 {
		t.Fatalf("runner factory called %d times; every rejection must precede construction", got)
	}
}

func TestServiceStartTurnDuplicateConversationAndClaims(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repoID, _ := h.bind(t)
	ctx := context.Background()

	release := make(chan struct{})
	releaseOnce := onceClose(release)
	t.Cleanup(releaseOnce)
	h.factory.setRun(func(runCtx context.Context, _ golem.Turn, _ golem.EventSink) (agent.Result, error) {
		select {
		case <-release:
			return agent.Result{}, nil
		case <-runCtx.Done():
			return agent.Result{}, runCtx.Err()
		}
	})

	first := runIdentityFor(repoID, "project")
	adm, err := h.svc.StartTurn(ctx, turnFor(first))
	if err != nil || adm.State != "accepted" {
		t.Fatalf("first StartTurn = %+v, %v", adm, err)
	}

	// Duplicate active conversation is rejected before construction.
	second := runIdentityFor(repoID, "project")
	_, err = h.svc.StartTurn(ctx, turnFor(second))
	if code := publicCode(t, err); code != "request_rejected" {
		t.Fatalf("duplicate conversation code = %q", code)
	}

	// Reusing the ACTIVE run's UUID on another workspace is rejected.
	crossWS := runIdentityFor(repoID, "frontend")
	crossWS.RunID = first.RunID
	_, err = h.svc.StartTurn(ctx, turnFor(crossWS))
	if code := publicCode(t, err); code != "request_rejected" {
		t.Fatalf("cross-workspace reuse code = %q", code)
	}

	// A different conversation admits concurrently.
	other := runIdentityFor(repoID, "frontend")
	adm, err = h.svc.StartTurn(ctx, turnFor(other))
	if err != nil || adm.State != "accepted" {
		t.Fatalf("other-workspace StartTurn = %+v, %v", adm, err)
	}

	releaseOnce()
	drainRuns(t, h.svc)

	// Replay after a finished terminal is rejected: claims are tombstones.
	replay := first
	_, err = h.svc.StartTurn(ctx, turnFor(replay))
	if code := publicCode(t, err); code != "request_rejected" {
		t.Fatalf("replay-after-terminal code = %q", code)
	}
	// Cross-workspace reuse after terminal is also rejected.
	crossWS2 := runIdentityFor(repoID, "frontend")
	crossWS2.RunID = first.RunID
	_, err = h.svc.StartTurn(ctx, turnFor(crossWS2))
	if code := publicCode(t, err); code != "request_rejected" {
		t.Fatalf("cross-workspace reuse after terminal code = %q", code)
	}

	if got := h.factory.callCount(); got != 2 {
		t.Fatalf("factory calls = %d, want exactly the two accepted runs", got)
	}
}

// ---------------------------------------------------------------------------
// B5.1 — Status shape
// ---------------------------------------------------------------------------

func TestServiceStatusShape(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repo := newRepo(t)
	writeFile(t, filepath.Join(repo, "ai-kit.yaml"), ":\tnot yaml [")
	repoID, err := h.svc.BindRepository(repo)
	if err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
	repoRoot := canonical(t, repo)

	st, err := h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if !st.Available {
		t.Fatalf("Available = false: %+v", st)
	}
	if st.WorkspaceLabel != "Project" {
		t.Fatalf("WorkspaceLabel = %q, want the backend label", st.WorkspaceLabel)
	}
	wantConv := ConversationID(repoID.RepoKey, "project")
	if st.Identity != (ConversationIdentity{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project", ConversationID: wantConv}) {
		t.Fatalf("Identity = %+v", st.Identity)
	}
	if st.ActiveRuns == nil || len(st.ActiveRuns) != 0 {
		t.Fatalf("ActiveRuns = %#v, want a non-nil empty slice", st.ActiveRuns)
	}
	if st.Destination == nil || st.Destination.Classification != "local" {
		t.Fatalf("Destination = %+v", st.Destination)
	}
	if st.NeedsConsent {
		t.Fatal("NeedsConsent = true for a local destination")
	}
	if len(st.Warnings) == 0 {
		t.Fatalf("Warnings empty, want the malformed-manifest warning")
	}
	for _, w := range st.Warnings {
		if strings.Contains(w, repoRoot) || filepath.IsAbs(w) {
			t.Fatalf("warning carries an absolute path: %q", w)
		}
	}
	raw, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), repoRoot) || strings.Contains(string(raw), svcKeyMarker) {
		t.Fatalf("Status JSON leaks a path or key: %s", raw)
	}
	if !strings.Contains(string(raw), `"activeRuns":[]`) {
		t.Fatalf("Status JSON should carry an empty activeRuns array: %s", raw)
	}

	// Sorted active runs: two blocking background runs.
	release := make(chan struct{})
	releaseOnce := onceClose(release)
	t.Cleanup(releaseOnce)
	h.factory.setRun(func(runCtx context.Context, _ golem.Turn, _ golem.EventSink) (agent.Result, error) {
		select {
		case <-release:
			return agent.Result{}, nil
		case <-runCtx.Done():
			return agent.Result{}, runCtx.Err()
		}
	})
	idA := runIdentityFor(repoID, "project")
	idB := runIdentityFor(repoID, "frontend")
	for _, id := range []RunIdentity{idA, idB} {
		if _, err := h.svc.StartTurn(context.Background(), turnFor(id)); err != nil {
			t.Fatalf("StartTurn(%s): %v", id.WorkspaceID, err)
		}
	}
	st, err = h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if len(st.ActiveRuns) != 2 {
		t.Fatalf("ActiveRuns = %d, want 2", len(st.ActiveRuns))
	}
	want := []RunIdentity{idA, idB}
	sort.Slice(want, func(i, j int) bool {
		if want[i].ConversationID != want[j].ConversationID {
			return want[i].ConversationID < want[j].ConversationID
		}
		return want[i].RunID < want[j].RunID
	})
	for i, w := range want {
		if st.ActiveRuns[i].Identity != w {
			t.Fatalf("ActiveRuns[%d] = %+v, want %+v (sorted)", i, st.ActiveRuns[i].Identity, w)
		}
		if st.ActiveRuns[i].State != "running" {
			t.Fatalf("ActiveRuns[%d].State = %q", i, st.ActiveRuns[i].State)
		}
	}
	releaseOnce()
	drainRuns(t, h.svc)

	t.Run("unknown_workspace", func(t *testing.T) {
		st, err := h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "nope"})
		if err != nil {
			t.Fatalf("Status: %v", err)
		}
		if st.Available || st.InitError != "The Golem request is invalid or stale." {
			t.Fatalf("Status = %+v", st)
		}
		if st.ActiveRuns == nil {
			t.Fatal("ActiveRuns must stay non-nil")
		}
	})
	t.Run("stale_epoch", func(t *testing.T) {
		st, err := h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch + 5, WorkspaceID: "project"})
		if err != nil {
			t.Fatalf("Status: %v", err)
		}
		if st.Available || st.InitError != "The Golem request is invalid or stale." {
			t.Fatalf("Status = %+v", st)
		}
	})
	t.Run("config_missing_init_error", func(t *testing.T) {
		h2 := newServiceHarness(t, "http://127.0.0.1:1")
		repoID2, _ := h2.bind(t)
		h2.svc.loadConfig = func() (loadedAgentConfig, error) {
			return loadedAgentConfig{}, fmt.Errorf("%w: no config at /home/user/cfg-path-marker key=%s", ErrAgentConfigMissing, svcKeyMarker)
		}
		st, err := h2.svc.Status(StatusRequest{RepoEpoch: repoID2.RepoEpoch, WorkspaceID: "project"})
		if err != nil {
			t.Fatalf("Status: %v", err)
		}
		if st.Available || st.InitError != "Golem configuration was not found." {
			t.Fatalf("Status = %+v", st)
		}
		raw, err := json.Marshal(st)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range []string{"cfg-path-marker", svcKeyMarker} {
			if strings.Contains(string(raw), m) {
				t.Fatalf("Status JSON leaks %q: %s", m, raw)
			}
		}
	})
	t.Run("unbound", func(t *testing.T) {
		h3 := newServiceHarness(t, "http://127.0.0.1:1")
		st, err := h3.svc.Status(StatusRequest{RepoEpoch: 1, WorkspaceID: "project"})
		if err != nil {
			t.Fatalf("Status: %v", err)
		}
		if st.Available || st.InitError != "The Golem workspace is unavailable." {
			t.Fatalf("Status = %+v", st)
		}
	})
}

func TestServiceReloadPolicy(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repo := newRepo(t)
	writeFile(t, filepath.Join(repo, "ai-kit.yaml"), "sensitive_paths: []\n")
	repoID, err := h.svc.BindRepository(repo)
	if err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
	id := runIdentityFor(repoID, "project")
	if _, err := h.svc.StartTurn(context.Background(), turnFor(id)); err != nil {
		t.Fatalf("StartTurn: %v", err)
	}
	drainRuns(t, h.svc)
	guard := h.factory.call(t, 0).guard
	if err := guard("vault/data.txt", false); err != nil {
		t.Fatalf("guard denied vault before the rule exists: %v", err)
	}

	manifest := filepath.Join(canonical(t, repo), "ai-kit.yaml")
	writeFile(t, manifest, "sensitive_paths:\n  - \"vault/**\"\n")
	if !h.svc.ReloadPolicy(manifest) {
		t.Fatal("ReloadPolicy returned false for a watched manifest")
	}
	if h.svc.ReloadPolicy(filepath.Join(t.TempDir(), "elsewhere.yaml")) {
		t.Fatal("ReloadPolicy returned true for an unwatched path")
	}
	if err := guard("vault/data.txt", false); err == nil {
		t.Fatal("already-issued guard did not pick up the reloaded rule")
	}
}

// ---------------------------------------------------------------------------
// B5.2 — consent and zero egress
// ---------------------------------------------------------------------------

func TestServiceConsentFirstTurnZeroEgress(t *testing.T) {
	endpoint, requests := startCountingServer(t)
	h := newServiceHarness(t, endpoint)
	clock := &fakeClock{t: time.Now()}
	h.svc.now = clock.Now
	repoID, _ := h.bind(t)

	st, err := h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if !st.Available || !st.NeedsConsent || st.Destination == nil || st.Destination.Classification != "remote" {
		t.Fatalf("Status = %+v", st)
	}
	if st.ConsentChallenge != nil {
		t.Fatal("Status invented a challenge before any turn")
	}

	id := runIdentityFor(repoID, "project")
	adm, err := h.svc.StartTurn(context.Background(), turnFor(id))
	if err != nil {
		t.Fatalf("StartTurn: %v", err)
	}
	if adm.State != "needs_consent" || adm.ConsentChallenge == nil {
		t.Fatalf("admission = %+v", adm)
	}
	ch := adm.ConsentChallenge
	if _, err := uuid.Parse(ch.ID); err != nil {
		t.Fatalf("challenge ID %q is not opaque UUID: %v", ch.ID, err)
	}
	if ch.Identity != id {
		t.Fatalf("challenge identity = %+v, want the full run identity", ch.Identity)
	}
	if ch.Destination != adm.Destination || ch.DestinationDigest != adm.Destination.Digest {
		t.Fatalf("challenge destination = %+v vs %+v", ch.Destination, adm.Destination)
	}
	if want := clock.Now().Add(consentChallengeTTL).UnixMilli(); ch.ExpiresAt != want {
		t.Fatalf("ExpiresAt = %d, want %d", ch.ExpiresAt, want)
	}

	// Status now exposes the same pending challenge.
	st, err = h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if st.ConsentChallenge == nil || st.ConsentChallenge.ID != ch.ID {
		t.Fatalf("Status challenge = %+v, want ID %q", st.ConsentChallenge, ch.ID)
	}

	// A second submission is not the exact retry: rejected, still one challenge.
	other := runIdentityFor(repoID, "project")
	_, err = h.svc.StartTurn(context.Background(), turnFor(other))
	if code := publicCode(t, err); code != "request_rejected" {
		t.Fatalf("second submission code = %q", code)
	}

	if got := atomic.LoadInt32(requests); got != 0 {
		t.Fatalf("provider received %d request(s) before consent", got)
	}
	if got := h.factory.callCount(); got != 0 {
		t.Fatalf("runner constructed %d time(s) before consent", got)
	}
}

func TestServiceConsentRetryValidation(t *testing.T) {
	endpoint, requests := startCountingServer(t)
	h := newServiceHarness(t, endpoint)
	clock := &fakeClock{t: time.Now()}
	h.svc.now = clock.Now
	repoID, _ := h.bind(t)
	ctx := context.Background()

	id := runIdentityFor(repoID, "project")
	adm, err := h.svc.StartTurn(ctx, turnFor(id))
	if err != nil || adm.State != "needs_consent" {
		t.Fatalf("first turn = %+v, %v", adm, err)
	}
	chID := adm.ConsentChallenge.ID

	retry := func(identity RunIdentity, challengeID string) error {
		req := turnFor(identity)
		req.ConsentChallengeID = challengeID
		_, err := h.svc.StartTurn(ctx, req)
		return err
	}

	t.Run("wrong_challenge_id", func(t *testing.T) {
		if code := publicCode(t, retry(id, uuid.NewString())); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("wrong_run_id", func(t *testing.T) {
		wrong := id
		wrong.RunID = uuid.NewString()
		if code := publicCode(t, retry(wrong, chID)); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("wrong_workspace", func(t *testing.T) {
		wrong := runIdentityFor(repoID, "frontend")
		wrong.RunID = id.RunID
		if code := publicCode(t, retry(wrong, chID)); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("wrong_epoch", func(t *testing.T) {
		wrong := id
		wrong.RepoEpoch++
		if code := publicCode(t, retry(wrong, chID)); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("wrong_conversation", func(t *testing.T) {
		wrong := id
		wrong.ConversationID = ConversationID(repoID.RepoKey, "frontend")
		if code := publicCode(t, retry(wrong, chID)); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
	})
	t.Run("changed_destination", func(t *testing.T) {
		conv := convRecordOf(h.svc, id.ConversationID)
		conv.mu.Lock()
		orig := conv.challenge.DestinationDigest
		conv.challenge.DestinationDigest = "divergent-digest"
		conv.mu.Unlock()
		if code := publicCode(t, retry(id, chID)); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
		conv.mu.Lock()
		conv.challenge.DestinationDigest = orig
		conv.mu.Unlock()
	})
	t.Run("expired", func(t *testing.T) {
		clock.advance(consentChallengeTTL + time.Second)
		if code := publicCode(t, retry(id, chID)); code != "request_rejected" {
			t.Fatalf("code = %q", code)
		}
		st, err := h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
		if err != nil {
			t.Fatalf("Status: %v", err)
		}
		if st.ConsentChallenge != nil {
			t.Fatal("expired challenge still exposed")
		}
		// The expired challenge's UUID stays tombstoned.
		if code := publicCode(t, func() error { _, err := h.svc.StartTurn(ctx, turnFor(id)); return err }()); code != "request_rejected" {
			t.Fatalf("tombstoned reuse code = %q", code)
		}
	})
	t.Run("fresh_challenge_then_replay_after_grant", func(t *testing.T) {
		id2 := runIdentityFor(repoID, "project")
		adm, err := h.svc.StartTurn(ctx, turnFor(id2))
		if err != nil || adm.State != "needs_consent" {
			t.Fatalf("second challenge turn = %+v, %v", adm, err)
		}
		if got := atomic.LoadInt32(requests); got != 0 {
			t.Fatalf("provider saw %d request(s) pre-grant", got)
		}
		req := turnFor(id2)
		req.ConsentChallengeID = adm.ConsentChallenge.ID
		acc, err := h.svc.StartTurn(ctx, req)
		if err != nil || acc.State != "accepted" {
			t.Fatalf("valid retry = %+v, %v", acc, err)
		}
		drainRuns(t, h.svc)
		// Challenge replay after the run finished: rejected.
		if code := publicCode(t, retry(id2, adm.ConsentChallenge.ID)); code != "request_rejected" {
			t.Fatalf("replay code = %q", code)
		}
		// Consent persisted: the next run needs no challenge.
		id3 := runIdentityFor(repoID, "project")
		acc, err = h.svc.StartTurn(ctx, turnFor(id3))
		if err != nil || acc.State != "accepted" {
			t.Fatalf("post-grant turn = %+v, %v", acc, err)
		}
		drainRuns(t, h.svc)
	})
}

func TestServiceConsentGrantFailureDegradesOnce(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("directory permissions do not bind root")
	}
	endpoint, requests := startCountingServer(t)
	h := newServiceHarness(t, endpoint)
	repoID, _ := h.bind(t)
	ctx := context.Background()

	id := runIdentityFor(repoID, "project")
	adm, err := h.svc.StartTurn(ctx, turnFor(id))
	if err != nil || adm.State != "needs_consent" {
		t.Fatalf("first turn = %+v, %v", adm, err)
	}
	chID := adm.ConsentChallenge.ID
	dir := filepath.Dir(h.consentPath)
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	restore := func() {
		if err := os.Chmod(dir, 0o700); err != nil {
			t.Fatalf("chmod restore: %v", err)
		}
	}
	t.Cleanup(restore)

	retry := turnFor(id)
	retry.ConsentChallengeID = chID
	_, err = h.svc.StartTurn(ctx, retry)
	if code := publicCode(t, err); code != "consent_unavailable" {
		t.Fatalf("degraded retry code = %q", code)
	}
	if err.Error() != "Remote consent storage is unavailable." {
		t.Fatalf("degraded retry message = %q", err.Error())
	}
	st, err := h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if st.ConsentChallenge == nil || st.ConsentChallenge.ID != chID {
		t.Fatal("challenge was not retained across the failed grant")
	}
	degradedWarning := false
	for _, w := range st.Warnings {
		if w == "Remote consent storage is unavailable." {
			degradedWarning = true
		}
	}
	if !degradedWarning {
		t.Fatalf("degraded status not visible in warnings: %v", st.Warnings)
	}
	if got := h.rec.count(eventGolemStatusChanged); got != 1 {
		t.Fatalf("status-changed emissions = %d, want exactly 1 on healthy->degraded", got)
	}
	// A second failing retry does not re-emit.
	_, err = h.svc.StartTurn(ctx, retry)
	if code := publicCode(t, err); code != "consent_unavailable" {
		t.Fatalf("second degraded retry code = %q", code)
	}
	if got := h.rec.count(eventGolemStatusChanged); got != 1 {
		t.Fatalf("status-changed emissions = %d after repeat failure, want 1", got)
	}
	if got := atomic.LoadInt32(requests); got != 0 {
		t.Fatalf("provider saw %d request(s) while degraded", got)
	}
	if got := h.factory.callCount(); got != 0 {
		t.Fatalf("runner constructed %d time(s) while degraded", got)
	}

	// Recovery: persist first, consume once, then accept.
	restore()
	h.factory.mu.Lock()
	h.factory.onCall = func(factoryCall) {
		if consentGrantCount(t, h.consentPath) != 1 {
			t.Errorf("runner constructed before the grant was durable")
		}
	}
	h.factory.mu.Unlock()
	acc, err := h.svc.StartTurn(ctx, retry)
	if err != nil || acc.State != "accepted" {
		t.Fatalf("recovered retry = %+v, %v", acc, err)
	}
	if got := h.rec.count(eventGolemStatusChanged); got != 2 {
		t.Fatalf("status-changed emissions = %d after recovery, want 2", got)
	}
	drainRuns(t, h.svc)
	st, err = h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if st.NeedsConsent || st.ConsentChallenge != nil {
		t.Fatalf("post-grant Status = %+v", st)
	}
	// Subsequent runs for the destination need no new challenge.
	next := runIdentityFor(repoID, "project")
	acc, err = h.svc.StartTurn(ctx, turnFor(next))
	if err != nil || acc.State != "accepted" {
		t.Fatalf("subsequent turn = %+v, %v", acc, err)
	}
	drainRuns(t, h.svc)
}

func TestServiceConsentRaces(t *testing.T) {
	t.Run("two_first_submissions", func(t *testing.T) {
		endpoint, _ := startCountingServer(t)
		h := newServiceHarness(t, endpoint)
		repoID, _ := h.bind(t)
		idA := runIdentityFor(repoID, "project")
		idB := runIdentityFor(repoID, "project")

		start := make(chan struct{})
		results := make([]error, 2)
		admissions := make([]TurnAdmission, 2)
		var wg sync.WaitGroup
		for i, id := range []RunIdentity{idA, idB} {
			wg.Add(1)
			go func(i int, id RunIdentity) {
				defer wg.Done()
				<-start
				admissions[i], results[i] = h.svc.StartTurn(context.Background(), turnFor(id))
			}(i, id)
		}
		close(start)
		wg.Wait()

		challenges := 0
		for i := range results {
			if results[i] == nil {
				if admissions[i].State != "needs_consent" || admissions[i].ConsentChallenge == nil {
					t.Fatalf("winner admission = %+v", admissions[i])
				}
				challenges++
			} else if code := publicCode(t, results[i]); code != "request_rejected" {
				t.Fatalf("loser code = %q", code)
			}
		}
		if challenges != 1 {
			t.Fatalf("live challenges = %d, want exactly 1", challenges)
		}
		if got := h.factory.callCount(); got != 0 {
			t.Fatalf("factory calls = %d, want 0", got)
		}
	})

	t.Run("two_retries", func(t *testing.T) {
		endpoint, requests := startCountingServer(t)
		h := newServiceHarness(t, endpoint)
		repoID, _ := h.bind(t)
		id := runIdentityFor(repoID, "project")
		adm, err := h.svc.StartTurn(context.Background(), turnFor(id))
		if err != nil || adm.State != "needs_consent" {
			t.Fatalf("challenge turn = %+v, %v", adm, err)
		}

		release := make(chan struct{})
		releaseOnce := onceClose(release)
		t.Cleanup(releaseOnce)
		h.factory.setRun(func(runCtx context.Context, _ golem.Turn, _ golem.EventSink) (agent.Result, error) {
			select {
			case <-release:
				return agent.Result{}, nil
			case <-runCtx.Done():
				return agent.Result{}, runCtx.Err()
			}
		})
		h.factory.mu.Lock()
		h.factory.onCall = func(factoryCall) {
			if consentGrantCount(t, h.consentPath) != 1 {
				t.Errorf("runner constructed before the winning grant write was durable")
			}
			if got := atomic.LoadInt32(requests); got != 0 {
				t.Errorf("provider saw %d request(s) before the grant", got)
			}
		}
		h.factory.mu.Unlock()

		req := turnFor(id)
		req.ConsentChallengeID = adm.ConsentChallenge.ID
		start := make(chan struct{})
		results := make([]error, 2)
		states := make([]string, 2)
		var wg sync.WaitGroup
		for i := 0; i < 2; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				a, err := h.svc.StartTurn(context.Background(), req)
				results[i], states[i] = err, a.State
			}(i)
		}
		close(start)
		wg.Wait()

		accepted := 0
		for i := range results {
			if results[i] == nil {
				if states[i] != "accepted" {
					t.Fatalf("winner state = %q", states[i])
				}
				accepted++
			} else if code := publicCode(t, results[i]); code != "request_rejected" {
				t.Fatalf("loser code = %q (want busy-or-replay rejection)", code)
			}
		}
		if accepted != 1 {
			t.Fatalf("accepted = %d, want exactly 1", accepted)
		}
		if got := h.factory.callCount(); got != 1 {
			t.Fatalf("factory calls = %d, want exactly 1", got)
		}
		if got := consentGrantCount(t, h.consentPath); got != 1 {
			t.Fatalf("persisted grants = %d, want exactly 1", got)
		}
		releaseOnce()
		drainRuns(t, h.svc)
	})
}

func TestServiceLocalTargetNoChallenge(t *testing.T) {
	endpoint, requests := startLocalCountingServer(t)
	h := newServiceHarness(t, endpoint)
	repoID, _ := h.bind(t)

	id := runIdentityFor(repoID, "project")
	adm, err := h.svc.StartTurn(context.Background(), turnFor(id))
	if err != nil {
		t.Fatalf("StartTurn: %v", err)
	}
	if adm.State != "accepted" || adm.ConsentChallenge != nil {
		t.Fatalf("local admission = %+v, want accepted without a challenge", adm)
	}
	if adm.Destination.Classification != "local" {
		t.Fatalf("Destination = %+v", adm.Destination)
	}
	drainRuns(t, h.svc)
	if got := atomic.LoadInt32(requests); got != 0 {
		t.Fatalf("local admission produced %d provider request(s)", got)
	}
	if got := consentGrantCount(t, h.consentPath); got != 0 {
		t.Fatalf("local target wrote %d consent grant(s)", got)
	}
	if got := h.factory.callCount(); got != 1 {
		t.Fatalf("factory calls = %d, want 1", got)
	}
}

// ---------------------------------------------------------------------------
// B5.3 — event relay and terminals
// ---------------------------------------------------------------------------

func TestServiceEventRelayAndTerminals(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repoID, _ := h.bind(t)
	ctx := context.Background()

	t.Run("accepted_before_run_and_exact_relay", func(t *testing.T) {
		started := make(chan struct{})
		startedOnce := onceClose(started)
		t.Cleanup(startedOnce)
		finish := make(chan struct{})
		finishOnce := onceClose(finish)
		t.Cleanup(finishOnce)

		var sent []golem.Event
		var sentMu sync.Mutex
		h.factory.setRun(func(runCtx context.Context, turn golem.Turn, sink golem.EventSink) (agent.Result, error) {
			<-started
			events := []golem.Event{
				stampEvent(turn, "run.started", 1, `{}`),
				stampEvent(turn, "message.delta", 2, `{"messageId":"m1","text":"hel"}`),
				stampEvent(turn, "tool.started", 3, `{"toolCallId":"c1","name":"read_file","preview":"README.md"}`),
				stampEvent(turn, "tool.finished", 4, `{"toolCallId":"c1","name":"read_file","preview":"ok","isError":false}`),
			}
			sentMu.Lock()
			sent = append([]golem.Event(nil), events...)
			sentMu.Unlock()
			for _, e := range events {
				if err := sink(e); err != nil {
					return agent.Result{}, err
				}
			}
			if err := sink(stampEvent(turn, "run.finished", 5, `{"stopReason":"complete","model":"hosted/wire-model"}`)); err != nil {
				return agent.Result{}, err
			}
			<-finish
			return agent.Result{}, nil
		})

		id := runIdentityFor(repoID, "project")
		adm, err := h.svc.StartTurn(ctx, turnFor(id))
		if err != nil || adm.State != "accepted" {
			t.Fatalf("StartTurn = %+v, %v (must return before Run unblocks)", adm, err)
		}
		if got := len(h.rec.relayed()); got != 0 {
			t.Fatalf("events emitted before Run unblocked: %d", got)
		}
		startedOnce()
		waitUntil(t, "nonterminal relays", func() bool { return len(h.rec.relayed()) >= 4 })

		rel := h.rec.relayed()
		sentMu.Lock()
		expected := append([]golem.Event(nil), sent...)
		sentMu.Unlock()
		for i, e := range expected {
			got := rel[i]
			if got.Protocol != e.Protocol || got.ThreadID != e.ThreadID || got.RunID != e.RunID ||
				got.Seq != e.Seq || got.Type != e.Type || string(got.Payload) != string(e.Payload) {
				t.Fatalf("relay %d = %+v, want exact copy of %+v", i, got, e)
			}
			raw, err := json.Marshal(e)
			if err != nil {
				t.Fatal(err)
			}
			if got.Raw != string(raw) {
				t.Fatalf("relay %d Raw = %q, want full original JSON %q", i, got.Raw, raw)
			}
		}
		// The terminal is buffered while Run is blocked.
		for _, r := range h.rec.relayed() {
			if r.Type == "run.finished" {
				t.Fatal("terminal emitted while Run still blocked")
			}
		}
		finishOnce()
		drainRuns(t, h.svc)
		waitUntil(t, "terminal relay", func() bool {
			for _, r := range h.rec.relayed() {
				if r.Type == "run.finished" {
					return true
				}
			}
			return false
		})
	})

	t.Run("failed_and_canceled_terminals", func(t *testing.T) {
		// run.failed terminal relayed unchanged; no run-status fallback.
		h.factory.setRun(func(_ context.Context, turn golem.Turn, sink golem.EventSink) (agent.Result, error) {
			_ = sink(stampEvent(turn, "run.started", 1, `{}`))
			_ = sink(stampEvent(turn, "run.failed", 2, `{"code":"internal","message":"The Golem run failed."}`))
			return agent.Result{}, errors.New("raw provider explosion at /abs/path-marker")
		})
		conv := convRecordOf(h.svc, ConversationID(repoID.RepoKey, "project"))
		idFail := runIdentityFor(repoID, "project")
		if _, err := h.svc.StartTurn(ctx, turnFor(idFail)); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		drainRuns(t, h.svc)
		waitUntil(t, "run.failed relay", func() bool {
			for _, r := range h.rec.relayed() {
				if r.Type == "run.failed" && r.RunID == idFail.RunID {
					return true
				}
			}
			return false
		})
		for _, rs := range h.rec.runStatuses() {
			if rs.Identity == idFail {
				t.Fatalf("run-status fallback emitted despite a Golem terminal: %+v", rs)
			}
		}
		waitUntil(t, "conversation idle", func() bool { return convStateOf(conv) == stateIdle })
		assertEmitsClean(t, h.rec, "/abs/path-marker")
		// Replay after a failed terminal is rejected: claims are tombstones.
		_, err := h.svc.StartTurn(ctx, turnFor(idFail))
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("replay-after-failed code = %q", code)
		}

		// run.canceled terminal via Cancel.
		entered := make(chan struct{})
		h.factory.setRun(func(runCtx context.Context, turn golem.Turn, sink golem.EventSink) (agent.Result, error) {
			close(entered)
			<-runCtx.Done()
			_ = sink(stampEvent(turn, "run.canceled", 1, `{}`))
			return agent.Result{}, runCtx.Err()
		})
		idCancel := runIdentityFor(repoID, "project")
		if _, err := h.svc.StartTurn(ctx, turnFor(idCancel)); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		<-entered
		ok, err := h.svc.Cancel(idCancel)
		if err != nil || !ok {
			t.Fatalf("Cancel = %v, %v", ok, err)
		}
		drainRuns(t, h.svc)
		waitUntil(t, "run.canceled relay", func() bool {
			for _, r := range h.rec.relayed() {
				if r.Type == "run.canceled" && r.RunID == idCancel.RunID {
					return true
				}
			}
			return false
		})
		waitUntil(t, "conversation idle after cancel", func() bool { return convStateOf(conv) == stateIdle })
		// Terminal cleanup happened exactly once: a fresh run admits.
		h.factory.setRun(nil)
		idNext := runIdentityFor(repoID, "project")
		adm, err := h.svc.StartTurn(ctx, turnFor(idNext))
		if err != nil || adm.State != "accepted" {
			t.Fatalf("post-terminal admission = %+v, %v", adm, err)
		}
		drainRuns(t, h.svc)
	})

	t.Run("cross_run_event_stops_run", func(t *testing.T) {
		h.factory.setRun(func(_ context.Context, turn golem.Turn, sink golem.EventSink) (agent.Result, error) {
			forged := stampEvent(turn, "message.delta", 1, `{"messageId":"x","text":"forged"}`)
			forged.RunID = uuid.NewString() // cross-run
			if err := sink(forged); err == nil {
				t.Error("sink accepted a cross-run event")
			}
			forgedThread := stampEvent(turn, "message.delta", 2, `{"messageId":"y","text":"forged-thread"}`)
			forgedThread.ThreadID = "other-thread"
			if err := sink(forgedThread); err == nil {
				t.Error("sink accepted a cross-thread event")
			}
			return agent.Result{}, errors.New("stopped after invalid event")
		})
		id := runIdentityFor(repoID, "project")
		if _, err := h.svc.StartTurn(ctx, turnFor(id)); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		drainRuns(t, h.svc)
		waitUntil(t, "fallback for stopped run", func() bool {
			for _, rs := range h.rec.runStatuses() {
				if rs.Identity == id {
					return true
				}
			}
			return false
		})
		for _, r := range h.rec.relayed() {
			if strings.Contains(string(r.Payload), "forged") {
				t.Fatalf("invalid event was emitted: %+v", r)
			}
		}
	})
}

func TestServiceTerminalHeldUntilRunReturns(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repoID, _ := h.bind(t)
	id := runIdentityFor(repoID, "project")
	queued := runIdentityFor(repoID, "project")

	release := make(chan struct{})
	releaseOnce := onceClose(release)
	t.Cleanup(releaseOnce)
	var call int32
	h.factory.setRun(func(runCtx context.Context, turn golem.Turn, sink golem.EventSink) (agent.Result, error) {
		if atomic.AddInt32(&call, 1) > 1 {
			return agent.Result{}, nil // the queued turn
		}
		_ = sink(stampEvent(turn, "run.started", 1, `{}`))
		_ = sink(stampEvent(turn, "run.finished", 2, `{"stopReason":"complete","model":"m"}`))
		select {
		case <-release:
		case <-runCtx.Done():
		}
		return agent.Result{}, nil
	})

	var queuedErr error
	var queuedState string
	queuedDone := make(chan struct{})
	h.rec.setHook(func(name string, args []any) {
		if name != eventGolemEvent || len(args) != 1 {
			return
		}
		rel, ok := args[0].(RelayedEvent)
		if !ok || rel.Type != "run.finished" || rel.RunID != id.RunID {
			return
		}
		// Listener-driven queue dispatch: the terminal arrives only after the
		// service released active state, so this admission must be accepted.
		adm, err := h.svc.StartTurn(context.Background(), turnFor(queued))
		queuedErr, queuedState = err, adm.State
		close(queuedDone)
	})

	if _, err := h.svc.StartTurn(context.Background(), turnFor(id)); err != nil {
		t.Fatalf("StartTurn: %v", err)
	}
	// Terminal must be held while Run is still blocked.
	time.Sleep(30 * time.Millisecond)
	for _, r := range h.rec.relayed() {
		if r.Type == "run.finished" {
			t.Fatal("terminal emitted before Run returned")
		}
	}
	releaseOnce()
	<-queuedDone
	if queuedErr != nil || queuedState != "accepted" {
		t.Fatalf("queued turn = %q, %v; want accepted, not spuriously busy", queuedState, queuedErr)
	}
	drainRuns(t, h.svc)
}

func TestServiceRunErrorFallbackAndHostLog(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repoID, _ := h.bind(t)
	ctx := context.Background()

	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(prev) })

	rawMarker := "/abs/root/raw-failure-marker key=" + svcKeyMarker

	t.Run("generic_error", func(t *testing.T) {
		h.factory.setRun(func(context.Context, golem.Turn, golem.EventSink) (agent.Result, error) {
			return agent.Result{}, errors.New("provider blew up: " + rawMarker)
		})
		id := runIdentityFor(repoID, "project")
		if _, err := h.svc.StartTurn(ctx, turnFor(id)); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		drainRuns(t, h.svc)
		waitUntil(t, "failed fallback", func() bool {
			for _, rs := range h.rec.runStatuses() {
				if rs.Identity == id {
					return true
				}
			}
			return false
		})
		var got RunStatusEvent
		for _, rs := range h.rec.runStatuses() {
			if rs.Identity == id {
				got = rs
			}
		}
		if got.State != "failed" || got.Message != "The Golem run failed." {
			t.Fatalf("fallback = %+v", got)
		}
		if len(h.rec.relayed()) != 0 {
			t.Fatalf("fabricated golem:event emitted: %+v", h.rec.relayed())
		}
		if !strings.Contains(buf.String(), "raw-failure-marker") {
			t.Fatal("raw cause was not host-logged")
		}
		assertEmitsClean(t, h.rec, "raw-failure-marker", svcKeyMarker)
	})

	t.Run("session_limit_logged_distinctly", func(t *testing.T) {
		buf.Reset()
		h.factory.setRun(func(context.Context, golem.Turn, golem.EventSink) (agent.Result, error) {
			return agent.Result{}, fmt.Errorf("save refused: %w: snapshot for %s", ErrSessionLimit, rawMarker)
		})
		id := runIdentityFor(repoID, "project")
		if _, err := h.svc.StartTurn(ctx, turnFor(id)); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		drainRuns(t, h.svc)
		waitUntil(t, "failed fallback", func() bool {
			for _, rs := range h.rec.runStatuses() {
				if rs.Identity == id {
					return true
				}
			}
			return false
		})
		var got RunStatusEvent
		for _, rs := range h.rec.runStatuses() {
			if rs.Identity == id {
				got = rs
			}
		}
		if got.Message != "The Golem run failed." {
			t.Fatalf("public message = %q, allowlist must not grow", got.Message)
		}
		if !strings.Contains(buf.String(), "session memory limit") {
			t.Fatalf("session-limit cause not logged distinctly: %s", buf.String())
		}
		assertEmitsClean(t, h.rec, "raw-failure-marker", svcKeyMarker)
	})
}

// ---------------------------------------------------------------------------
// B5.3 — background runs, cancel, rebind, retirement
// ---------------------------------------------------------------------------

func TestServiceBackgroundRunsAndCancel(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repoID, _ := h.bind(t)
	ctx := context.Background()

	entered := make(chan struct{})
	holdAfterCancel := make(chan struct{})
	holdOnce := onceClose(holdAfterCancel)
	t.Cleanup(holdOnce)
	h.factory.setRun(func(runCtx context.Context, _ golem.Turn, _ golem.EventSink) (agent.Result, error) {
		close(entered)
		<-runCtx.Done()
		<-holdAfterCancel // keep the run live so the canceling state is observable
		return agent.Result{}, runCtx.Err()
	})
	id := runIdentityFor(repoID, "project")
	if _, err := h.svc.StartTurn(ctx, turnFor(id)); err != nil {
		t.Fatalf("StartTurn: %v", err)
	}
	<-entered
	runner := h.factory.call(t, 0).runner

	// A repository switch does not cancel the admitted run.
	repoB := newRepo(t)
	repoBID, err := h.svc.BindRepository(repoB)
	if err != nil {
		t.Fatalf("BindRepository(B): %v", err)
	}
	if repoBID.RepoEpoch == repoID.RepoEpoch {
		t.Fatal("expected a new epoch for the different repository")
	}
	if runner.closedCount() != 0 {
		t.Fatal("binding switch closed the active runner")
	}
	if activeRunCount(h.svc) != 1 {
		t.Fatal("binding switch dropped the active run")
	}

	// Status under the new binding still lists the background run.
	st, err := h.svc.Status(StatusRequest{RepoEpoch: repoBID.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if len(st.ActiveRuns) != 1 || st.ActiveRuns[0].Identity != id {
		t.Fatalf("ActiveRuns = %+v, want the background run", st.ActiveRuns)
	}

	// Wrong identity cannot cancel.
	wrong := id
	wrong.RepoEpoch = repoBID.RepoEpoch
	if ok, err := h.svc.Cancel(wrong); ok || err == nil {
		t.Fatalf("wrong-identity Cancel = %v, %v", ok, err)
	}
	if ok, err := h.svc.Cancel(runIdentityFor(repoBID, "project")); ok || err == nil {
		t.Fatalf("unknown-run Cancel = %v, %v", ok, err)
	}

	// The exact old identity cancels: both Runner.Cancel and host ctx cancel.
	ok, err := h.svc.Cancel(id)
	if err != nil || !ok {
		t.Fatalf("Cancel = %v, %v", ok, err)
	}
	if runner.cancelCount() != 1 {
		t.Fatalf("Runner.Cancel calls = %d, want 1", runner.cancelCount())
	}
	st, err = h.svc.Status(StatusRequest{RepoEpoch: repoBID.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if len(st.ActiveRuns) != 1 || st.ActiveRuns[0].State != "canceling" {
		t.Fatalf("ActiveRuns after Cancel = %+v", st.ActiveRuns)
	}
	holdOnce()
	drainRuns(t, h.svc)
	// The retired incarnation's runner closes after terminal cleanup.
	waitUntil(t, "stale runner close", func() bool { return runner.closedCount() == 1 })
}

func TestServiceCancelPendingConsent(t *testing.T) {
	endpoint, _ := startCountingServer(t)
	h := newServiceHarness(t, endpoint)
	repoID, _ := h.bind(t)
	ctx := context.Background()

	id := runIdentityFor(repoID, "project")
	adm, err := h.svc.StartTurn(ctx, turnFor(id))
	if err != nil || adm.State != "needs_consent" {
		t.Fatalf("challenge turn = %+v, %v", adm, err)
	}

	// The hook calls back into the service, proving the canceled fallback is
	// emitted after all locks are released.
	statusOK := make(chan struct{})
	h.rec.setHook(func(name string, args []any) {
		if name != eventGolemRunStatus {
			return
		}
		if _, err := h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"}); err != nil {
			t.Errorf("Status inside emit hook: %v", err)
		}
		close(statusOK)
	})

	ok, err := h.svc.Cancel(id)
	if err != nil || !ok {
		t.Fatalf("Cancel = %v, %v", ok, err)
	}
	<-statusOK
	h.rec.setHook(nil)

	statuses := h.rec.runStatuses()
	if len(statuses) != 1 || statuses[0].State != "canceled" || statuses[0].Identity != id {
		t.Fatalf("run statuses = %+v, want one canceled fallback", statuses)
	}
	if got := h.factory.callCount(); got != 0 {
		t.Fatalf("factory calls = %d; declining consent must not construct a runner", got)
	}
	st, err := h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if st.ConsentChallenge != nil {
		t.Fatal("challenge survived its cancel")
	}
	conv := convRecordOf(h.svc, id.ConversationID)
	if convStateOf(conv) != stateIdle {
		t.Fatalf("conversation state = %q, want idle", convStateOf(conv))
	}
	// Retry of the canceled challenge and reuse of its UUID are rejected.
	req := turnFor(id)
	req.ConsentChallengeID = adm.ConsentChallenge.ID
	if code := publicCode(t, func() error { _, err := h.svc.StartTurn(ctx, req); return err }()); code != "request_rejected" {
		t.Fatalf("post-cancel retry code = %q", code)
	}
	if code := publicCode(t, func() error { _, err := h.svc.StartTurn(ctx, turnFor(id)); return err }()); code != "request_rejected" {
		t.Fatalf("post-cancel UUID reuse code = %q", code)
	}
	// A fresh run ID gets a fresh challenge.
	fresh := runIdentityFor(repoID, "project")
	adm, err = h.svc.StartTurn(ctx, turnFor(fresh))
	if err != nil || adm.State != "needs_consent" {
		t.Fatalf("fresh turn = %+v, %v", adm, err)
	}
	// Cancel with a non-matching pending identity does not consume it.
	stale := fresh
	stale.RunID = uuid.NewString()
	if ok, err := h.svc.Cancel(stale); ok || err == nil {
		t.Fatalf("mismatched pending Cancel = %v, %v", ok, err)
	}
}

func TestServiceRebindSessionRestoreAndChallengeInvalidation(t *testing.T) {
	t.Run("same_repo_rebind_restores_session", func(t *testing.T) {
		h := newServiceHarness(t, "http://127.0.0.1:1")
		repoID, repo := h.bind(t)
		ctx := context.Background()

		release := make(chan struct{})
		releaseOnce := onceClose(release)
		t.Cleanup(releaseOnce)
		loaded := make(chan error, 1)
		h.factory.mu.Lock()
		h.factory.makeRun = func(idx int, _ string, _ providerTarget, sessions golem.SessionStore) func(context.Context, golem.Turn, golem.EventSink) (agent.Result, error) {
			if idx == 0 {
				return func(runCtx context.Context, turn golem.Turn, _ golem.EventSink) (agent.Result, error) {
					if err := sessions.Save(runCtx, conversation.Conversation{ID: turn.ThreadID}); err != nil {
						t.Errorf("Save snapshot: %v", err)
					}
					select {
					case <-release:
					case <-runCtx.Done():
					}
					return agent.Result{}, nil
				}
			}
			return func(runCtx context.Context, turn golem.Turn, _ golem.EventSink) (agent.Result, error) {
				_, err := sessions.Load(runCtx, turn.ThreadID)
				loaded <- err
				return agent.Result{}, nil
			}
		}
		h.factory.mu.Unlock()

		oldRun := runIdentityFor(repoID, "project")
		if _, err := h.svc.StartTurn(ctx, turnFor(oldRun)); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		waitUntil(t, "first run active", func() bool { return activeRunCount(h.svc) == 1 })

		h.svc.UnbindRepository()
		repoID2, err := h.svc.BindRepository(repo)
		if err != nil {
			t.Fatalf("rebind: %v", err)
		}
		if repoID2.RepoKey != repoID.RepoKey || repoID2.RepoEpoch == repoID.RepoEpoch {
			t.Fatalf("rebind identity = %+v vs %+v, want same key, new epoch", repoID2, repoID)
		}
		// Same conversation ID across epochs.
		newRun := runIdentityFor(repoID2, "project")
		if newRun.ConversationID != oldRun.ConversationID {
			t.Fatal("conversation ID changed across the rebind")
		}
		// The old-epoch run is still active: the new epoch cannot admit yet.
		_, err = h.svc.StartTurn(ctx, turnFor(newRun))
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("admission while old-epoch run active: code = %q", code)
		}
		releaseOnce()
		drainRuns(t, h.svc)
		waitUntil(t, "old runner retired", func() bool { return h.factory.call(t, 0).runner.closedCount() == 1 })

		// After terminal, the new epoch admits and loads the prior snapshot.
		newRun2 := runIdentityFor(repoID2, "project")
		adm, err := h.svc.StartTurn(ctx, turnFor(newRun2))
		if err != nil || adm.State != "accepted" {
			t.Fatalf("new-epoch admission = %+v, %v", adm, err)
		}
		if err := <-loaded; err != nil {
			t.Fatalf("prior snapshot not restored: %v", err)
		}
		drainRuns(t, h.svc)
		if h.factory.call(t, 0).sessions != h.factory.call(t, 1).sessions {
			t.Fatal("runners did not share the single MemorySessionStore")
		}
	})

	t.Run("unbind_invalidates_challenges", func(t *testing.T) {
		endpoint, _ := startCountingServer(t)
		h := newServiceHarness(t, endpoint)
		repoID, repo := h.bind(t)
		ctx := context.Background()

		id := runIdentityFor(repoID, "project")
		adm, err := h.svc.StartTurn(ctx, turnFor(id))
		if err != nil || adm.State != "needs_consent" {
			t.Fatalf("challenge turn = %+v, %v", adm, err)
		}
		h.svc.UnbindRepository()

		// Retry against no binding fails as unavailable.
		req := turnFor(id)
		req.ConsentChallengeID = adm.ConsentChallenge.ID
		if code := publicCode(t, func() error { _, err := h.svc.StartTurn(ctx, req); return err }()); code != "workspace_unavailable" {
			t.Fatalf("unbound retry code = %q", code)
		}

		repoID2, err := h.svc.BindRepository(repo)
		if err != nil {
			t.Fatalf("rebind: %v", err)
		}
		st, err := h.svc.Status(StatusRequest{RepoEpoch: repoID2.RepoEpoch, WorkspaceID: "project"})
		if err != nil {
			t.Fatalf("Status: %v", err)
		}
		if st.ConsentChallenge != nil {
			t.Fatalf("rebound Status exposed an older-epoch challenge: %+v", st.ConsentChallenge)
		}
		// Retrying the dropped challenge under the new epoch is rejected.
		req2 := turnFor(runIdentityFor(repoID2, "project"))
		req2.ConsentChallengeID = adm.ConsentChallenge.ID
		if code := publicCode(t, func() error { _, err := h.svc.StartTurn(ctx, req2); return err }()); code != "request_rejected" {
			t.Fatalf("dropped-challenge retry code = %q", code)
		}
		// A fresh submission gets a fresh, current-epoch challenge.
		fresh := runIdentityFor(repoID2, "project")
		adm2, err := h.svc.StartTurn(ctx, turnFor(fresh))
		if err != nil || adm2.State != "needs_consent" {
			t.Fatalf("fresh turn = %+v, %v", adm2, err)
		}
		if adm2.ConsentChallenge.Identity.RepoEpoch != repoID2.RepoEpoch {
			t.Fatalf("fresh challenge epoch = %d", adm2.ConsentChallenge.Identity.RepoEpoch)
		}
	})
}

func TestServiceRetirementAndPolicyDetachment(t *testing.T) {
	t.Run("idle_runner_closes_on_unbind", func(t *testing.T) {
		h := newServiceHarness(t, "http://127.0.0.1:1")
		repoID, _ := h.bind(t)
		id := runIdentityFor(repoID, "project")
		if _, err := h.svc.StartTurn(context.Background(), turnFor(id)); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		drainRuns(t, h.svc)
		runner := h.factory.call(t, 0).runner
		guard := h.factory.call(t, 0).guard
		if err := guard("readme.md", false); err != nil {
			t.Fatalf("guard denied an ordinary file while attached: %v", err)
		}

		h.svc.UnbindRepository()
		if runner.closedCount() != 1 {
			t.Fatalf("idle runner closed %d time(s) after Unbind, want immediately once", runner.closedCount())
		}
		if err := guard("readme.md", false); err == nil {
			t.Fatal("detached policy still permits file access")
		}
		// No new turn admits on the retired epoch.
		_, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(repoID, "project")))
		if code := publicCode(t, err); code != "workspace_unavailable" {
			t.Fatalf("old-epoch admission code = %q", code)
		}
		if h.factory.callCount() != 1 {
			t.Fatal("retired-epoch admission constructed a runner")
		}
	})

	t.Run("bind_b_retires_a_failed_bind_leaves_a", func(t *testing.T) {
		h := newServiceHarness(t, "http://127.0.0.1:1")
		repoAID, _ := h.bind(t)
		ctx := context.Background()

		release := make(chan struct{})
		releaseOnce := onceClose(release)
		t.Cleanup(releaseOnce)
		h.factory.setRun(func(runCtx context.Context, _ golem.Turn, _ golem.EventSink) (agent.Result, error) {
			select {
			case <-release:
				return agent.Result{}, nil
			case <-runCtx.Done():
				return agent.Result{}, runCtx.Err()
			}
		})
		idA := runIdentityFor(repoAID, "project")
		if _, err := h.svc.StartTurn(ctx, turnFor(idA)); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		runnerA := h.factory.call(t, 0).runner
		guardA := h.factory.call(t, 0).guard

		// A failed bind leaves A fully current and attached.
		_, err := h.svc.BindRepository(filepath.Join(t.TempDir(), "missing"))
		if err == nil {
			t.Fatal("bind of a missing path succeeded")
		}
		if err := guardA("readme.md", false); err != nil {
			t.Fatalf("failed bind detached A's policy: %v", err)
		}
		st, err := h.svc.Status(StatusRequest{RepoEpoch: repoAID.RepoEpoch, WorkspaceID: "project"})
		if err != nil || !st.Available {
			t.Fatalf("A not current after failed bind: %+v, %v", st, err)
		}

		// A successful A -> B bind retires A without canceling its run.
		repoB := newRepo(t)
		repoBID, err := h.svc.BindRepository(repoB)
		if err != nil {
			t.Fatalf("BindRepository(B): %v", err)
		}
		if err := guardA("readme.md", false); err == nil {
			t.Fatal("A's policy still attached after A -> B")
		}
		if runnerA.closedCount() != 0 {
			t.Fatal("active runner closed during retirement")
		}
		if activeRunCount(h.svc) != 1 {
			t.Fatal("A's run canceled by the bind")
		}
		releaseOnce()
		drainRuns(t, h.svc)
		waitUntil(t, "A runner closed after terminal", func() bool { return runnerA.closedCount() == 1 })

		// B admits with its own refreshed policy.
		h.factory.setRun(nil)
		idB := runIdentityFor(repoBID, "project")
		adm, err := h.svc.StartTurn(ctx, turnFor(idB))
		if err != nil || adm.State != "accepted" {
			t.Fatalf("B admission = %+v, %v", adm, err)
		}
		drainRuns(t, h.svc)
		guardB := h.factory.call(t, 1).guard
		if err := guardB("readme.md", false); err != nil {
			t.Fatalf("B's guard denies ordinary files: %v", err)
		}
		if err := guardB(".env", false); err == nil {
			t.Fatal("B's guard permits the floor-denied .env")
		}
	})

	t.Run("close_detaches_policy", func(t *testing.T) {
		h := newServiceHarness(t, "http://127.0.0.1:1")
		repoID, _ := h.bind(t)
		if _, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(repoID, "project"))); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		drainRuns(t, h.svc)
		guard := h.factory.call(t, 0).guard
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := h.svc.Close(ctx); err != nil {
			t.Fatalf("Close: %v", err)
		}
		if err := guard("readme.md", false); err == nil {
			t.Fatal("policy still attached after Close")
		}
		if got := h.factory.call(t, 0).runner.closedCount(); got != 1 {
			t.Fatalf("cached runner closed %d time(s) by Close", got)
		}
	})
}

// ---------------------------------------------------------------------------
// B5.3 — Close lifecycle and barrier races
// ---------------------------------------------------------------------------

func TestServiceCloseLifecycle(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repoID, _ := h.bind(t)
	ctx := context.Background()

	release := make(chan struct{})
	releaseOnce := onceClose(release)
	t.Cleanup(releaseOnce)
	h.factory.setRun(func(runCtx context.Context, _ golem.Turn, _ golem.EventSink) (agent.Result, error) {
		<-runCtx.Done() // Close must cancel the run promptly...
		<-release       // ...while the test still pins the waitgroup.
		return agent.Result{}, runCtx.Err()
	})
	id := runIdentityFor(repoID, "project")
	if _, err := h.svc.StartTurn(ctx, turnFor(id)); err != nil {
		t.Fatalf("StartTurn: %v", err)
	}

	deadlineCtx, cancel := context.WithTimeout(ctx, 60*time.Millisecond)
	defer cancel()
	if err := h.svc.Close(deadlineCtx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline Close = %v, want ctx.Err()", err)
	}
	select {
	case <-h.svc.closeDone:
		t.Fatal("closeDone closed while a run still held the waitgroup")
	default:
	}

	// New admission and binds are rejected while closing.
	_, err := h.svc.StartTurn(ctx, turnFor(runIdentityFor(repoID, "frontend")))
	if err == nil || err.Error() != "Golem is unavailable." {
		t.Fatalf("closing StartTurn error = %v", err)
	}
	if _, err := h.svc.BindRepository(newRepo(t)); err == nil {
		t.Fatal("closing BindRepository succeeded")
	}
	h.svc.UnbindRepository() // post-close Unbind is an idempotent no-op

	releaseOnce()
	bg, cancelBG := context.WithTimeout(ctx, 10*time.Second)
	defer cancelBG()
	if err := h.svc.Close(bg); err != nil {
		t.Fatalf("second Close = %v, want the completed shutdown result", err)
	}
	if err := h.svc.Close(bg); err != nil {
		t.Fatalf("third Close = %v, want the same final result", err)
	}
	waitUntil(t, "canceled fallback", func() bool {
		for _, rs := range h.rec.runStatuses() {
			if rs.Identity == id && rs.State == "canceled" {
				return true
			}
		}
		return false
	})
	if got := h.factory.call(t, 0).runner.closedCount(); got != 1 {
		t.Fatalf("runner closed %d time(s), want exactly once", got)
	}
	if activeRunCount(h.svc) != 0 {
		t.Fatal("active run leaked past Close")
	}
}

func TestServiceCloseAdmissionBarrier(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	repoID, _ := h.bind(t)
	ctx := context.Background()

	enter := make(chan struct{})
	release := make(chan struct{})
	releaseOnce := onceClose(release)
	t.Cleanup(releaseOnce)
	h.factory.mu.Lock()
	h.factory.enter = enter
	h.factory.release = release
	h.factory.mu.Unlock()

	id := runIdentityFor(repoID, "project")
	admDone := make(chan error, 1)
	go func() {
		_, err := h.svc.StartTurn(ctx, turnFor(id))
		admDone <- err
	}()
	<-enter // admission now holds bindingGate read, conversation mu, state starting

	// Close marks closing immediately without waiting on the binding reader.
	deadlineCtx, cancel := context.WithTimeout(ctx, 60*time.Millisecond)
	defer cancel()
	if err := h.svc.Close(deadlineCtx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline Close = %v", err)
	}
	waitUntil(t, "closing mark", func() bool {
		h.svc.lifecycleMu.Lock()
		defer h.svc.lifecycleMu.Unlock()
		return h.svc.closing
	})
	select {
	case <-h.svc.closeDone:
		t.Fatal("shutdown finished while the admission held the binding reader")
	default:
	}

	// Releasing the admission lets it observe closing, roll back, and lets the
	// single background shutdown finish.
	releaseOnce()
	if err := <-admDone; err == nil || err.Error() != "Golem is unavailable." {
		t.Fatalf("blocked admission result = %v, want the closing rejection", err)
	}
	bg, cancelBG := context.WithTimeout(ctx, 10*time.Second)
	defer cancelBG()
	if err := h.svc.Close(bg); err != nil {
		t.Fatalf("Close after release = %v", err)
	}
	if got := h.factory.callCount(); got != 1 {
		t.Fatalf("factory calls = %d", got)
	}
	if got := h.factory.call(t, 0).runner.closedCount(); got != 1 {
		t.Fatalf("aborted admission closed its new runner %d time(s), want exactly once", got)
	}
	if activeRunCount(h.svc) != 0 {
		t.Fatal("aborted admission left an active entry")
	}
	conv := convRecordOf(h.svc, id.ConversationID)
	if conv == nil || convStateOf(conv) != stateIdle {
		t.Fatalf("conversation left in %v, want idle", convStateOf(conv))
	}
}

func TestServiceBindingBarriersWithAdmission(t *testing.T) {
	t.Run("admission_wins_then_unbind_retires_in_flight", func(t *testing.T) {
		h := newServiceHarness(t, "http://127.0.0.1:1")
		repoID, _ := h.bind(t)
		ctx := context.Background()

		enter := make(chan struct{})
		release := make(chan struct{})
		releaseOnce := onceClose(release)
		t.Cleanup(releaseOnce)
		h.factory.mu.Lock()
		h.factory.enter = enter
		h.factory.release = release
		h.factory.mu.Unlock()
		runRelease := make(chan struct{})
		runReleaseOnce := onceClose(runRelease)
		t.Cleanup(runReleaseOnce)
		h.factory.setRun(func(runCtx context.Context, _ golem.Turn, _ golem.EventSink) (agent.Result, error) {
			select {
			case <-runRelease:
				return agent.Result{}, nil
			case <-runCtx.Done():
				return agent.Result{}, runCtx.Err()
			}
		})

		id := runIdentityFor(repoID, "project")
		admDone := make(chan error, 1)
		go func() {
			_, err := h.svc.StartTurn(ctx, turnFor(id))
			admDone <- err
		}()
		<-enter // admission reserved starting and holds the binding reader

		unbindDone := make(chan struct{})
		go func() {
			h.svc.UnbindRepository()
			close(unbindDone)
		}()
		select {
		case <-unbindDone:
			t.Fatal("Unbind finished while an admission held the binding reader")
		case <-time.After(50 * time.Millisecond):
		}

		releaseOnce()
		if err := <-admDone; err != nil {
			t.Fatalf("admission that reserved starting first must launch: %v", err)
		}
		<-unbindDone
		// The launched run is an in-flight old-incarnation run.
		if activeRunCount(h.svc) != 1 {
			t.Fatal("in-flight run lost by the unbind")
		}
		ok, err := h.svc.Cancel(id)
		if err != nil || !ok {
			t.Fatalf("old-identity Cancel = %v, %v", ok, err)
		}
		drainRuns(t, h.svc)
		waitUntil(t, "runner closed", func() bool { return h.factory.call(t, 0).runner.closedCount() == 1 })
	})

	t.Run("binding_change_wins_then_admission_fails", func(t *testing.T) {
		h := newServiceHarness(t, "http://127.0.0.1:1")
		repoID, _ := h.bind(t)
		h.svc.UnbindRepository()
		_, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(repoID, "project")))
		if code := publicCode(t, err); code != "workspace_unavailable" {
			t.Fatalf("post-unbind admission code = %q", code)
		}
		if got := h.factory.callCount(); got != 0 {
			t.Fatalf("factory calls = %d; admission after retirement must not construct", got)
		}
	})

	t.Run("direct_a_to_b_bind_race", func(t *testing.T) {
		h := newServiceHarness(t, "http://127.0.0.1:1")
		repoAID, _ := h.bind(t)
		ctx := context.Background()

		enter := make(chan struct{})
		release := make(chan struct{})
		releaseOnce := onceClose(release)
		t.Cleanup(releaseOnce)
		h.factory.mu.Lock()
		h.factory.enter = enter
		h.factory.release = release
		h.factory.mu.Unlock()

		idA := runIdentityFor(repoAID, "project")
		admDone := make(chan error, 1)
		go func() {
			_, err := h.svc.StartTurn(ctx, turnFor(idA))
			admDone <- err
		}()
		<-enter

		repoB := newRepo(t)
		bindDone := make(chan error, 1)
		go func() {
			_, err := h.svc.BindRepository(repoB)
			bindDone <- err
		}()
		select {
		case err := <-bindDone:
			t.Fatalf("Bind(B) finished under an admission-held reader: %v", err)
		case <-time.After(50 * time.Millisecond):
		}

		releaseOnce()
		if err := <-admDone; err != nil {
			t.Fatalf("admission launched first: %v", err)
		}
		if err := <-bindDone; err != nil {
			t.Fatalf("Bind(B): %v", err)
		}
		// Old-epoch admission after the bind fails stale.
		_, err := h.svc.StartTurn(ctx, turnFor(runIdentityFor(repoAID, "frontend")))
		if code := publicCode(t, err); code != "request_rejected" {
			t.Fatalf("stale-epoch admission code = %q", code)
		}
		drainRuns(t, h.svc)
	})
}

func TestServiceCloseVersusBindUnbindBarrier(t *testing.T) {
	for i := 0; i < 8; i++ {
		h := newServiceHarness(t, "http://127.0.0.1:1")
		repoID, _ := h.bind(t)
		if _, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(repoID, "project"))); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		drainRuns(t, h.svc)
		runner := h.factory.call(t, 0).runner
		repoB := newRepo(t)

		var wg sync.WaitGroup
		start := make(chan struct{})
		wg.Add(3)
		go func() {
			defer wg.Done()
			<-start
			_, _ = h.svc.BindRepository(repoB)
		}()
		go func() {
			defer wg.Done()
			<-start
			h.svc.UnbindRepository()
		}()
		closeErr := make(chan error, 1)
		go func() {
			defer wg.Done()
			<-start
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			closeErr <- h.svc.Close(ctx)
		}()
		close(start)
		wg.Wait()
		firstClose := <-closeErr
		if firstClose != nil {
			t.Fatalf("iteration %d: Close = %v", i, firstClose)
		}
		// Post-close mutations reject/no-op; the shared runner closed once.
		if _, err := h.svc.BindRepository(repoB); err == nil {
			t.Fatalf("iteration %d: post-close Bind succeeded", i)
		}
		h.svc.UnbindRepository()
		waitUntil(t, "runner closed exactly once", func() bool { return runner.closedCount() == 1 })
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := h.svc.Close(ctx); err != nil {
			t.Fatalf("iteration %d: repeat Close = %v", i, err)
		}
		cancel()
	}
}

// ---------------------------------------------------------------------------
// B5.3 — process reset and config-source protection
// ---------------------------------------------------------------------------

func TestServiceProcessResetSemantics(t *testing.T) {
	endpoint, _ := startCountingServer(t)
	consentDir := t.TempDir()
	cpath := filepath.Join(consentDir, "consent", "grants.json")
	repo := newRepo(t)
	ctx := context.Background()

	build := func(t *testing.T) (*Service, *fakeFactory) {
		t.Helper()
		rec := &emitRecorder{}
		svc := NewService(context.Background(), filesystem.NewOS(), cpath, rec.emit)
		svc.loadConfig = fixtureConfigLoader(t, agentConfigJSON(endpoint))
		f := &fakeFactory{}
		svc.newRunner = f.factory()
		t.Cleanup(func() {
			cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := svc.Close(cctx); err != nil {
				t.Errorf("Close: %v", err)
			}
		})
		return svc, f
	}

	svc1, f1 := build(t)
	repoID1, err := svc1.BindRepository(repo)
	if err != nil {
		t.Fatalf("bind: %v", err)
	}
	f1.mu.Lock()
	f1.makeRun = func(_ int, _ string, _ providerTarget, sessions golem.SessionStore) func(context.Context, golem.Turn, golem.EventSink) (agent.Result, error) {
		return func(runCtx context.Context, turn golem.Turn, _ golem.EventSink) (agent.Result, error) {
			return agent.Result{}, sessions.Save(runCtx, conversation.Conversation{ID: turn.ThreadID})
		}
	}
	f1.mu.Unlock()
	id := runIdentityFor(repoID1, "project")
	adm, err := svc1.StartTurn(ctx, turnFor(id))
	if err != nil || adm.State != "needs_consent" {
		t.Fatalf("challenge turn = %+v, %v", adm, err)
	}
	retry := turnFor(id)
	retry.ConsentChallengeID = adm.ConsentChallenge.ID
	if acc, err := svc1.StartTurn(ctx, retry); err != nil || acc.State != "accepted" {
		t.Fatalf("retry = %+v, %v", acc, err)
	}
	waitUntil(t, "svc1 drain", func() bool { return activeRunCount(svc1) == 0 })

	// A new Service in the same process: no conversation snapshots, but the
	// persisted destination consent remains authoritative.
	svc2, f2 := build(t)
	repoID2, err := svc2.BindRepository(repo)
	if err != nil {
		t.Fatalf("bind 2: %v", err)
	}
	st, err := svc2.Status(StatusRequest{RepoEpoch: repoID2.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if st.NeedsConsent {
		t.Fatal("persisted consent not honored by the new Service")
	}
	loaded := make(chan error, 1)
	f2.mu.Lock()
	f2.makeRun = func(_ int, _ string, _ providerTarget, sessions golem.SessionStore) func(context.Context, golem.Turn, golem.EventSink) (agent.Result, error) {
		return func(runCtx context.Context, turn golem.Turn, _ golem.EventSink) (agent.Result, error) {
			_, err := sessions.Load(runCtx, turn.ThreadID)
			loaded <- err
			return agent.Result{}, nil
		}
	}
	f2.mu.Unlock()
	id2 := runIdentityFor(repoID2, "project")
	if acc, err := svc2.StartTurn(ctx, turnFor(id2)); err != nil || acc.State != "accepted" {
		t.Fatalf("svc2 turn = %+v, %v", acc, err)
	}
	if err := <-loaded; !errors.Is(err, conversation.ErrNotFound) {
		t.Fatalf("svc2 Load = %v, want ErrNotFound: process reset must not restore snapshots", err)
	}
	waitUntil(t, "svc2 drain", func() bool { return activeRunCount(svc2) == 0 })
}

func TestServiceRepoLocalConfigSourceProtected(t *testing.T) {
	sandboxAgentConfigEnv(t)
	endpoint, requests := startLocalCountingServer(t)
	repo := newRepo(t)
	const cfgName = "golem-keys.conf"
	writeFile(t, filepath.Join(repo, cfgName), agentConfigJSON(endpoint))
	t.Setenv("GO_LLM_CONFIG", filepath.Join(repo, cfgName))

	rec := &emitRecorder{}
	svc := NewService(context.Background(), filesystem.NewOS(), filepath.Join(t.TempDir(), "consent", "grants.json"), rec.emit)
	// Production loadConfig stays installed: discovery must resolve the
	// repo-local $GO_LLM_CONFIG source.
	f := &fakeFactory{}
	svc.newRunner = f.factory()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := svc.Close(ctx); err != nil {
			t.Errorf("Close: %v", err)
		}
	})

	repoID, err := svc.BindRepository(repo)
	if err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
	st, err := svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
	if err != nil || !st.Available {
		t.Fatalf("Status = %+v, %v", st, err)
	}
	id := runIdentityFor(repoID, "project")
	adm, err := svc.StartTurn(context.Background(), turnFor(id))
	if err != nil || adm.State != "accepted" {
		t.Fatalf("StartTurn = %+v, %v", adm, err)
	}
	waitUntil(t, "drain", func() bool { return activeRunCount(svc) == 0 })
	if got := atomic.LoadInt32(requests); got != 0 {
		t.Fatalf("provider saw %d request(s) during the protection step", got)
	}

	// Drive the real four built-in tools behind the captured guard.
	call := f.call(t, 0)
	backend := &scriptedProvider{name: "hosted", steps: []provider.ChatResponse{
		scriptedToolCall("c1", "glob", `{"pattern":"**"}`),
		scriptedToolCall("c2", "list", `{}`),
		scriptedToolCall("c3", "read_file", fmt.Sprintf(`{"path":%q}`, cfgName)),
		scriptedToolCall("c4", "search", fmt.Sprintf(`{"pattern":%q}`, svcKeyMarker)),
		scriptedToolCall("c5", "search", fmt.Sprintf(`{"pattern":%q}`, svcSpareKeyMarker)),
		{Content: "done"},
	}}
	runner, err := newGolemRunner(context.Background(), call.root, testTarget("hosted", "big-coder"), call.guard,
		NewMemorySessionStore(), backend, nil)
	if err != nil {
		t.Fatalf("newGolemRunner: %v", err)
	}
	defer func() {
		if err := runner.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	}()
	var events []golem.Event
	result, err := runner.Run(context.Background(), golem.Turn{
		RunID:    "run-protect",
		Message:  "inspect",
		Approver: approveAll{},
	}, collectSink(&events))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result.Answer != "done" {
		t.Fatalf("Answer = %q", result.Answer)
	}
	reqs := backend.recorded()
	last := reqs[len(reqs)-1]
	var observations []string
	for _, msg := range last.Messages {
		if msg.Role == "tool" {
			observations = append(observations, msg.Content)
		}
	}
	if len(observations) != 5 {
		t.Fatalf("observations = %d: %q", len(observations), observations)
	}
	for i, obs := range observations[:2] { // glob, list
		if strings.Contains(obs, cfgName) {
			t.Fatalf("tool %d exposed the config filename: %s", i, obs)
		}
	}
	if observations[2] != "path denied by workspace policy" {
		t.Fatalf("read_file observation = %q", observations[2])
	}
	for i := 3; i < 5; i++ { // searches for both keys
		if observations[i] != "no matches" {
			t.Fatalf("search observation %d = %q", i, observations[i])
		}
	}
	raw := marshalEvents(t, events)
	for _, m := range []string{cfgName, svcKeyMarker, svcSpareKeyMarker} {
		if strings.Contains(raw, m) {
			t.Fatalf("event stream leaks %q", m)
		}
	}
}

func TestServiceExternalConfigSourceNormal(t *testing.T) {
	endpoint, requests := startCountingServer(t)
	h := newServiceHarness(t, endpoint) // fixture config lives outside the repo
	repoID, repo := h.bind(t)

	// An in-repo file sharing the external source's basename stays readable:
	// ProtectConfigSource was a no-op for the outside-the-repo source.
	writeFile(t, filepath.Join(repo, "models-fixture.json"), `{"unrelated": true}`)

	st, err := h.svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
	if err != nil || !st.Available {
		t.Fatalf("Status = %+v, %v", st, err)
	}
	adm, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(repoID, "project")))
	if err != nil || adm.State != "needs_consent" {
		t.Fatalf("StartTurn = %+v, %v", adm, err)
	}
	if got := atomic.LoadInt32(requests); got != 0 {
		t.Fatalf("provider saw %d request(s) before consent/admission", got)
	}

	// The guard still enforces the floor but not the external source's name.
	binding := func() *serviceBinding {
		h.svc.lifecycleMu.Lock()
		defer h.svc.lifecycleMu.Unlock()
		return h.svc.binding
	}()
	if binding == nil {
		t.Fatal("no current binding")
	}
	guard := binding.policy.Guard("")
	if err := guard("models-fixture.json", false); err != nil {
		t.Fatalf("in-repo namesake denied; ProtectConfigSource was not a no-op: %v", err)
	}
	if err := guard(".env", false); err == nil {
		t.Fatal("floor rule not enforced")
	}

	// On Windows a different-volume source must behave identically: the
	// resolution path only hands the source to ProtectConfigSource, which
	// treats a cross-volume Rel failure as a successful no-op. Exercise it
	// there; other platforms cannot fabricate a second volume.
	if runtime.GOOS == "windows" {
		binding.policy.mu.Lock()
		protected := len(binding.policy.protected)
		binding.policy.mu.Unlock()
		if err := binding.policy.ProtectConfigSource(`D:\external\models.json`); err != nil {
			t.Fatalf("different-volume ProtectConfigSource: %v", err)
		}
		binding.policy.mu.Lock()
		after := len(binding.policy.protected)
		binding.policy.mu.Unlock()
		if after != protected {
			t.Fatal("different-volume source was protected; want a no-op")
		}
	}
}

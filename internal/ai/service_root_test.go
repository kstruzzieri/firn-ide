package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"firn/internal/filesystem"

	agenttools "github.com/kstruzzieri/go-llm/agent/tools"
	"github.com/kstruzzieri/go-llm/golem"
	"github.com/kstruzzieri/go-llm/provider"
)

// Reusing a runner whose file tools pinned the old directory makes every
// subsequent read fail. Rebuilding must retain history and enforce the new
// directory's policy, including when no watcher or repository refresh ran.
func TestServiceRebuildsRunnerAfterWorkspaceRootReplacement(t *testing.T) {
	for _, workspaceID := range []string{"project", "frontend"} {
		t.Run(workspaceID, func(t *testing.T) {
			h := newServiceHarness(t, "http://127.0.0.1:1")
			id, repo := h.bind(t)
			root, rel := repo, ""
			if workspaceID == "frontend" {
				root, rel = filepath.Join(repo, "frontend"), "frontend/"
			}
			writeFile(t, filepath.Join(root, "marker.txt"), "original contents")
			backend := &scriptedProvider{name: "hosted", steps: []provider.ChatResponse{
				scriptedToolCall("initial", "read_file", `{"path":"marker.txt"}`),
				{Content: "first answer"},
				scriptedToolCall("unchanged", "read_file", `{"path":"marker.txt"}`),
				{Content: "second answer"},
				scriptedToolCall("replacement", "read_file", `{"path":"marker.txt"}`),
				scriptedToolCall("protected", "read_file", `{"path":"private.txt"}`),
				{Content: "third answer"},
			}}
			var runners []Runner
			h.svc.newRunner = func(ctx context.Context, root string, target providerTarget, guard agenttools.ScopeGuard, sessions sessionStore) (Runner, error) {
				r, err := newGolemRunner(ctx, root, target, guard, sessions, backend, nil, golemTuning{})
				if err == nil {
					runners = append(runners, r)
				}
				return r, err
			}
			run := func(message string) {
				t.Helper()
				req := turnFor(runIdentityFor(id, workspaceID))
				req.Message = message
				if _, err := h.svc.StartTurn(context.Background(), req); err != nil {
					t.Fatalf("StartTurn(%q): %v", message, err)
				}
				if typ := waitRelayedTerminal(t, h.rec, req.Identity.RunID); typ != "run.finished" {
					t.Fatalf("StartTurn(%q) terminal = %q, want run.finished", message, typ)
				}
			}
			run("initial question")
			assertLastToolObservation(t, backend, "initial", "original contents")
			run("same directory")
			assertLastToolObservation(t, backend, "unchanged", "original contents")
			if len(runners) != 1 {
				t.Fatalf("unchanged workspace constructed %d runners, want 1", len(runners))
			}

			if err := os.Rename(root, filepath.Join(t.TempDir(), "old-root")); err != nil {
				t.Fatal(err)
			}
			writeFile(t, filepath.Join(root, "marker.txt"), "replacement contents")
			writeFile(t, filepath.Join(root, "private.txt"), "must stay private")
			writeFile(t, filepath.Join(root, "package.json"), `{}`)
			writeFile(t, filepath.Join(repo, "ai-kit.yaml"), "sensitive_paths: ["+rel+"private.txt]\n")
			if workspaceID == "frontend" {
				refreshed, _, err := h.svc.BindRepository(repo)
				if err != nil || refreshed != id {
					t.Fatalf("same-path BindRepository = %+v, %v; want %+v", refreshed, err, id)
				}
			}
			run("replacement question")
			assertLastToolObservation(t, backend, "replacement", "replacement contents")
			assertLastToolObservation(t, backend, "protected", "path denied by workspace policy")
			if len(runners) != 2 {
				t.Fatalf("replaced workspace constructed %d runners, want 2", len(runners))
			}
			// The runner built for the old directory owns a golem runtime: it
			// must be closed, not left cached beside its replacement.
			if _, err := runners[0].Run(context.Background(), golem.Turn{RunID: "closed", Message: "hello"}, func(golem.Event) error { return nil }); !errors.Is(err, golem.ErrClosed) {
				t.Fatalf("replaced runner Run = %v, want golem.ErrClosed", err)
			}
			reqs := backend.recorded()
			foundHistory := false
			for _, msg := range reqs[len(reqs)-1].Messages {
				if msg.Role == "user" && msg.Content == "initial question" {
					foundHistory = true
				}
			}
			if !foundHistory {
				t.Fatal("replacement runner lost the existing conversation history")
			}
		})
	}
}

func TestServiceRejectsUnavailableCachedRunnerRoot(t *testing.T) {
	for _, kind := range []string{"missing", "file", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			h := newServiceHarness(t, "http://127.0.0.1:1")
			id, repo := h.bind(t)
			first := runIdentityFor(id, "project")
			if _, err := h.svc.StartTurn(context.Background(), turnFor(first)); err != nil {
				t.Fatal(err)
			}
			waitUntil(t, "idle conversation", func() bool { return convStateOf(convRecordOf(h.svc, first.ConversationID)) == stateIdle })
			if err := os.Rename(repo, filepath.Join(t.TempDir(), "old-root")); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "file":
				writeFile(t, repo, "not a directory")
			case "symlink":
				if err := os.Symlink(t.TempDir(), repo); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
			}
			// The user moved or replaced the folder: say the workspace is gone,
			// not that the request was stale, which a retry would never fix.
			_, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(id, "project")))
			if code := publicCode(t, err); code != "workspace_unavailable" {
				t.Fatalf("StartTurn(%s root) code = %q, want workspace_unavailable", kind, code)
			}
		})
	}
}

// captureRunnerGuards records the guard each constructed runner receives,
// keyed by the runner's root, while the harness's own factory builds it.
func captureRunnerGuards(h *svcHarness) map[string]agenttools.ScopeGuard {
	guards := map[string]agenttools.ScopeGuard{}
	build := h.svc.newRunner
	h.svc.newRunner = func(ctx context.Context, root string, target providerTarget, guard agenttools.ScopeGuard, sessions sessionStore) (Runner, error) {
		guards[root] = guard
		return build(ctx, root, target, guard, sessions)
	}
	return guards
}

func idleTurn(t *testing.T, h *svcHarness, id RepositoryIdentity, workspaceID string) {
	t.Helper()
	if _, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(id, workspaceID))); err != nil {
		t.Fatalf("StartTurn(%s): %v", workspaceID, err)
	}
	drainRuns(t, h.svc)
}

// go-llm v0.3.0 pins a runner to its root directory, so a run in flight can
// keep reading a replaced workspace through the old descriptor while the
// rules describe the replacement. A runner's guard therefore admits nothing
// once the directory at its root is not the one the runner was built on,
// whether the repository or only the focused workspace was replaced.
func TestServiceRunnerGuardFailsClosedOnceItsRootIsReplaced(t *testing.T) {
	for _, workspaceID := range []string{"project", "frontend"} {
		t.Run(workspaceID, func(t *testing.T) {
			h := newServiceHarness(t, "http://127.0.0.1:1")
			id, repo := h.bind(t)
			guards := captureRunnerGuards(h)
			idleTurn(t, h, id, workspaceID)
			root := canonical(t, repo)
			if workspaceID == "frontend" {
				root = filepath.Join(root, "frontend")
			}
			guard := guards[root]
			if guard == nil {
				t.Fatalf("no runner built at %s (built: %v)", root, guards)
			}
			mustAllow(t, guard, "main.go")

			if err := os.Rename(root, filepath.Join(t.TempDir(), "old-root")); err != nil {
				t.Fatal(err)
			}
			writeFile(t, filepath.Join(root, "main.go"), "package main\n")
			mustDeny(t, guard, "main.go")
		})
	}
}

// The root is checked after the rules are evaluated. Checked first, a
// replacement plus a reload landing between the two steps would let the
// replacement's rules decide a read go-llm then performs through the pinned
// descriptor of the old directory.
func TestPinnedRootGuardChecksTheRootAfterTheRules(t *testing.T) {
	root := canonical(t, t.TempDir())
	pinned, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	// The rules allow the read, but evaluating them races a replacement of the
	// root, as a reload from the replacement would.
	replacedWhileEvaluating := func(string, bool) error {
		if err := os.Rename(root, filepath.Join(t.TempDir(), "old-root")); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(root, 0o755); err != nil {
			t.Fatal(err)
		}
		return nil
	}
	guard := pinnedRootGuard(filesystem.NewOS(), root, pinned, replacedWhileEvaluating)
	if err := guard("private.txt", false); err == nil {
		t.Fatal("a read decided while the root was replaced was allowed")
	}
}

// A reload skipped because the repository directory was away is not lost:
// the manifest may have changed meanwhile, and nothing else notices when the
// same directory returns (its runner is reused unchanged), so the next
// admission reloads.
func TestServiceAdmissionReloadsAPolicyReloadSkippedWhileAway(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	id, repo := h.bind(t)
	repo = canonical(t, repo)
	manifest := filepath.Join(repo, "ai-kit.yaml")
	writeFile(t, manifest, "sensitive_paths:\n  - private.txt\n")
	if !h.svc.ReloadPolicy(manifest) {
		t.Fatal("ReloadPolicy did not take the manifest")
	}
	guards := captureRunnerGuards(h)
	idleTurn(t, h, id, "project")
	guard := guards[repo]
	mustDeny(t, guard, "private.txt")

	away := filepath.Join(t.TempDir(), "away")
	if err := os.Rename(repo, away); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(away, "ai-kit.yaml")); err != nil {
		t.Fatal(err)
	}
	h.svc.ReloadPolicy(manifest) // the watcher's notification lands while it is away
	if err := os.Rename(away, repo); err != nil {
		t.Fatal(err)
	}
	built := len(guards)
	idleTurn(t, h, id, "project")
	if len(guards) != built {
		t.Fatal("the returning directory's runner was rebuilt; this test needs it reused")
	}
	mustAllow(t, guard, "private.txt")
}

// A repository replaced for good keeps the runner of a workspace directory
// moved into it unchanged, but the rules it holds were read from the old
// repository. Its guard denies until they are reread, and the next admission
// rereads them, after which the same runner decides under the new rules.
func TestServiceStaleRulesAfterARepositoryReplacementDenyUntilReread(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	id, repo := h.bind(t)
	repo = canonical(t, repo)
	guards := captureRunnerGuards(h)
	idleTurn(t, h, id, "frontend")
	frontend := filepath.Join(repo, "frontend")
	guard := guards[frontend]
	if guard == nil {
		t.Fatalf("no frontend runner built (built: %v)", guards)
	}
	mustAllow(t, guard, "private.txt")

	replacement := filepath.Join(t.TempDir(), "replacement")
	writeFile(t, filepath.Join(replacement, "go.mod"), "module x\n")
	writeFile(t, filepath.Join(replacement, "ai-kit.yaml"), "sensitive_paths:\n  - frontend/private.txt\n")
	old := filepath.Join(t.TempDir(), "old-repo")
	if err := os.Rename(repo, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, repo); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(old, "frontend"), frontend); err != nil {
		t.Fatal(err)
	}
	// The rules still describe the old repository.
	mustDeny(t, guard, "private.txt")
	mustDeny(t, guard, "src/app.tsx")

	built := len(guards)
	idleTurn(t, h, id, "frontend")
	if len(guards) != built {
		t.Fatal("the moved workspace's runner was rebuilt; this test needs it reused")
	}
	mustDeny(t, guard, "private.txt")
	mustAllow(t, guard, "src/app.tsx")
}

// The guard follows the runner's own directory, not the repository's: a
// workspace directory moved unchanged into a replaced repository is still
// the directory its runner was built on, so a reload from the replacement
// must not leave that runner denying every read.
func TestServiceRunnerSurvivesItsRepositoryBeingReplacedAroundIt(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	id, repo := h.bind(t)
	guards := captureRunnerGuards(h)
	idleTurn(t, h, id, "frontend")
	frontend := filepath.Join(canonical(t, repo), "frontend")
	guard := guards[frontend]
	if guard == nil {
		t.Fatalf("no frontend runner built (built: %v)", guards)
	}

	old := filepath.Join(t.TempDir(), "old-repo")
	if err := os.Rename(repo, old); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(repo, "go.mod"), "module x\n")
	if err := os.Rename(filepath.Join(old, "frontend"), frontend); err != nil {
		t.Fatal(err)
	}
	// The project workspace's first runner reloads the policy from the new
	// repository directory.
	idleTurn(t, h, id, "project")
	mustAllow(t, guard, "src/app.tsx")
}

// Swapping a parent of the repository for a symlink leaves an ordinary
// directory at the bound path, so only the canonical-path check sees it.
// Without that check the rebuilt runner would root itself, through the
// symlink, in a directory outside the repository the user bound.
func TestServiceRejectsRootBehindAReplacedParentSymlink(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	ctx := context.Background()
	base := canonical(t, t.TempDir())
	parent := filepath.Join(base, "parent")
	repo := filepath.Join(parent, "repo")
	writeFile(t, filepath.Join(repo, "go.mod"), "module x\n")
	id, _, err := h.svc.BindRepository(repo)
	if err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
	if _, err := h.svc.StartTurn(ctx, turnFor(runIdentityFor(id, "project"))); err != nil {
		t.Fatalf("first StartTurn: %v", err)
	}
	drainRuns(t, h.svc)

	elsewhere := filepath.Join(base, "elsewhere")
	writeFile(t, filepath.Join(elsewhere, "repo", "go.mod"), "module y\n")
	if err := os.Rename(parent, filepath.Join(base, "parent-old")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(elsewhere, parent); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	constructed := h.factory.callCount()
	_, err = h.svc.StartTurn(ctx, turnFor(runIdentityFor(id, "project")))
	if code := publicCode(t, err); code != "workspace_unavailable" {
		t.Fatalf("StartTurn behind a symlinked parent: code = %q, want workspace_unavailable", code)
	}
	if got := h.factory.callCount(); got != constructed {
		t.Fatalf("constructed %d runner(s) outside the bound repository", got-constructed)
	}
}

// A replaced directory brings its own manifests and no watcher event, so the
// admission-time reload is the only thing that sees new policy warnings. The
// panel shows warnings from Status, which it fetches on a status change, so
// admission must announce a change and stay quiet when nothing changed.
func TestServiceAdmissionReloadAnnouncesChangedPolicyWarnings(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	id, repo := h.bind(t)
	turn := func() {
		t.Helper()
		if _, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(id, "project"))); err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		drainRuns(t, h.svc)
	}
	turn()
	before := h.rec.count(EventGolemStatusChanged)

	if err := os.Rename(repo, filepath.Join(t.TempDir(), "old-root")); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(repo, "ai-kit.yaml"), "sensitive_paths: [\n")
	turn()
	if got := h.rec.count(EventGolemStatusChanged); got != before+1 {
		t.Fatalf("status-changed events after the reload = %d, want %d", got, before+1)
	}
	st, err := h.svc.Status(StatusRequest{RepoEpoch: id.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, w := range st.Warnings {
		found = found || strings.Contains(w, warnManifestMalformed)
	}
	if !found {
		t.Fatalf("Status warnings = %v, want the malformed-manifest warning", st.Warnings)
	}

	turn()
	if got := h.rec.count(EventGolemStatusChanged); got != before+1 {
		t.Fatalf("an unchanged turn emitted status-changed (%d events, want %d)", got, before+1)
	}
}

// The root check runs before a pending consent challenge is consumed.
// Otherwise the grant is written and the challenge consumed for a turn that
// cannot run, and every later Allow fails until the challenge expires.
func TestServiceUnavailableRootKeepsConsentChallenge(t *testing.T) {
	endpoint, _ := startCountingServer(t)
	h := newServiceHarness(t, endpoint)
	repoID, repo := h.bind(t)
	ctx := context.Background()
	id := runIdentityFor(repoID, "project")
	adm, err := h.svc.StartTurn(ctx, turnFor(id))
	if err != nil || adm.State != "needs_consent" {
		t.Fatalf("first turn = %+v, %v; want needs_consent", adm, err)
	}
	moved := filepath.Join(t.TempDir(), "moved")
	if err := os.Rename(repo, moved); err != nil {
		t.Fatal(err)
	}

	allow := turnFor(id)
	allow.ConsentChallengeID = adm.ConsentChallenge.ID
	_, err = h.svc.StartTurn(ctx, allow)
	if code := publicCode(t, err); code != "workspace_unavailable" {
		t.Fatalf("Allow with the root gone: code = %q, want workspace_unavailable", code)
	}
	if h.svc.consent.Has(adm.Destination.Digest) {
		t.Fatal("Allow with the root gone wrote a durable grant")
	}

	if err := os.Rename(moved, repo); err != nil {
		t.Fatal(err)
	}
	retried, err := h.svc.StartTurn(ctx, allow)
	if err != nil || retried.State != "accepted" {
		t.Fatalf("Allow after the root returned = %+v, %v; want accepted", retried, err)
	}
	drainRuns(t, h.svc)
}

// A post-construction-only sample can label an already stale runtime with the
// replacement inode, causing it to be reused forever. Reject this admission
// and release the new runtime; the next turn can construct against the new root.
func TestServiceRejectsRootReplacementDuringRunnerConstruction(t *testing.T) {
	h := newServiceHarness(t, "http://127.0.0.1:1")
	id, _ := h.bind(t)
	backend := &scriptedProvider{name: "hosted", steps: []provider.ChatResponse{
		scriptedToolCall("replacement", "read_file", `{"path":"marker.txt"}`),
		scriptedToolCall("protected", "read_file", `{"path":"private.txt"}`),
		{Content: "done"},
	}}
	var first Runner
	h.svc.newRunner = func(ctx context.Context, root string, target providerTarget, guard agenttools.ScopeGuard, sessions sessionStore) (Runner, error) {
		runner, err := newGolemRunner(ctx, root, target, guard, sessions, backend, nil, golemTuning{})
		if err != nil || first != nil {
			return runner, err
		}
		first = runner
		if err := os.Rename(root, filepath.Join(t.TempDir(), "old-root")); err != nil {
			t.Fatal(err)
		}
		writeFile(t, filepath.Join(root, "marker.txt"), "replacement contents")
		writeFile(t, filepath.Join(root, "private.txt"), "must stay private")
		writeFile(t, filepath.Join(root, "ai-kit.yaml"), "sensitive_paths: [private.txt]\n")
		return runner, nil
	}
	_, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(id, "project")))
	if code := publicCode(t, err); code != "request_rejected" {
		t.Fatalf("StartTurn(root changed during construction) code = %q, want request_rejected", code)
	}
	if len(backend.recorded()) != 0 {
		t.Fatal("rejected construction sent a model request")
	}
	if _, err := first.Run(context.Background(), golem.Turn{RunID: "closed", Message: "hello"}, func(golem.Event) error { return nil }); !errors.Is(err, golem.ErrClosed) {
		t.Fatalf("rejected runner Run = %v, want golem.ErrClosed", err)
	}
	next := runIdentityFor(id, "project")
	if _, err := h.svc.StartTurn(context.Background(), turnFor(next)); err != nil {
		t.Fatalf("StartTurn(retry): %v", err)
	}
	if typ := waitRelayedTerminal(t, h.rec, next.RunID); typ != "run.finished" {
		t.Fatalf("StartTurn(retry) terminal = %q, want run.finished", typ)
	}
	assertLastToolObservation(t, backend, "replacement", "replacement contents")
	assertLastToolObservation(t, backend, "protected", "path denied by workspace policy")
}

func assertLastToolObservation(t *testing.T, backend *scriptedProvider, callID, want string) {
	t.Helper()
	reqs := backend.recorded()
	if len(reqs) == 0 {
		t.Fatal("no model requests")
	}
	for _, msg := range reqs[len(reqs)-1].Messages {
		if msg.Role == "tool" && msg.ToolCallID == callID {
			if got := unfenceToolResult(t, msg.Content); got != want {
				t.Fatalf("tool %q observation = %q, want %q", callID, got, want)
			}
			return
		}
	}
	t.Fatalf("model request has no observation for tool %q", callID)
}

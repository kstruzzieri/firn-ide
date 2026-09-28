package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

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
			constructed := 0
			h.svc.newRunner = func(ctx context.Context, root string, target providerTarget, guard agenttools.ScopeGuard, sessions sessionStore) (Runner, error) {
				constructed++
				return newGolemRunner(ctx, root, target, guard, sessions, backend, nil, golemTuning{})
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
			if constructed != 1 {
				t.Fatalf("unchanged workspace constructed %d runners, want 1", constructed)
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
			if constructed != 2 {
				t.Fatalf("replaced workspace constructed %d runners, want 2", constructed)
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
			_, err := h.svc.StartTurn(context.Background(), turnFor(runIdentityFor(id, "project")))
			if code := publicCode(t, err); code != "request_rejected" {
				t.Fatalf("StartTurn(%s root) code = %q, want request_rejected", kind, code)
			}
		})
	}
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

package workspace

import (
	"fmt"
	"sync"
	"testing"

	"firn/internal/filesystem"
)

const pythonOverride = "/ws/.venv/bin/python"

func sessionWithActive(n int) State {
	return State{
		WorkspacePath: "/ws",
		WorkspaceName: "ws",
		Editor:        EditorState{ActiveFilePath: fmt.Sprintf("/ws/%d.go", n)},
	}
}

// An interpreter change must never write back an older session than the one
// a concurrent session save just wrote (#401). Before SetLSPInterpreter the
// app loaded the state, set the override and saved it again in two locked
// steps, so a session save landing between them was overwritten with the
// older tabs and layout. Each session save here must read back as itself,
// whatever interpreter changes run alongside it.
//
// This is a stress test: the old window sat between two store calls, outside
// the store, where no filesystem hook can hold it open, so catching the old
// code depends on scheduling (it did in 3 of 3 runs). The fixed code holds
// the lock across the read and the write, so the test cannot fail on it.
func TestSetLSPInterpreterNeverWritesBackAnOlderSession(t *testing.T) {
	store := NewStore(filesystem.NewOS(), t.TempDir())
	if err := store.Save(sessionWithActive(0)); err != nil {
		t.Fatalf("seed Save: %v", err)
	}

	const rounds = 200
	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-done:
				return
			default:
			}
			if err := store.SetLSPInterpreter("/ws", pythonOverride); err != nil {
				t.Errorf("SetLSPInterpreter: %v", err)
				return
			}
		}
	}()
	// Stop and join the writer on every exit, t.Fatalf included, so it can
	// neither outlive the test nor race t.TempDir's cleanup.
	defer func() {
		close(done)
		wg.Wait()
	}()

	for n := 1; n <= rounds; n++ {
		if err := store.Save(sessionWithActive(n)); err != nil {
			t.Fatalf("Save %d: %v", n, err)
		}
		got, err := store.Load("/ws")
		if err != nil {
			t.Fatalf("Load after Save %d: %v", n, err)
		}
		if want := sessionWithActive(n).Editor.ActiveFilePath; got.Editor.ActiveFilePath != want {
			t.Fatalf("an interpreter change wrote back an older session: active file %q after saving %q", got.Editor.ActiveFilePath, want)
		}
	}
}

func TestSetLSPInterpreterKeepsTheSavedSession(t *testing.T) {
	store := NewStore(newMockFS(), testWorkspaceBaseDir)
	if err := store.Save(sessionWithActive(7)); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if err := store.SetLSPInterpreter("/ws", pythonOverride); err != nil {
		t.Fatalf("SetLSPInterpreter: %v", err)
	}
	got, err := store.Load("/ws")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.LSP.InterpreterOverride != pythonOverride {
		t.Errorf("InterpreterOverride = %q, want %q", got.LSP.InterpreterOverride, pythonOverride)
	}
	if got.Editor.ActiveFilePath != "/ws/7.go" {
		t.Errorf("ActiveFilePath = %q, want the saved session's /ws/7.go", got.Editor.ActiveFilePath)
	}

	// An empty interpreter path clears the override and keeps the session.
	if err := store.SetLSPInterpreter("/ws", ""); err != nil {
		t.Fatalf("SetLSPInterpreter clear: %v", err)
	}
	got, err = store.Load("/ws")
	if err != nil {
		t.Fatalf("Load after clear: %v", err)
	}
	if got.LSP.InterpreterOverride != "" || got.Editor.ActiveFilePath != "/ws/7.go" {
		t.Errorf("after clear: override %q, active %q; want empty and /ws/7.go", got.LSP.InterpreterOverride, got.Editor.ActiveFilePath)
	}
}

func TestSetLSPInterpreterWithoutSavedStateStartsFresh(t *testing.T) {
	store := NewStore(newMockFS(), testWorkspaceBaseDir)
	if err := store.SetLSPInterpreter("/ws", pythonOverride); err != nil {
		t.Fatalf("SetLSPInterpreter: %v", err)
	}
	got, err := store.Load("/ws")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got == nil || got.WorkspacePath != "/ws" || got.LSP.InterpreterOverride != pythonOverride {
		t.Fatalf("got %+v, want a fresh /ws state carrying the override", got)
	}
}

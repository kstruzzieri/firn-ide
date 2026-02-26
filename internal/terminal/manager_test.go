package terminal

import (
	"sync"
	"testing"
)

func TestManagerCreateUniqueIDs(t *testing.T) {
	mgr := NewManager()
	defer func() { _ = mgr.CloseAll() }()

	id1, err := mgr.Create()
	if err != nil {
		t.Fatalf("Create() returned error: %v", err)
	}

	id2, err := mgr.Create()
	if err != nil {
		t.Fatalf("Create() returned error: %v", err)
	}

	if id1 == id2 {
		t.Fatalf("expected unique IDs, got %s and %s", id1, id2)
	}
}

func TestManagerIDUniquenessAfterDeletion(t *testing.T) {
	mgr := NewManager()
	defer func() { _ = mgr.CloseAll() }()

	id1, err := mgr.Create()
	if err != nil {
		t.Fatalf("Create() returned error: %v", err)
	}

	// Close the first session
	if err := mgr.Close(id1); err != nil {
		t.Fatalf("Close() returned error: %v", err)
	}

	// Create a new session — should NOT reuse id1
	id2, err := mgr.Create()
	if err != nil {
		t.Fatalf("Create() returned error: %v", err)
	}

	if id1 == id2 {
		t.Fatalf("ID collision after deletion: both are %s", id1)
	}
}

func TestManagerCloseNotFound(t *testing.T) {
	mgr := NewManager()

	err := mgr.Close("nonexistent")
	if err == nil {
		t.Fatal("expected error for closing nonexistent session")
	}
}

func TestManagerWriteNotFound(t *testing.T) {
	mgr := NewManager()

	err := mgr.Write("nonexistent", []byte("hello"))
	if err == nil {
		t.Fatal("expected error for writing to nonexistent session")
	}
}

func TestManagerResizeNotFound(t *testing.T) {
	mgr := NewManager()

	err := mgr.Resize("nonexistent", 24, 80)
	if err == nil {
		t.Fatal("expected error for resizing nonexistent session")
	}
}

func TestManagerConcurrentAccess(t *testing.T) {
	mgr := NewManager()
	defer func() { _ = mgr.CloseAll() }()

	const n = 5
	var wg sync.WaitGroup
	ids := make(chan string, n)

	// Create sessions concurrently
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, err := mgr.Create()
			if err != nil {
				// PTY allocation can fail under resource limits; skip
				t.Logf("Create() returned error (may be resource limit): %v", err)
				return
			}
			ids <- id
		}()
	}

	wg.Wait()
	close(ids)

	// Verify all successfully created IDs are unique
	seen := make(map[string]bool)
	for id := range ids {
		if seen[id] {
			t.Fatalf("duplicate ID: %s", id)
		}
		seen[id] = true
	}

	if len(seen) == 0 {
		t.Skip("no sessions created (PTY resource limit)")
	}
}

func TestManagerCloseAll(t *testing.T) {
	mgr := NewManager()

	_, err := mgr.Create()
	if err != nil {
		t.Fatalf("Create() returned error: %v", err)
	}
	_, err = mgr.Create()
	if err != nil {
		t.Fatalf("Create() returned error: %v", err)
	}

	if err := mgr.CloseAll(); err != nil {
		t.Fatalf("CloseAll() returned error: %v", err)
	}

	// Creating after CloseAll should still work
	id, err := mgr.Create()
	if err != nil {
		t.Fatalf("Create() after CloseAll returned error: %v", err)
	}

	_, ok := mgr.Get(id)
	if !ok {
		t.Fatal("expected to find session after CloseAll + Create")
	}
}

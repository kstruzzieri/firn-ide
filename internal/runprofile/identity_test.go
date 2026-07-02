package runprofile

import "testing"

func TestNextRunInstanceIDMonotonic(t *testing.T) {
	e := NewExecutor(nil, nil)
	e.mu.Lock()
	defer e.mu.Unlock()
	got := []string{
		e.nextRunInstanceIDLocked(),
		e.nextRunInstanceIDLocked(),
		e.nextRunInstanceIDLocked(),
	}
	want := []string{"r1", "r2", "r3"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("id %d = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestNextRunInstanceIDPerExecutor(t *testing.T) {
	// A fresh executor restarts the sequence — gives deterministic ids in tests.
	e1 := NewExecutor(nil, nil)
	e2 := NewExecutor(nil, nil)
	e1.mu.Lock()
	id1 := e1.nextRunInstanceIDLocked()
	e1.mu.Unlock()
	e2.mu.Lock()
	id2 := e2.nextRunInstanceIDLocked()
	e2.mu.Unlock()
	if id1 != "r1" || id2 != "r1" {
		t.Fatalf("per-executor sequence broken: e1=%q e2=%q", id1, id2)
	}
}

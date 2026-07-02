package watcher

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestDebouncer_SingleCall(t *testing.T) {
	d := NewDebouncer(50 * time.Millisecond)
	defer d.Stop()

	var callCount int32
	d.Debounce("key1", func() {
		atomic.AddInt32(&callCount, 1)
	})

	// Wait for debounce to complete
	time.Sleep(100 * time.Millisecond)

	if count := atomic.LoadInt32(&callCount); count != 1 {
		t.Errorf("Expected 1 call, got %d", count)
	}
}

func TestDebouncer_MultipleCalls_SameKey(t *testing.T) {
	d := NewDebouncer(50 * time.Millisecond)
	defer d.Stop()

	var callCount int32

	// Rapid calls should be debounced to a single call
	for range 10 {
		d.Debounce("key1", func() {
			atomic.AddInt32(&callCount, 1)
		})
		time.Sleep(10 * time.Millisecond)
	}

	// Wait for debounce to complete
	time.Sleep(100 * time.Millisecond)

	if count := atomic.LoadInt32(&callCount); count != 1 {
		t.Errorf("Expected 1 call (debounced), got %d", count)
	}
}

func TestDebouncer_MultipleCalls_DifferentKeys(t *testing.T) {
	d := NewDebouncer(50 * time.Millisecond)
	defer d.Stop()

	var callCount int32

	// Different keys should each fire independently
	d.Debounce("key1", func() { atomic.AddInt32(&callCount, 1) })
	d.Debounce("key2", func() { atomic.AddInt32(&callCount, 1) })
	d.Debounce("key3", func() { atomic.AddInt32(&callCount, 1) })

	// Wait for all debounces to complete
	time.Sleep(100 * time.Millisecond)

	if count := atomic.LoadInt32(&callCount); count != 3 {
		t.Errorf("Expected 3 calls (different keys), got %d", count)
	}
}

func TestDebouncer_Stop_CancelsPending(t *testing.T) {
	d := NewDebouncer(100 * time.Millisecond)

	var called bool
	d.Debounce("key1", func() {
		called = true
	})

	// Stop before debounce fires
	d.Stop()
	time.Sleep(150 * time.Millisecond)

	if called {
		t.Error("Callback should not be called after Stop()")
	}
}

func TestDebouncer_PendingCount(t *testing.T) {
	d := NewDebouncer(100 * time.Millisecond)
	defer d.Stop()

	if d.PendingCount() != 0 {
		t.Error("Expected 0 pending initially")
	}

	d.Debounce("key1", func() {})
	d.Debounce("key2", func() {})

	if d.PendingCount() != 2 {
		t.Errorf("Expected 2 pending, got %d", d.PendingCount())
	}

	// Wait for debounces to complete
	time.Sleep(150 * time.Millisecond)

	if d.PendingCount() != 0 {
		t.Errorf("Expected 0 pending after completion, got %d", d.PendingCount())
	}
}

func TestDebouncer_ResetOnRepeatedCalls(t *testing.T) {
	d := NewDebouncer(50 * time.Millisecond)
	defer d.Stop()

	var callCount int32
	var lastValue int32

	// Each call resets the timer
	for i := int32(1); i <= 5; i++ {
		val := i
		d.Debounce("key1", func() {
			atomic.AddInt32(&callCount, 1)
			atomic.StoreInt32(&lastValue, val)
		})
		time.Sleep(20 * time.Millisecond)
	}

	// Wait for final debounce
	time.Sleep(100 * time.Millisecond)

	if count := atomic.LoadInt32(&callCount); count != 1 {
		t.Errorf("Expected 1 call, got %d", count)
	}

	if val := atomic.LoadInt32(&lastValue); val != 5 {
		t.Errorf("Expected last value 5, got %d", val)
	}
}

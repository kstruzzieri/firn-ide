package watcher

import (
	"sync"
	"time"
)

// Debouncer debounces function calls by key.
// Each key maintains its own timer; rapid calls for the same key
// reset the timer, and the function is only called after the
// debounce duration elapses with no new calls.
type Debouncer struct {
	duration time.Duration
	timers   map[string]*time.Timer
	mu       sync.Mutex
}

// NewDebouncer creates a new debouncer with the given duration.
func NewDebouncer(duration time.Duration) *Debouncer {
	return &Debouncer{
		duration: duration,
		timers:   make(map[string]*time.Timer),
	}
}

// Debounce schedules fn to be called after duration has elapsed
// since the last call for the given key. If Debounce is called
// again with the same key before the duration elapses, the timer
// is reset.
func (d *Debouncer) Debounce(key string, fn func()) {
	d.mu.Lock()
	defer d.mu.Unlock()

	// Cancel existing timer for this key
	if timer, exists := d.timers[key]; exists {
		timer.Stop()
	}

	// Start new timer
	d.timers[key] = time.AfterFunc(d.duration, func() {
		d.mu.Lock()
		delete(d.timers, key)
		d.mu.Unlock()
		fn()
	})
}

// Stop cancels all pending timers.
func (d *Debouncer) Stop() {
	d.mu.Lock()
	defer d.mu.Unlock()

	for key, timer := range d.timers {
		timer.Stop()
		delete(d.timers, key)
	}
}

// PendingCount returns the number of pending debounced calls.
// Useful for testing.
func (d *Debouncer) PendingCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.timers)
}

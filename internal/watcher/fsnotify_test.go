//go:build integration

package watcher

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFSNotifyWatcher_DetectsCreate(t *testing.T) {
	tmpDir := t.TempDir()

	w, err := NewFSNotifyWatcher(WatcherConfig{DebounceMs: 50})
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}
	defer w.Stop()

	eventCh := make(chan FileEvent, 10)
	ctx := context.Background()

	if err := w.Watch(ctx, tmpDir, func(event FileEvent) {
		eventCh <- event
	}); err != nil {
		t.Fatalf("Failed to start watching: %v", err)
	}

	// Give watcher time to initialize
	time.Sleep(50 * time.Millisecond)

	// Create a file
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("hello"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Wait for event
	select {
	case event := <-eventCh:
		if event.Type != EventCreated {
			t.Errorf("Expected event type %s, got %s", EventCreated, event.Type)
		}
		if event.Path != testFile {
			t.Errorf("Expected path %q, got %q", testFile, event.Path)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("Timeout waiting for file create event")
	}
}

func TestFSNotifyWatcher_DetectsModify(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	// Create file before watching
	if err := os.WriteFile(testFile, []byte("initial"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	w, err := NewFSNotifyWatcher(WatcherConfig{DebounceMs: 50})
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}
	defer w.Stop()

	eventCh := make(chan FileEvent, 10)
	ctx := context.Background()

	if err := w.Watch(ctx, tmpDir, func(event FileEvent) {
		eventCh <- event
	}); err != nil {
		t.Fatalf("Failed to start watching: %v", err)
	}

	// Give watcher time to initialize
	time.Sleep(50 * time.Millisecond)

	// Modify the file
	if err := os.WriteFile(testFile, []byte("modified"), 0644); err != nil {
		t.Fatalf("Failed to modify test file: %v", err)
	}

	// Wait for modify event
	select {
	case event := <-eventCh:
		if event.Type != EventModified {
			t.Errorf("Expected event type %s, got %s", EventModified, event.Type)
		}
		if event.Path != testFile {
			t.Errorf("Expected path %q, got %q", testFile, event.Path)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("Timeout waiting for file modify event")
	}
}

func TestFSNotifyWatcher_DetectsDelete(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	// Create file before watching
	if err := os.WriteFile(testFile, []byte("content"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	w, err := NewFSNotifyWatcher(WatcherConfig{DebounceMs: 50})
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}
	defer w.Stop()

	eventCh := make(chan FileEvent, 10)
	ctx := context.Background()

	if err := w.Watch(ctx, tmpDir, func(event FileEvent) {
		eventCh <- event
	}); err != nil {
		t.Fatalf("Failed to start watching: %v", err)
	}

	// Give watcher time to initialize
	time.Sleep(50 * time.Millisecond)

	// Delete the file
	if err := os.Remove(testFile); err != nil {
		t.Fatalf("Failed to delete test file: %v", err)
	}

	// Wait for delete event
	select {
	case event := <-eventCh:
		if event.Type != EventDeleted {
			t.Errorf("Expected event type %s, got %s", EventDeleted, event.Type)
		}
		if event.Path != testFile {
			t.Errorf("Expected path %q, got %q", testFile, event.Path)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("Timeout waiting for file delete event")
	}
}

func TestFSNotifyWatcher_ExcludesNodeModules(t *testing.T) {
	tmpDir := t.TempDir()

	// Create node_modules directory
	nodeModules := filepath.Join(tmpDir, "node_modules")
	if err := os.MkdirAll(nodeModules, 0755); err != nil {
		t.Fatalf("Failed to create node_modules: %v", err)
	}

	w, err := NewFSNotifyWatcher(WatcherConfig{DebounceMs: 50})
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}
	defer w.Stop()

	eventCh := make(chan FileEvent, 10)
	ctx := context.Background()

	if err := w.Watch(ctx, tmpDir, func(event FileEvent) {
		eventCh <- event
	}); err != nil {
		t.Fatalf("Failed to start watching: %v", err)
	}

	// Give watcher time to initialize
	time.Sleep(50 * time.Millisecond)

	// Create file inside node_modules (should be ignored)
	ignoredFile := filepath.Join(nodeModules, "package.json")
	if err := os.WriteFile(ignoredFile, []byte("{}"), 0644); err != nil {
		t.Fatalf("Failed to create ignored file: %v", err)
	}

	// Should NOT receive event
	select {
	case event := <-eventCh:
		t.Errorf("Should not receive event for excluded path, got: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected - no event for excluded path
	}
}

func TestFSNotifyWatcher_ExcludesSwapFiles(t *testing.T) {
	tmpDir := t.TempDir()

	w, err := NewFSNotifyWatcher(WatcherConfig{DebounceMs: 50})
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}
	defer w.Stop()

	eventCh := make(chan FileEvent, 10)
	ctx := context.Background()

	if err := w.Watch(ctx, tmpDir, func(event FileEvent) {
		eventCh <- event
	}); err != nil {
		t.Fatalf("Failed to start watching: %v", err)
	}

	// Give watcher time to initialize
	time.Sleep(50 * time.Millisecond)

	// Create a .swp file (should be ignored)
	swapFile := filepath.Join(tmpDir, ".test.txt.swp")
	if err := os.WriteFile(swapFile, []byte("swap"), 0644); err != nil {
		t.Fatalf("Failed to create swap file: %v", err)
	}

	// Should NOT receive event for swap file
	select {
	case event := <-eventCh:
		t.Errorf("Should not receive event for swap file, got: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected - no event for swap file
	}
}

func TestFSNotifyWatcher_WatchesNewSubdirectory(t *testing.T) {
	tmpDir := t.TempDir()

	w, err := NewFSNotifyWatcher(WatcherConfig{DebounceMs: 50})
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}
	defer w.Stop()

	eventCh := make(chan FileEvent, 10)
	ctx := context.Background()

	if err := w.Watch(ctx, tmpDir, func(event FileEvent) {
		eventCh <- event
	}); err != nil {
		t.Fatalf("Failed to start watching: %v", err)
	}

	// Give watcher time to initialize
	time.Sleep(50 * time.Millisecond)

	// Create a new subdirectory
	subDir := filepath.Join(tmpDir, "subdir")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatalf("Failed to create subdir: %v", err)
	}

	// Wait for directory create event
	select {
	case event := <-eventCh:
		if event.Type != EventCreated {
			t.Errorf("Expected event type %s, got %s", EventCreated, event.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("Timeout waiting for directory create event")
	}

	// Give watcher time to add the new directory
	time.Sleep(100 * time.Millisecond)

	// Create a file in the new subdirectory
	testFile := filepath.Join(subDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("hello"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Should receive event for file in new subdirectory
	select {
	case event := <-eventCh:
		if event.Path != testFile {
			t.Errorf("Expected path %q, got %q", testFile, event.Path)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("Timeout waiting for file create event in new subdirectory")
	}
}

func TestFSNotifyWatcher_IsWatching(t *testing.T) {
	tmpDir := t.TempDir()

	w, err := NewFSNotifyWatcher(WatcherConfig{DebounceMs: 50})
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}
	defer w.Stop()

	if w.IsWatching() {
		t.Error("Should not be watching initially")
	}

	ctx := context.Background()
	if err := w.Watch(ctx, tmpDir, func(_ FileEvent) {}); err != nil {
		t.Fatalf("Failed to start watching: %v", err)
	}

	if !w.IsWatching() {
		t.Error("Should be watching after Watch()")
	}

	if w.WatchedPath() != tmpDir {
		t.Errorf("Expected watched path %q, got %q", tmpDir, w.WatchedPath())
	}
}

func TestFSNotifyWatcher_DebounceRapidEvents(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	// Create file before watching
	if err := os.WriteFile(testFile, []byte("initial"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	w, err := NewFSNotifyWatcher(WatcherConfig{DebounceMs: 100})
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}
	defer w.Stop()

	eventCount := 0
	eventCh := make(chan FileEvent, 100)
	ctx := context.Background()

	if err := w.Watch(ctx, tmpDir, func(event FileEvent) {
		eventCount++
		eventCh <- event
	}); err != nil {
		t.Fatalf("Failed to start watching: %v", err)
	}

	// Give watcher time to initialize
	time.Sleep(50 * time.Millisecond)

	// Rapid modifications (should be debounced)
	for range 5 {
		if err := os.WriteFile(testFile, []byte("rapid write"), 0644); err != nil {
			t.Fatalf("Failed to write file: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Wait for debounce to settle
	time.Sleep(200 * time.Millisecond)

	// Should receive only one debounced event
	if eventCount > 2 {
		t.Errorf("Expected at most 2 events (debounced), got %d", eventCount)
	}
}

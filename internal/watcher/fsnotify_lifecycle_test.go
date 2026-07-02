package watcher

import (
	"context"
	"testing"
)

func TestFSNotifyWatcher_WatchAfterStop(t *testing.T) {
	tmpDir := t.TempDir()

	w, err := NewFSNotifyWatcher(WatcherConfig{DebounceMs: 10})
	if err != nil {
		t.Fatalf("NewFSNotifyWatcher: %v", err)
	}
	defer func() { _ = w.Stop() }()

	if err := w.Watch(context.Background(), tmpDir, func(FileEvent) {}); err != nil {
		t.Fatalf("first Watch: %v", err)
	}
	if err := w.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if err := w.Watch(context.Background(), tmpDir, func(FileEvent) {}); err != nil {
		t.Fatalf("second Watch: %v", err)
	}
}

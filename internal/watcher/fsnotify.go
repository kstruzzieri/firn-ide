package watcher

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// FSNotifyWatcher implements Watcher using fsnotify for OS-native file watching.
type FSNotifyWatcher struct {
	watcher     *fsnotify.Watcher
	config      WatcherConfig
	watchedPath string
	mu          sync.RWMutex
	stopCh      chan struct{}
	debouncer   *Debouncer
}

// NewFSNotifyWatcher creates a new file watcher with the given config.
func NewFSNotifyWatcher(config WatcherConfig) (*FSNotifyWatcher, error) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	if config.DebounceMs == 0 {
		config.DebounceMs = 100
	}

	if config.ExcludePatterns == nil {
		config.ExcludePatterns = DefaultExcludePatterns()
	}

	return &FSNotifyWatcher{
		watcher: fw,
		config:  config,
	}, nil
}

// Verify FSNotifyWatcher implements Watcher interface.
var _ Watcher = (*FSNotifyWatcher)(nil)

func (w *FSNotifyWatcher) Watch(ctx context.Context, path string, callback func(FileEvent)) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Stop existing watch if any
	if w.stopCh != nil {
		close(w.stopCh)
	}

	// Clean up old debouncer
	if w.debouncer != nil {
		w.debouncer.Stop()
	}

	w.watchedPath = path
	w.stopCh = make(chan struct{})
	w.debouncer = NewDebouncer(time.Duration(w.config.DebounceMs) * time.Millisecond)

	// Add all directories recursively
	if err := w.addRecursive(path); err != nil {
		return err
	}

	// Start event processing goroutine
	go w.processEvents(ctx, callback)

	return nil
}

func (w *FSNotifyWatcher) addRecursive(root string) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			// Skip inaccessible paths
			return nil
		}

		if d.IsDir() {
			if w.shouldExclude(d.Name()) {
				return filepath.SkipDir
			}
			return w.watcher.Add(path)
		}
		return nil
	})
}

func (w *FSNotifyWatcher) shouldExclude(name string) bool {
	for _, pattern := range w.config.ExcludePatterns {
		if strings.HasPrefix(pattern, "*") {
			// Wildcard suffix match (e.g., "*.swp")
			suffix := pattern[1:]
			if strings.HasSuffix(name, suffix) {
				return true
			}
		} else if name == pattern {
			return true
		}
	}
	return false
}

func (w *FSNotifyWatcher) processEvents(ctx context.Context, callback func(FileEvent)) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-w.stopCh:
			return
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			w.handleEvent(event, callback)
		case _, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			// Errors are logged but watching continues
		}
	}
}

func (w *FSNotifyWatcher) handleEvent(event fsnotify.Event, callback func(FileEvent)) {
	// Skip excluded files
	baseName := filepath.Base(event.Name)
	if w.shouldExclude(baseName) {
		return
	}

	fe := w.convertEvent(event)
	if fe == nil {
		return
	}

	// Debounce by path
	eventCopy := *fe
	w.debouncer.Debounce(event.Name, func() {
		callback(eventCopy)
	})

	// If a new directory was created, add it to the watcher
	if event.Has(fsnotify.Create) {
		info, err := os.Stat(event.Name)
		if err == nil && info.IsDir() && !w.shouldExclude(info.Name()) {
			_ = w.watcher.Add(event.Name)
		}
	}
}

func (w *FSNotifyWatcher) convertEvent(event fsnotify.Event) *FileEvent {
	// Check if path exists to determine if it's a directory
	// For delete events, the path won't exist, so default to file
	info, statErr := os.Stat(event.Name)
	isDir := statErr == nil && info.IsDir()

	fe := &FileEvent{
		Path:  event.Name,
		IsDir: isDir,
		Time:  time.Now(),
	}

	switch {
	case event.Has(fsnotify.Create):
		fe.Type = EventCreated
	case event.Has(fsnotify.Write):
		fe.Type = EventModified
	case event.Has(fsnotify.Remove):
		fe.Type = EventDeleted
	case event.Has(fsnotify.Rename):
		// fsnotify reports renames as rename on old path + create on new path
		// We emit deleted for the rename event (old path gone)
		fe.Type = EventRenamed
	case event.Has(fsnotify.Chmod):
		// Ignore chmod-only events
		return nil
	default:
		return nil
	}

	return fe
}

func (w *FSNotifyWatcher) Stop() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.stopCh != nil {
		close(w.stopCh)
		w.stopCh = nil
	}

	if w.debouncer != nil {
		w.debouncer.Stop()
		w.debouncer = nil
	}

	w.watchedPath = ""
	return w.watcher.Close()
}

func (w *FSNotifyWatcher) IsWatching() bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.watchedPath != ""
}

func (w *FSNotifyWatcher) WatchedPath() string {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.watchedPath
}

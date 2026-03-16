package runprofile

import (
	"firn/internal/filesystem"
	"fmt"
	"path/filepath"
	"sync"
)

// Manager orchestrates the Store and Detector, providing merged profile views
// and reactive re-detection when config files change.
type Manager struct {
	store    *Store
	detector *Detector
	detected []RunProfile
	mu       sync.RWMutex
	fs       filesystem.FileSystem
}

// NewManager creates a Manager for the given workspace root.
func NewManager(fsys filesystem.FileSystem, workspaceRoot string) *Manager {
	return &Manager{
		store:    NewStore(fsys, workspaceRoot),
		detector: NewDetector(fsys, workspaceRoot),
		detected: []RunProfile{},
		fs:       fsys,
	}
}

// Load initializes the manager by loading saved profiles and running detection.
func (m *Manager) Load() error {
	if _, err := m.store.Load(); err != nil {
		return err
	}

	m.mu.Lock()
	m.detected = m.detector.DetectAll()
	m.mu.Unlock()

	return nil
}

// GetAllProfiles returns merged profiles: saved profiles first, then detected
// profiles that aren't shadowed by saved ones.
func (m *Manager) GetAllProfiles() []RunProfile {
	saved := m.store.GetAll()

	m.mu.RLock()
	detected := make([]RunProfile, len(m.detected))
	copy(detected, m.detected)
	m.mu.RUnlock()

	// Build a set of saved profile IDs for dedup. Since generateID() produces
	// deterministic IDs from source+name, and Pin() preserves the original ID,
	// ID-based matching is sufficient to prevent duplicates after pinning.
	savedIDs := map[string]bool{}
	for _, p := range saved {
		savedIDs[p.ID] = true
	}

	var merged []RunProfile
	merged = append(merged, saved...)

	for _, d := range detected {
		if savedIDs[d.ID] {
			continue
		}
		merged = append(merged, d)
	}

	return merged
}

// SaveProfile validates and saves a profile.
func (m *Manager) SaveProfile(p RunProfile) (ValidationResult, error) {
	result := Validate(p)
	if !result.Valid {
		return result, nil
	}

	p.Source = ProfileSourceUser
	if err := m.store.Save(p); err != nil {
		return result, err
	}

	return result, nil
}

// DeleteProfile removes a saved profile by ID.
func (m *Manager) DeleteProfile(id string) error {
	return m.store.Delete(id)
}

// PinProfile converts a detected profile to a saved profile.
func (m *Manager) PinProfile(id string) error {
	m.mu.RLock()
	var found *RunProfile
	for i := range m.detected {
		if m.detected[i].ID == id {
			cp := m.detected[i]
			found = &cp
			break
		}
	}
	m.mu.RUnlock()

	if found == nil {
		return fmt.Errorf("detected profile not found: %s", id)
	}

	return m.store.Pin(*found)
}

// UnpinProfile removes a saved (pinned) profile, allowing the detected
// version with the same deterministic ID to resurface.
func (m *Manager) UnpinProfile(id string) error {
	if err := m.store.Delete(id); err != nil {
		return fmt.Errorf("unpin profile %s: %w", id, err)
	}
	return nil
}

// ReDetect re-runs detection and returns the new detected profiles.
func (m *Manager) ReDetect() []RunProfile {
	detected := m.detector.DetectAll()

	m.mu.Lock()
	m.detected = detected
	m.mu.Unlock()

	return detected
}

// HandleFileChange checks if a changed file is a config file and re-detects if so.
// Returns true if re-detection was triggered.
func (m *Manager) HandleFileChange(path string) bool {
	filename := filepath.Base(path)
	if !IsConfigFile(filename) {
		return false
	}
	m.ReDetect()
	return true
}

// SetWorkspaceRoot reinitializes the manager for a new workspace.
// Note: The file watcher should be stopped and restarted by the caller when
// changing workspaces. In-flight watcher events from the old workspace are
// benign — HandleFileChange will re-detect against the new workspace's files.
func (m *Manager) SetWorkspaceRoot(root string) {
	m.mu.Lock()
	m.store = NewStore(m.fs, root)
	m.detector = NewDetector(m.fs, root)
	m.detected = []RunProfile{}
	m.mu.Unlock()
}

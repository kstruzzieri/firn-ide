package runprofile

import (
	"testing"
)

func TestManagerUnpinProfile(t *testing.T) {
	mockFS := newManagerTestFS(map[string][]byte{})
	m := NewManager(mockFS, "/workspace")

	// Simulate a detected profile
	detected := RunProfile{
		ID:           "detected-pkg-dev",
		Name:         "dev",
		Type:         ProfileTypeSingle,
		Source:       ProfileSourceDetected,
		Command:      "npm run dev",
		DetectedFrom: "package.json",
	}
	m.mu.Lock()
	m.detected = []RunProfile{detected}
	m.mu.Unlock()

	// Pin the detected profile
	if err := m.PinProfile("detected-pkg-dev"); err != nil {
		t.Fatalf("PinProfile failed: %v", err)
	}

	// Verify it's saved
	profiles := m.GetAllProfiles()
	var found bool
	for _, p := range profiles {
		if p.ID == "detected-pkg-dev" && p.Source == ProfileSourceUser {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("pinned profile not found as user source")
	}

	// Unpin it
	if err := m.UnpinProfile("detected-pkg-dev"); err != nil {
		t.Fatalf("UnpinProfile failed: %v", err)
	}

	// Verify it's back to detected source
	profiles = m.GetAllProfiles()
	for _, p := range profiles {
		if p.ID == "detected-pkg-dev" {
			if p.Source != ProfileSourceDetected {
				t.Errorf("expected source 'detected', got %q", p.Source)
			}
			return
		}
	}
	t.Error("unpinned profile not found in profile list")
}

func TestManagerUnpinNonexistentProfile(t *testing.T) {
	mockFS := newManagerTestFS(map[string][]byte{})
	m := NewManager(mockFS, "/workspace")

	err := m.UnpinProfile("nonexistent")
	if err == nil {
		t.Fatal("expected error for unpinning nonexistent profile")
	}
}

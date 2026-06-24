package runprofile

import (
	"encoding/json"
	"errors"
	"firn/internal/filesystem"
	"fmt"
	"io/fs"
	"path/filepath"
	"sync"
)

const profilesFileName = ".firn/run-profiles.json"

// profilesFileVersion is the current on-disk schema version. v2 adds workspace
// ownership fields and workspace-scoped detected IDs. v1 files are migrated on
// load (see migrateV1Profiles). v3 adds profileState (adoption + run recency),
// keyed by profile ID.
const profilesFileVersion = 3

// Store manages persistent storage of run profiles in .firn/run-profiles.json.
type Store struct {
	fs            filesystem.FileSystem
	workspaceRoot string
	mu            sync.RWMutex
	profiles      []RunProfile
	state         map[string]ProfileUIState
	scope         MigrationScope
	// Warnings collects non-fatal load issues (e.g. a v1->v2 migration that
	// could not be written back to a read-only directory). The migrated data is
	// still usable in memory; callers surface these rather than failing the load.
	Warnings []string
}

// SetScope assigns the owning-workspace identity used when migrating a legacy
// v1 file loaded by this store. Call before Load.
func (s *Store) SetScope(scope MigrationScope) {
	s.scope = scope
}

// NewStore creates a Store for the given workspace root directory.
func NewStore(fsys filesystem.FileSystem, workspaceRoot string) *Store {
	return &Store{
		fs:            fsys,
		workspaceRoot: workspaceRoot,
		profiles:      []RunProfile{},
		state:         map[string]ProfileUIState{},
	}
}

// Load reads profiles from disk. Returns empty list (not error) if file doesn't exist.
func (s *Store) Load() ([]RunProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Warnings = nil

	path := filepath.Join(s.workspaceRoot, profilesFileName)
	data, err := s.fs.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			s.profiles = []RunProfile{}
			s.state = map[string]ProfileUIState{}
			return s.profiles, nil
		}
		return nil, fmt.Errorf("reading profiles file: %w", err)
	}

	var pf ProfilesFile
	if err := json.Unmarshal(data, &pf); err != nil {
		return nil, fmt.Errorf("parsing profiles file: %w", err)
	}

	s.state = map[string]ProfileUIState{}
	switch pf.Version {
	case 1:
		migrated, changed := migrateV1Profiles(orEmptyProfiles(pf.Profiles), s.scope)
		s.profiles = migrated
		if changed {
			// Persist is best-effort: a successful migration must not be lost
			// just because the directory is read-only. Keep the migrated data
			// in memory and record a warning instead of failing the load.
			if err := s.persist(); err != nil {
				s.Warnings = append(s.Warnings, fmt.Sprintf("could not write migrated profiles to %s: %v", path, err))
			}
		}
	case 2:
		// v2 → v3: additive upgrade; profileState stays empty.
		s.profiles = orEmptyProfiles(pf.Profiles)
	case profilesFileVersion:
		s.profiles = orEmptyProfiles(pf.Profiles)
		if pf.ProfileState != nil {
			// Store takes ownership of the unmarshalled map (pf is function-local).
			s.state = pf.ProfileState
		}
	default:
		return nil, fmt.Errorf("unsupported profiles file version: %d (expected 1-%d)", pf.Version, profilesFileVersion)
	}
	return s.copyProfiles(), nil
}

// Save upserts a profile by ID and persists to disk.
func (s *Store) Save(profile RunProfile) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	found := false
	for i, p := range s.profiles {
		if p.ID == profile.ID {
			s.profiles[i] = profile
			found = true
			break
		}
	}
	if !found {
		s.profiles = append(s.profiles, profile)
	}

	return s.persist()
}

// Delete removes a profile by ID and persists to disk.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	idx := -1
	for i, p := range s.profiles {
		if p.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("profile not found: %s", id)
	}

	s.profiles = append(s.profiles[:idx], s.profiles[idx+1:]...)
	return s.persist()
}

// GetAll returns a copy of all stored profiles.
func (s *Store) GetAll() []RunProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.copyProfiles()
}

// Contains reports whether a saved profile with the given ID exists, without
// deep-copying the profile list (unlike GetAll).
func (s *Store) Contains(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i := range s.profiles {
		if s.profiles[i].ID == id {
			return true
		}
	}
	return false
}

// Pin converts a detected profile to a user profile and persists it.
func (s *Store) Pin(profile RunProfile) error {
	profile.Source = ProfileSourceUser
	profile.DetectedFrom = ""
	return s.Save(profile)
}

// SetAdopted sets the per-workspace adoption flag for a profile ID and persists.
// Clearing adoption on an entry with no recency drops the entry to keep the map tidy.
func (s *Store) SetAdopted(id string, adopted bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := copyProfileState(s.state)
	st := next[id]
	st.Adopted = adopted
	if !st.Adopted && st.LastRunAt == 0 {
		delete(next, id)
	} else {
		next[id] = st
	}
	return s.persistState(next)
}

// RecordRun stamps the last-run timestamp (epoch millis) for a profile ID and persists.
func (s *Store) RecordRun(id string, ts int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := copyProfileState(s.state)
	st := next[id]
	st.LastRunAt = ts
	next[id] = st
	return s.persistState(next)
}

// GetState returns a copy of the per-profile UI state map.
func (s *Store) GetState() map[string]ProfileUIState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]ProfileUIState, len(s.state))
	for k, v := range s.state {
		out[k] = v
	}
	return out
}

// persist writes the current profiles to disk.
// The write is atomic: data is written to a sibling temp file and then renamed
// into place, so a torn write can never corrupt the existing file. This matters
// because run recency now rewrites this file on every run (frequent writes),
// and a crash mid-write must not destroy the user's saved profiles.
func (s *Store) persist() error {
	return s.persistState(s.state)
}

func (s *Store) persistState(state map[string]ProfileUIState) error {
	dir := filepath.Join(s.workspaceRoot, ".firn")
	if err := s.fs.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating .firn directory: %w", err)
	}

	profiles := s.profiles
	if profiles == nil {
		profiles = []RunProfile{}
	}
	pf := ProfilesFile{
		Version:      profilesFileVersion,
		Profiles:     profiles,
		ProfileState: state,
	}

	data, err := json.MarshalIndent(pf, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling profiles: %w", err)
	}

	finalPath := filepath.Join(s.workspaceRoot, profilesFileName)
	tmpPath := finalPath + ".tmp"
	if err := s.fs.WriteFile(tmpPath, data, fs.FileMode(0o644)); err != nil {
		return fmt.Errorf("writing temp profiles file: %w", err)
	}
	if err := s.fs.Rename(tmpPath, finalPath); err != nil {
		return fmt.Errorf("renaming profiles file into place: %w", err)
	}
	s.state = state
	return nil
}

// orEmptyProfiles returns a non-nil slice for a possibly-nil profile list.
func orEmptyProfiles(p []RunProfile) []RunProfile {
	if p == nil {
		return []RunProfile{}
	}
	return p
}

func copyProfileState(in map[string]ProfileUIState) map[string]ProfileUIState {
	out := make(map[string]ProfileUIState, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func (s *Store) copyProfiles() []RunProfile {
	out := make([]RunProfile, len(s.profiles))
	for i, p := range s.profiles {
		out[i] = deepCopyProfile(p)
	}
	return out
}

// deepCopyProfile returns a fully independent copy of a RunProfile,
// cloning all reference-type fields (maps, slices).
func deepCopyProfile(p RunProfile) RunProfile {
	if p.Env != nil {
		env := make(map[string]string, len(p.Env))
		for k, v := range p.Env {
			env[k] = v
		}
		p.Env = env
	}
	if p.EnvVariants != nil {
		variants := make(EnvVariants, len(p.EnvVariants))
		copy(variants, p.EnvVariants)
		p.EnvVariants = variants
	}
	if p.Tags != nil {
		tags := make([]ProfileTag, len(p.Tags))
		copy(tags, p.Tags)
		p.Tags = tags
	}
	if p.Steps != nil {
		steps := make([]string, len(p.Steps))
		copy(steps, p.Steps)
		p.Steps = steps
	}
	return p
}

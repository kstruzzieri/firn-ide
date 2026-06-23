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
// load (see migrateV1Profiles).
const profilesFileVersion = 2

// Store manages persistent storage of run profiles in .firn/run-profiles.json.
type Store struct {
	fs            filesystem.FileSystem
	workspaceRoot string
	mu            sync.RWMutex
	profiles      []RunProfile
	scope         MigrationScope
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
	}
}

// Load reads profiles from disk. Returns empty list (not error) if file doesn't exist.
func (s *Store) Load() ([]RunProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := filepath.Join(s.workspaceRoot, profilesFileName)
	data, err := s.fs.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			s.profiles = []RunProfile{}
			return s.profiles, nil
		}
		return nil, fmt.Errorf("reading profiles file: %w", err)
	}

	var pf ProfilesFile
	if err := json.Unmarshal(data, &pf); err != nil {
		return nil, fmt.Errorf("parsing profiles file: %w", err)
	}

	switch pf.Version {
	case 1:
		migrated, changed := migrateV1Profiles(orEmptyProfiles(pf.Profiles), s.scope)
		s.profiles = migrated
		if changed {
			if err := s.persist(); err != nil {
				return nil, fmt.Errorf("persisting migrated profiles: %w", err)
			}
		}
	case profilesFileVersion:
		s.profiles = orEmptyProfiles(pf.Profiles)
	default:
		return nil, fmt.Errorf("unsupported profiles file version: %d (expected 1 or %d)", pf.Version, profilesFileVersion)
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

// Pin converts a detected profile to a user profile and persists it.
func (s *Store) Pin(profile RunProfile) error {
	profile.Source = ProfileSourceUser
	profile.DetectedFrom = ""
	return s.Save(profile)
}

// persist writes the current profiles to disk.
// Note: This is not atomic (no write-to-temp + rename) because the
// filesystem.FileSystem interface does not expose Rename. If atomic writes
// become necessary, add Rename to the interface. The risk of corruption is
// low since the file is small and written infrequently.
func (s *Store) persist() error {
	dir := filepath.Join(s.workspaceRoot, ".firn")
	if err := s.fs.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating .firn directory: %w", err)
	}

	profiles := s.profiles
	if profiles == nil {
		profiles = []RunProfile{}
	}
	pf := ProfilesFile{
		Version:  profilesFileVersion,
		Profiles: profiles,
	}

	data, err := json.MarshalIndent(pf, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling profiles: %w", err)
	}

	path := filepath.Join(s.workspaceRoot, profilesFileName)
	if err := s.fs.WriteFile(path, data, fs.FileMode(0o644)); err != nil {
		return fmt.Errorf("writing profiles file: %w", err)
	}

	return nil
}

// orEmptyProfiles returns a non-nil slice for a possibly-nil profile list.
func orEmptyProfiles(p []RunProfile) []RunProfile {
	if p == nil {
		return []RunProfile{}
	}
	return p
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

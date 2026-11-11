package runprofile

import (
	"bytes"
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
// load (see migrateV1Profiles). v3 adds profileState; as of the recency-sidecar
// split, profileState carries adoption only — run recency lives in the sidecar.
const profilesFileVersion = 3

// recencyFileName / recencyFileVersion identify the run-recency sidecar. Run
// recency is volatile and written once per run, so it is kept out of
// run-profiles.json: stamping a run must not rewrite profile definitions.
const recencyFileName = ".firn/run-recency.json"
const recencyFileVersion = 1

// Store manages persistent storage of run profiles. Durable config (profile
// definitions + adoption) lives in run-profiles.json; volatile run recency
// lives in the run-recency.json sidecar. In memory the two are merged into a
// single per-profile ProfileUIState map.
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
	// loadErr latches the last Load failure other than a missing file (#359).
	// A failed Load leaves the in-memory list empty, so writing it back would
	// erase every profile the unreadable file still holds; writeProfilesLocked
	// refuses while this is set. The next successful Load clears it.
	loadErr error
	// diskProfiles is run-profiles.json as this store last read or wrote it (nil
	// when absent). Every durable write re-reads the file and compares it with
	// this before replacing it, so a rewrite made outside Firn after Load (a
	// branch checkout, a merge, a hand edit) is never overwritten from memory
	// (#397).
	diskProfiles []byte
	// changedErr latches the refusal once a write finds the file differs from
	// diskProfiles. In-memory profiles are stale from then on, so every durable
	// write is refused until the next Load reads the file again and clears it.
	changedErr error
	// recencyErr latches a run-recency sidecar that exists but could not be read
	// or parsed (#442). Its recency never reached memory, so writing the sidecar
	// from memory would drop it; writeRecencyLocked refuses while this is set.
	// The next Load that reads the sidecar clears it.
	recencyErr error
}

// ErrProfilesFileChanged marks a durable write refused because
// run-profiles.json changed on disk after this store loaded it. The refusal
// latches, so the caller's snapshot gains a notice it must show (see
// ProjectRunProfileManager.Snapshot).
var ErrProfilesFileChanged = errors.New("changed on disk")

// errNewerProfilesVersion marks a profiles file written by a newer Firn, whose
// remedy differs from a corrupt file's: it is live data, not damage.
var errNewerProfilesVersion = errors.New("unsupported profiles file version")

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
	s.loadErr = nil
	s.changedErr = nil

	path := filepath.Join(s.workspaceRoot, profilesFileName)
	data, err := s.fs.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, s.latchLoadErr(fmt.Errorf("reading profiles file %s: %w", path, err))
	}
	if err != nil {
		data = nil
	}
	// The baseline is what was read, before any migration below rewrites it.
	s.diskProfiles = data
	// A missing file, or one with zero bytes (a crash after the non-fsynced
	// rename, a touch), holds no profiles to preserve: treat both as absent, as
	// the workspace store does (#332). A recency sidecar may still exist on its
	// own (a run was recorded for a detected profile that was never saved).
	if err != nil || len(bytes.TrimSpace(data)) == 0 {
		s.profiles = []RunProfile{}
		s.state = map[string]ProfileUIState{}
		s.loadRecencyLocked()
		return s.profiles, nil
	}

	// Read the version before the full document: a newer Firn's schema must be
	// reported as newer, not as corrupt, or the remedy would say to remove it.
	var envelope struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, s.latchLoadErr(fmt.Errorf("parsing profiles file %s: %w", path, err))
	}
	if envelope.Version > profilesFileVersion {
		return nil, s.latchLoadErr(fmt.Errorf("%w in %s: %d (expected 1-%d; written by a newer Firn)", errNewerProfilesVersion, path, envelope.Version, profilesFileVersion))
	}

	var pf ProfilesFile
	if err := json.Unmarshal(data, &pf); err != nil {
		return nil, s.latchLoadErr(fmt.Errorf("parsing profiles file %s: %w", path, err))
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
			// A refusal because the file changed since the read above is latched
			// and reported from the latch (ChangedOnDisk), not repeated here.
			if err := s.persist(); err != nil && !errors.Is(err, ErrProfilesFileChanged) {
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
		return nil, s.latchLoadErr(fmt.Errorf("unsupported profiles file version in %s: %d (expected 1-%d)", path, pf.Version, profilesFileVersion))
	}

	// Merge run recency from the sidecar (authoritative over any legacy recency
	// embedded in an older profiles file).
	s.loadRecencyLocked()

	return s.copyProfiles(), nil
}

// latchLoadErr records a Load failure so no durable write can replace the file
// this store could not read. Caller holds s.mu.
func (s *Store) latchLoadErr(err error) error {
	s.loadErr = err
	// The sidecar stays readable and writable while latched. Load it so
	// RecordRun merges into it instead of replacing it with one entry. With an
	// empty state the legacy-migration branch cannot write anything.
	s.state = map[string]ProfileUIState{}
	s.loadRecencyLocked()
	return err
}

// loadRemedy is the single source of the recovery wording shared by the write
// refusal and the load warning: a sentence-case clause naming the step that
// fixes the file and the Reload that makes Firn read it again.
func loadRemedy(err error) string {
	switch {
	case errors.Is(err, errNewerProfilesVersion):
		return "Remove the file and choose Reload in the Run Profiles panel, or open the workspace with the newer Firn that wrote it"
	case errors.Is(err, fs.ErrPermission):
		return "Restore read access to the file and its .firn directory, then choose Reload in the Run Profiles panel"
	}
	return "Fix or remove the file, then choose Reload in the Run Profiles panel"
}

// loadRefusal explains why writeProfilesLocked will not write: the file, the
// reason (the wrapped load error names both) and the remedy. Run profiles are
// reloaded in place by App.ReloadRunProfiles, which the Run Profiles panel's
// Reload action calls while the last load carried warnings, and on folder open
// by LoadRunProfiles, so that is the recovery step the message names.
func loadRefusal(err error) error {
	return fmt.Errorf("run profile changes are not saved, to preserve a profiles file that could not be loaded (%w); %s", err, loadRemedy(err))
}

// recencyRefusal is the single source of the wording shared by the sidecar
// write refusal and the load warning the panel shows: what is not happening,
// why (the wrapped error names the file), and the remedy.
func recencyRefusal(err error) error {
	return fmt.Errorf("last-run times are not being recorded, to preserve a run-recency sidecar that could not be loaded (%w); %s", err, loadRemedy(err))
}

// latchRecencyErr records a sidecar read or parse failure so no write replaces
// the sidecar this store could not read, and surfaces it as a load warning.
// Caller holds s.mu.
func (s *Store) latchRecencyErr(err error) {
	s.recencyErr = err
	s.Warnings = append(s.Warnings, recencyRefusal(err).Error())
}

// loadRecencyLocked merges run recency from the sidecar into s.state. If the
// sidecar is absent but the profiles file carried legacy recency (pre-split
// v3), it migrates that recency into the sidecar once so it survives the
// profiles file dropping recency on its next write. A read/parse failure
// degrades to a warning, never a failed load, and latches sidecar writes off
// (#442). Caller holds s.mu.
func (s *Store) loadRecencyLocked() {
	s.recencyErr = nil
	path := filepath.Join(s.workspaceRoot, recencyFileName)
	data, err := s.fs.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		s.latchRecencyErr(fmt.Errorf("reading recency sidecar %s: %w", path, err))
		return
	}
	// A missing sidecar, or one with zero bytes, holds no recency to preserve:
	// treat both as absent, as Load does for the profiles file (#332).
	if err != nil || len(bytes.TrimSpace(data)) == 0 {
		if hasRecency(s.state) {
			if werr := s.writeRecencyLocked(s.state); werr != nil {
				s.Warnings = append(s.Warnings, fmt.Sprintf("could not migrate recency to %s: %v", path, werr))
			}
		}
		return
	}

	var rf RecencyFile
	if err := json.Unmarshal(data, &rf); err != nil {
		s.latchRecencyErr(fmt.Errorf("parsing recency sidecar %s: %w", path, err))
		return
	}

	// The sidecar is the sole authority for recency. Drop any legacy recency a
	// pre-split profiles file embedded before applying it, so a timestamp the
	// sidecar no longer lists (e.g. pruned) does not linger.
	for id, st := range s.state {
		if st.LastRunAt == 0 {
			continue
		}
		st.LastRunAt = 0
		if st.Adopted {
			s.state[id] = st
		} else {
			delete(s.state, id) // was recency-only; nothing left to keep
		}
	}
	for id, ts := range rf.Recency {
		st := s.state[id]
		st.LastRunAt = ts
		s.state[id] = st
	}
}

// Save upserts a profile by ID and persists to disk.
func (s *Store) Save(profile RunProfile) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Apply to a fresh slice so a persist failure can restore the prior in-memory
	// state — otherwise memory and disk diverge (and the emit-on-change path would
	// surface a profile that was never written).
	prev := s.profiles
	updated := make([]RunProfile, len(s.profiles))
	copy(updated, s.profiles)

	found := false
	for i, p := range updated {
		if p.ID == profile.ID {
			updated[i] = profile
			found = true
			break
		}
	}
	if !found {
		updated = append(updated, profile)
	}
	s.profiles = updated

	if err := s.persist(); err != nil {
		s.profiles = prev
		return err
	}
	return nil
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

	// Remove into a fresh slice so a persist failure can restore the original
	// (the prior in-place splice mutated the backing array, corrupting any rollback).
	prev := s.profiles
	updated := make([]RunProfile, 0, len(s.profiles)-1)
	updated = append(updated, s.profiles[:idx]...)
	updated = append(updated, s.profiles[idx+1:]...)
	s.profiles = updated

	if err := s.persist(); err != nil {
		s.profiles = prev
		return err
	}
	return nil
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
	return s.persistProfiles(next)
}

// RecordRun stamps the last-run timestamp (epoch millis) for a profile ID and
// persists it to the recency sidecar. The write is synchronous and tiny — it
// records one timestamp without rewriting profile definitions — and the
// in-memory value is rolled back if the write fails, so the caller (and its
// logs) observe the error.
func (s *Store) RecordRun(id string, ts int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := copyProfileState(s.state)
	st := next[id]
	st.LastRunAt = max(st.LastRunAt, ts)
	next[id] = st
	return s.persistRecency(next)
}

// PruneState drops profileState entries whose ID is not in validIDs, except
// adopted entries — those survive so a workspace's working set is not lost when
// a detected profile temporarily disappears (e.g. a git branch switch). Pruned
// entries are recency-only (adopted entries are kept), so only the recency
// sidecar is rewritten, and only when something was actually removed.
func (s *Store) PruneState(validIDs map[string]bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loadErr != nil || s.changedErr != nil || s.recencyErr != nil {
		// The saved IDs and adoption flags are unknown while the profiles file is
		// latched, so validIDs would wrongly drop every saved profile's recency.
		// The same holds once the file changed under a v1 migration during Load:
		// validIDs describe the file that was read, not the one on disk now.
		// While the sidecar is latched there is nothing safe to rewrite.
		return nil
	}
	next := copyProfileState(s.state)
	changed := false
	for id, st := range next {
		if validIDs[id] || st.Adopted {
			continue
		}
		delete(next, id)
		changed = true
	}
	if !changed {
		return nil
	}
	return s.persistRecency(next)
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

// persist writes the profiles file (definitions + adoption) for the current
// in-memory state.
func (s *Store) persist() error {
	return s.persistProfiles(s.state)
}

// persistProfiles writes run-profiles.json (definitions + adoption) for the
// given state and, on success, commits the state to memory. Used by the durable
// config writers (Save/Delete/Pin/SetAdopted).
func (s *Store) persistProfiles(state map[string]ProfileUIState) error {
	if err := s.writeProfilesLocked(state); err != nil {
		return err
	}
	s.state = state
	return nil
}

// persistRecency writes the run-recency sidecar for the given state and, on
// success, commits the state to memory. Used by the hot path (RecordRun) and by
// prune, neither of which touch profile definitions or adoption.
func (s *Store) persistRecency(state map[string]ProfileUIState) error {
	if err := s.writeRecencyLocked(state); err != nil {
		return err
	}
	s.state = state
	return nil
}

// writeProfilesLocked atomically writes profile definitions plus adoption flags
// to run-profiles.json. Recency is intentionally excluded — it lives in the
// sidecar — so this file changes only on user actions, not on every run. Caller
// holds s.mu.
func (s *Store) writeProfilesLocked(state map[string]ProfileUIState) error {
	if s.loadErr != nil {
		return loadRefusal(s.loadErr)
	}
	if err := s.refuseIfChangedLocked(); err != nil {
		return err
	}
	profiles := s.profiles
	if profiles == nil {
		profiles = []RunProfile{}
	}
	pf := ProfilesFile{
		Version:      profilesFileVersion,
		Profiles:     profiles,
		ProfileState: adoptionState(state),
	}
	data, err := json.MarshalIndent(pf, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling profiles: %w", err)
	}
	if err := s.atomicWriteLocked(profilesFileName, data); err != nil {
		return err
	}
	s.diskProfiles = data
	return nil
}

// sameProfilesFile reports whether the profiles file on disk now (nil when
// absent) is the one this store last read or wrote.
func sameProfilesFile(known, onDisk []byte) bool {
	return bytes.Equal(known, onDisk)
}

// refuseIfChangedLocked re-reads run-profiles.json and refuses the write when
// it is not the file this store last read or wrote (#397). A difference
// latches: memory is stale until a Load. A failed re-read refuses this write
// only, since nothing is known to have changed. Caller holds s.mu.
//
// ponytail: check-then-rename leaves a window of a few microseconds in which
// an external write can still be lost; closing it needs a lock every writer
// honours, which git and editors do not.
func (s *Store) refuseIfChangedLocked() error {
	if s.changedErr != nil {
		return s.changedErr
	}
	path := filepath.Join(s.workspaceRoot, profilesFileName)
	onDisk, err := s.fs.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		remedy := "Check the file, then try again"
		if errors.Is(err, fs.ErrPermission) {
			remedy = "Restore read access to the file and its .firn directory, then try again"
		}
		return fmt.Errorf("run profile changes are not saved, because the profiles file could not be re-read to confirm it is unchanged (reading profiles file %s: %w); %s", path, err, remedy)
	}
	if err != nil {
		onDisk = nil
	}
	if sameProfilesFile(s.diskProfiles, onDisk) {
		return nil
	}
	s.changedErr = fmt.Errorf("run profile changes are not saved, to preserve a profiles file that %w after Firn loaded it (%s); Choose Reload in the Run Profiles panel to read the file as it is now", ErrProfilesFileChanged, path)
	return s.changedErr
}

// ChangedOnDisk returns the latched refusal when a write found run-profiles.json
// changed on disk after Load, or nil.
func (s *Store) ChangedOnDisk() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.changedErr
}

// writeRecencyLocked atomically writes the run-recency sidecar. This is the hot
// path (one write per run); it is deliberately tiny and never rewrites profile
// definitions. Caller holds s.mu.
func (s *Store) writeRecencyLocked(state map[string]ProfileUIState) error {
	if s.recencyErr != nil {
		return recencyRefusal(s.recencyErr)
	}
	rf := RecencyFile{
		Version: recencyFileVersion,
		Recency: recencyMap(state),
	}
	data, err := json.MarshalIndent(rf, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling recency: %w", err)
	}
	return s.atomicWriteLocked(recencyFileName, data)
}

// atomicWriteLocked writes data to <root>/<relName> via a sibling temp file and
// a rename, so a torn write can never corrupt the destination — important
// because the recency sidecar is written frequently. Caller holds s.mu.
func (s *Store) atomicWriteLocked(relName string, data []byte) error {
	dir := filepath.Join(s.workspaceRoot, ".firn")
	if err := s.fs.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating .firn directory: %w", err)
	}
	finalPath := filepath.Join(s.workspaceRoot, relName)
	tmpPath := finalPath + ".tmp"
	if err := s.fs.WriteFile(tmpPath, data, fs.FileMode(0o644)); err != nil {
		return fmt.Errorf("writing temp file %s: %w", relName, err)
	}
	if err := s.fs.Rename(tmpPath, finalPath); err != nil {
		return fmt.Errorf("renaming %s into place: %w", relName, err)
	}
	return nil
}

// adoptionState projects the durable adoption flags out of the combined UI
// state; recency is excluded (it lives in the sidecar).
func adoptionState(state map[string]ProfileUIState) map[string]ProfileUIState {
	out := map[string]ProfileUIState{}
	for id, st := range state {
		if st.Adopted {
			out[id] = ProfileUIState{Adopted: true}
		}
	}
	return out
}

// recencyMap projects last-run timestamps out of the combined UI state.
func recencyMap(state map[string]ProfileUIState) map[string]int64 {
	out := map[string]int64{}
	for id, st := range state {
		if st.LastRunAt != 0 {
			out[id] = st.LastRunAt
		}
	}
	return out
}

// hasRecency reports whether any entry carries a last-run timestamp.
func hasRecency(state map[string]ProfileUIState) bool {
	for _, st := range state {
		if st.LastRunAt != 0 {
			return true
		}
	}
	return false
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

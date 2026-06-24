package runprofile

import (
	"encoding/json"
	"firn/internal/filesystem"
	"io/fs"
	"strings"
	"testing"
)

func newMockFS() *filesystem.Mock {
	m, _ := newMockFSWithFiles()
	return m
}

// newMockFSWithFiles is like newMockFS but also returns the backing file map so
// tests can assert on what was actually written to disk (e.g. that the atomic
// temp+rename persist left no stray .tmp file behind).
func newMockFSWithFiles() (*filesystem.Mock, map[string][]byte) {
	files := map[string][]byte{}
	dirs := map[string]bool{}

	m := &filesystem.Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			data, ok := files[path]
			if !ok {
				return nil, fs.ErrNotExist
			}
			return data, nil
		},
		WriteFileFunc: func(path string, data []byte, perm fs.FileMode) error {
			files[path] = data
			return nil
		},
		MkdirAllFunc: func(path string, perm fs.FileMode) error {
			dirs[path] = true
			return nil
		},
		RenameFunc: func(oldpath, newpath string) error {
			data, ok := files[oldpath]
			if !ok {
				return fs.ErrNotExist
			}
			files[newpath] = data
			delete(files, oldpath)
			return nil
		},
	}
	return m, files
}

func TestStoreLoadNoFile(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")

	profiles, err := store.Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if len(profiles) != 0 {
		t.Errorf("expected empty list, got %d profiles", len(profiles))
	}
}

func TestStoreLoadUnsupportedVersion(t *testing.T) {
	mockFS := newMockFS()
	pf := ProfilesFile{
		Version:  99,
		Profiles: []RunProfile{},
	}
	data, _ := json.Marshal(pf)
	_ = mockFS.WriteFile("/workspace/.firn/run-profiles.json", data, 0o644)

	store := NewStore(mockFS, "/workspace")
	_, err := store.Load()
	if err == nil {
		t.Fatal("expected error for unsupported version")
	}
	if !strings.Contains(err.Error(), "unsupported profiles file version") {
		t.Errorf("expected version error, got: %v", err)
	}
}

func TestStoreLoadValidFile(t *testing.T) {
	mockFS := newMockFS()
	pf := ProfilesFile{
		Version: 1,
		Profiles: []RunProfile{
			{ID: "p1", Name: "Build", Type: ProfileTypeSingle, Source: ProfileSourceUser, Command: "make build"},
		},
	}
	data, _ := json.Marshal(pf)
	// Pre-populate test data through the mock's WriteFile method
	_ = mockFS.WriteFile("/workspace/.firn/run-profiles.json", data, 0o644)

	store := NewStore(mockFS, "/workspace")
	profiles, err := store.Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if len(profiles) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(profiles))
	}
	if profiles[0].ID != "p1" {
		t.Errorf("expected ID 'p1', got %q", profiles[0].ID)
	}
}

func TestStoreSaveCreatesNewProfile(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")

	profile := RunProfile{
		ID:      "p1",
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Source:  ProfileSourceUser,
		Command: "make build",
	}
	if err := store.Save(profile); err != nil {
		t.Fatalf("Save() returned error: %v", err)
	}

	all := store.GetAll()
	if len(all) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(all))
	}
	if all[0].Name != "Build" {
		t.Errorf("expected name 'Build', got %q", all[0].Name)
	}
}

func TestStoreSaveUpdatesExisting(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")

	profile := RunProfile{
		ID:      "p1",
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Source:  ProfileSourceUser,
		Command: "make build",
	}
	_ = store.Save(profile)

	profile.Name = "Build (updated)"
	_ = store.Save(profile)

	all := store.GetAll()
	if len(all) != 1 {
		t.Fatalf("expected 1 profile after upsert, got %d", len(all))
	}
	if all[0].Name != "Build (updated)" {
		t.Errorf("expected updated name, got %q", all[0].Name)
	}
}

func TestStoreDelete(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")

	_ = store.Save(RunProfile{ID: "p1", Name: "Build", Type: ProfileTypeSingle, Source: ProfileSourceUser, Command: "make"})
	_ = store.Save(RunProfile{ID: "p2", Name: "Test", Type: ProfileTypeSingle, Source: ProfileSourceUser, Command: "make test"})

	if err := store.Delete("p1"); err != nil {
		t.Fatalf("Delete() returned error: %v", err)
	}

	all := store.GetAll()
	if len(all) != 1 {
		t.Fatalf("expected 1 profile after delete, got %d", len(all))
	}
	if all[0].ID != "p2" {
		t.Errorf("expected remaining profile 'p2', got %q", all[0].ID)
	}
}

func TestStoreDeleteNotFound(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")

	err := store.Delete("nonexistent")
	if err == nil {
		t.Fatal("expected error for deleting nonexistent profile")
	}
}

func TestStorePin(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")

	detected := RunProfile{
		ID:           "detected-pkg-build",
		Name:         "npm run build",
		Type:         ProfileTypeSingle,
		Source:       ProfileSourceDetected,
		Command:      "npm run build",
		DetectedFrom: "package.json",
	}

	if err := store.Pin(detected); err != nil {
		t.Fatalf("Pin() returned error: %v", err)
	}

	all := store.GetAll()
	if len(all) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(all))
	}
	if all[0].Source != ProfileSourceUser {
		t.Errorf("expected source 'user' after pin, got %q", all[0].Source)
	}
	if all[0].DetectedFrom != "" {
		t.Errorf("expected DetectedFrom cleared after pin, got %q", all[0].DetectedFrom)
	}
}

func TestStoreGetAllReturnsCopy(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")

	_ = store.Save(RunProfile{ID: "p1", Name: "Build", Type: ProfileTypeSingle, Source: ProfileSourceUser, Command: "make"})

	all := store.GetAll()
	all[0].Name = "mutated"

	// Verify internal state is not affected
	internal := store.GetAll()
	if internal[0].Name != "Build" {
		t.Errorf("GetAll() should return a copy; internal was mutated to %q", internal[0].Name)
	}
}

func TestStoreSetAdoptedToggles(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")
	if _, err := store.Load(); err != nil {
		t.Fatal(err)
	}

	// Set adopted true and verify
	if err := store.SetAdopted("detected-a", true); err != nil {
		t.Fatalf("SetAdopted(true): %v", err)
	}
	st := store.GetState()
	if !st["detected-a"].Adopted {
		t.Errorf("expected adopted=true after SetAdopted(true), got %+v", st)
	}

	// Set adopted false and verify (no lastRunAt so entry should be dropped)
	if err := store.SetAdopted("detected-a", false); err != nil {
		t.Fatalf("SetAdopted(false): %v", err)
	}
	st = store.GetState()
	if entry, ok := st["detected-a"]; ok {
		t.Errorf("expected entry removed when unadopted with no recency, got %+v", entry)
	}
}

func TestStoreRecordRunPreservesAdopted(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")
	if _, err := store.Load(); err != nil {
		t.Fatal(err)
	}

	if err := store.SetAdopted("detected-a", true); err != nil {
		t.Fatalf("SetAdopted: %v", err)
	}
	if err := store.RecordRun("detected-a", 999); err != nil {
		t.Fatalf("RecordRun: %v", err)
	}
	st := store.GetState()["detected-a"]
	if !st.Adopted || st.LastRunAt != 999 {
		t.Errorf("expected adopted=true and lastRunAt=999, got %+v", st)
	}
}

func TestStoreGetStateReturnsCopy(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")
	if _, err := store.Load(); err != nil {
		t.Fatal(err)
	}

	if err := store.SetAdopted("detected-a", true); err != nil {
		t.Fatalf("SetAdopted: %v", err)
	}

	// Mutate returned map
	got := store.GetState()
	got["detected-a"] = ProfileUIState{Adopted: false, LastRunAt: 12345}

	// Internal state must be unchanged
	internal := store.GetState()
	if !internal["detected-a"].Adopted || internal["detected-a"].LastRunAt != 0 {
		t.Errorf("GetState must return a copy; internal was mutated: %+v", internal["detected-a"])
	}
}

func TestStoreGetAllReturnsCopyDeepFields(t *testing.T) {
	mockFS := newMockFS()
	store := NewStore(mockFS, "/workspace")

	_ = store.Save(RunProfile{
		ID:      "p1",
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Source:  ProfileSourceUser,
		Command: "make",
		Env:     map[string]string{"KEY": "original"},
		Tags:    []ProfileTag{TagBuild},
		Steps:   []string{"step1"},
	})

	all := store.GetAll()

	// Mutate the returned map
	all[0].Env["KEY"] = "mutated"
	all[0].Tags[0] = TagTest
	all[0].Steps[0] = "mutated-step"

	// Verify internal state is not affected
	internal := store.GetAll()
	if internal[0].Env["KEY"] != "original" {
		t.Errorf("GetAll() Env should be a deep copy; internal was mutated to %q", internal[0].Env["KEY"])
	}
	if internal[0].Tags[0] != TagBuild {
		t.Errorf("GetAll() Tags should be a deep copy; internal was mutated to %q", internal[0].Tags[0])
	}
	if internal[0].Steps[0] != "step1" {
		t.Errorf("GetAll() Steps should be a deep copy; internal was mutated to %q", internal[0].Steps[0])
	}
}

func TestStorePersistIsAtomic(t *testing.T) {
	mockFS, files := newMockFSWithFiles()
	store := NewStore(mockFS, "/workspace")
	if _, err := store.Load(); err != nil {
		t.Fatal(err)
	}

	finalPath := "/workspace/" + profilesFileName
	tmpPath := finalPath + ".tmp"

	// A frequent-write path: recency + adoption both persist.
	if err := store.SetAdopted("detected-a", true); err != nil {
		t.Fatalf("SetAdopted: %v", err)
	}
	if err := store.RecordRun("detected-a", 4242); err != nil {
		t.Fatalf("RecordRun: %v", err)
	}

	// Final file exists.
	data, ok := files[finalPath]
	if !ok {
		t.Fatalf("expected final profiles file at %q after persist", finalPath)
	}

	// No stray temp file left behind (rename moved it into place).
	if _, ok := files[tmpPath]; ok {
		t.Errorf("expected temp file %q to be gone after atomic rename", tmpPath)
	}

	// Content round-trips with the expected recency/adoption state.
	var pf ProfilesFile
	if err := json.Unmarshal(data, &pf); err != nil {
		t.Fatalf("unmarshal persisted file: %v", err)
	}
	if pf.Version != profilesFileVersion {
		t.Errorf("expected version %d, got %d", profilesFileVersion, pf.Version)
	}
	st, ok := pf.ProfileState["detected-a"]
	if !ok {
		t.Fatalf("expected profileState entry for detected-a, got %+v", pf.ProfileState)
	}
	if !st.Adopted || st.LastRunAt != 4242 {
		t.Errorf("expected adopted=true lastRunAt=4242, got %+v", st)
	}

	// And a fresh store Loads the same state from the final file.
	reloaded := NewStore(mockFS, "/workspace")
	if _, err := reloaded.Load(); err != nil {
		t.Fatalf("reload Load: %v", err)
	}
	got := reloaded.GetState()["detected-a"]
	if !got.Adopted || got.LastRunAt != 4242 {
		t.Errorf("reloaded state mismatch: %+v", got)
	}
}

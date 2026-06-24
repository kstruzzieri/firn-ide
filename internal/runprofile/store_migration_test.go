package runprofile

import (
	"encoding/json"
	"errors"
	"firn/internal/filesystem"
	"io/fs"
	"testing"
)

func storeMigrationFS(files map[string][]byte) *filesystem.Mock {
	return &filesystem.Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			if d, ok := files[path]; ok {
				return d, nil
			}
			return nil, fs.ErrNotExist
		},
		WriteFileFunc: func(path string, data []byte, perm fs.FileMode) error {
			files[path] = data
			return nil
		},
		MkdirAllFunc: func(path string, perm fs.FileMode) error { return nil },
	}
}

func TestStoreLoadMigratesV1AndPersistsV3(t *testing.T) {
	expectedID := scopedID("frontend", "detected-package-json-test")
	v1, _ := json.Marshal(ProfilesFile{
		Version: 1,
		Profiles: []RunProfile{
			{ID: "detected-package-json-test", Name: "npm run test", Type: ProfileTypeSingle, Source: ProfileSourceUser, Command: "npm run test"},
		},
	})
	files := map[string][]byte{"/repo/frontend/.firn/run-profiles.json": v1}

	s := NewStore(storeMigrationFS(files), "/repo/frontend")
	s.SetScope(MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"})
	loaded, err := s.Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if len(loaded) != 1 || loaded[0].ID != expectedID {
		t.Fatalf("migrated profile wrong: %+v", loaded)
	}
	if loaded[0].WorkspaceID != "frontend" {
		t.Errorf("ownership not stamped: %+v", loaded[0])
	}

	var persisted ProfilesFile
	if err := json.Unmarshal(files["/repo/frontend/.firn/run-profiles.json"], &persisted); err != nil {
		t.Fatalf("decode persisted: %v", err)
	}
	if persisted.Version != 3 {
		t.Errorf("expected persisted version 3, got %d", persisted.Version)
	}
	if persisted.Profiles[0].ID != expectedID {
		t.Errorf("persisted ID not migrated: %q", persisted.Profiles[0].ID)
	}
}

func TestStoreLoadsV2FileWithEmptyState(t *testing.T) {
	v2 := `{"version":2,"profiles":[{"id":"detected-a","name":"Dev","type":"single","source":"detected"}]}`
	files := map[string][]byte{"/ws/.firn/run-profiles.json": []byte(v2)}
	s := NewStore(storeMigrationFS(files), "/ws")
	if _, err := s.Load(); err != nil {
		t.Fatalf("load v2: %v", err)
	}
	if got := s.GetState(); len(got) != 0 {
		t.Errorf("v2 load should yield empty state, got %v", got)
	}
}

func TestStorePersistsAndReloadsProfileState(t *testing.T) {
	files := map[string][]byte{}
	fsys := storeMigrationFS(files)
	s := NewStore(fsys, "/ws")
	if _, err := s.Load(); err != nil {
		t.Fatal(err)
	}
	if err := s.SetAdopted("detected-a", true); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordRun("detected-a", 1719100000000); err != nil {
		t.Fatal(err)
	}
	s2 := NewStore(fsys, "/ws")
	if _, err := s2.Load(); err != nil {
		t.Fatal(err)
	}
	st := s2.GetState()["detected-a"]
	if !st.Adopted || st.LastRunAt != 1719100000000 {
		t.Errorf("reloaded state = %+v, want adopted+ts", st)
	}
}

func TestStoreLoadV2Untouched(t *testing.T) {
	v2, _ := json.Marshal(ProfilesFile{
		Version: 2,
		Profiles: []RunProfile{
			{ID: "detected-frontend-package-json-test", Name: "npm run test", Type: ProfileTypeSingle, WorkspaceID: "frontend"},
		},
	})
	files := map[string][]byte{"/repo/frontend/.firn/run-profiles.json": v2}
	s := NewStore(storeMigrationFS(files), "/repo/frontend")
	s.SetScope(MigrationScope{WorkspaceID: "frontend", WorkspaceRelDir: "frontend"})
	loaded, err := s.Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if loaded[0].ID != "detected-frontend-package-json-test" {
		t.Errorf("v2 load changed id: %q", loaded[0].ID)
	}
}

func TestStoreLoadMigrationPersistFailureIsNonFatal(t *testing.T) {
	expectedID := scopedID("frontend", "detected-package-json-test")
	v1, _ := json.Marshal(ProfilesFile{
		Version: 1,
		Profiles: []RunProfile{
			{ID: "detected-package-json-test", Name: "npm run test", Type: ProfileTypeSingle, Source: ProfileSourceUser, Command: "npm run test"},
		},
	})
	files := map[string][]byte{"/repo/frontend/.firn/run-profiles.json": v1}

	// Simulate a read-only directory: reads succeed, writes fail.
	mock := &filesystem.Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			if d, ok := files[path]; ok {
				return d, nil
			}
			return nil, fs.ErrNotExist
		},
		WriteFileFunc: func(path string, data []byte, perm fs.FileMode) error {
			return errors.New("read-only file system")
		},
		MkdirAllFunc: func(path string, perm fs.FileMode) error { return nil },
	}

	s := NewStore(mock, "/repo/frontend")
	s.SetScope(MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"})
	loaded, err := s.Load()
	if err != nil {
		t.Fatalf("Load() must not fail when the migrated file cannot be written: %v", err)
	}
	// Migration still applied in memory.
	if len(loaded) != 1 || loaded[0].ID != expectedID {
		t.Fatalf("migrated data must be returned even when persist fails: %+v", loaded)
	}
	// The persist failure is surfaced as a warning, not swallowed.
	if len(s.Warnings) == 0 {
		t.Error("expected a warning recorded for the failed migration write")
	}
}

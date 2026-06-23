package runprofile

import (
	"encoding/json"
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

func TestStoreLoadMigratesV1AndPersistsV2(t *testing.T) {
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
	if len(loaded) != 1 || loaded[0].ID != "detected-frontend-package-json-test" {
		t.Fatalf("migrated profile wrong: %+v", loaded)
	}
	if loaded[0].WorkspaceID != "frontend" {
		t.Errorf("ownership not stamped: %+v", loaded[0])
	}

	var persisted ProfilesFile
	if err := json.Unmarshal(files["/repo/frontend/.firn/run-profiles.json"], &persisted); err != nil {
		t.Fatalf("decode persisted: %v", err)
	}
	if persisted.Version != 2 {
		t.Errorf("expected persisted version 2, got %d", persisted.Version)
	}
	if persisted.Profiles[0].ID != "detected-frontend-package-json-test" {
		t.Errorf("persisted ID not migrated: %q", persisted.Profiles[0].ID)
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

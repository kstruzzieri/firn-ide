package runprofile

import (
	"firn/internal/filesystem"
	"io/fs"
	"testing"
)

func newManagerTestFS(files map[string][]byte) *filesystem.Mock {
	return &filesystem.Mock{
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
		StatFunc: func(path string) (fs.FileInfo, error) {
			if _, ok := files[path]; ok {
				return mockFileInfo{name: path}, nil
			}
			return nil, fs.ErrNotExist
		},
		MkdirAllFunc: func(path string, perm fs.FileMode) error {
			return nil
		},
		RemoveFunc: func(path string) error {
			delete(files, path)
			return nil
		},
	}
}

func TestManagerLoadAndGetAll(t *testing.T) {
	files := map[string][]byte{
		"/workspace/go.mod": []byte("module example\ngo 1.21\n"),
	}
	mockFS := newManagerTestFS(files)
	mgr := NewManager(mockFS, "/workspace")

	if err := mgr.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	all := mgr.GetAllProfiles()
	if len(all) != 4 {
		t.Errorf("expected 4 detected profiles, got %d", len(all))
	}
}

func TestManagerSaveProfileValidates(t *testing.T) {
	mockFS := newManagerTestFS(map[string][]byte{})
	mgr := NewManager(mockFS, "/workspace")
	_ = mgr.Load()

	// Invalid profile (missing name)
	result, err := mgr.SaveProfile(RunProfile{
		ID:      "p1",
		Type:    ProfileTypeSingle,
		Command: "echo hello",
	})
	if err != nil {
		t.Fatalf("SaveProfile() returned unexpected error: %v", err)
	}
	if result.Valid {
		t.Fatal("expected invalid for missing name")
	}

	// Valid profile
	result, err = mgr.SaveProfile(RunProfile{
		ID:      "p1",
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Command: "make build",
	})
	if err != nil {
		t.Fatalf("SaveProfile() returned error: %v", err)
	}
	if !result.Valid {
		t.Errorf("expected valid, got errors: %v", result.Errors)
	}

	all := mgr.GetAllProfiles()
	if len(all) != 1 {
		t.Errorf("expected 1 saved profile, got %d", len(all))
	}
}

func TestManagerMergeDeduplicate(t *testing.T) {
	files := map[string][]byte{
		"/workspace/go.mod": []byte("module example\ngo 1.21\n"),
	}
	mockFS := newManagerTestFS(files)
	mgr := NewManager(mockFS, "/workspace")
	_ = mgr.Load()

	// Pin a detected profile
	detected := mgr.GetAllProfiles()
	if len(detected) == 0 {
		t.Fatal("expected detected profiles")
	}

	firstDetected := detected[0]
	if err := mgr.PinProfile(firstDetected.ID); err != nil {
		t.Fatalf("PinProfile() error: %v", err)
	}

	// After pinning, the total count should stay the same (pinned replaces detected)
	all := mgr.GetAllProfiles()
	if len(all) != 4 {
		t.Errorf("expected 4 profiles after pin (no duplicates), got %d", len(all))
	}

	// The pinned profile should now be "user" source
	hasPinned := false
	for _, p := range all {
		if p.ID == firstDetected.ID && p.Source == ProfileSourceUser {
			hasPinned = true
			break
		}
	}
	if !hasPinned {
		t.Error("expected pinned profile to have source 'user'")
	}
}

func TestManagerHandleFileChange(t *testing.T) {
	files := map[string][]byte{}
	mockFS := newManagerTestFS(files)
	mgr := NewManager(mockFS, "/workspace")
	_ = mgr.Load()

	// Non-config file should not trigger re-detect
	if mgr.HandleFileChange("/workspace/src/main.go") {
		t.Error("expected false for non-config file")
	}

	// Add a config file and trigger
	files["/workspace/package.json"] = []byte(`{"scripts": {"build": "tsc"}}`)

	if !mgr.HandleFileChange("/workspace/package.json") {
		t.Error("expected true for config file")
	}

	all := mgr.GetAllProfiles()
	if len(all) != 1 {
		t.Errorf("expected 1 profile after re-detect, got %d", len(all))
	}
}

func TestManagerDeleteProfile(t *testing.T) {
	mockFS := newManagerTestFS(map[string][]byte{})
	mgr := NewManager(mockFS, "/workspace")
	_ = mgr.Load()

	_, _ = mgr.SaveProfile(RunProfile{
		ID: "p1", Name: "Build", Type: ProfileTypeSingle, Command: "make",
	})

	if err := mgr.DeleteProfile("p1"); err != nil {
		t.Fatalf("DeleteProfile() error: %v", err)
	}

	all := mgr.GetAllProfiles()
	if len(all) != 0 {
		t.Errorf("expected 0 profiles after delete, got %d", len(all))
	}
}

func TestManagerSetWorkspaceRoot(t *testing.T) {
	files := map[string][]byte{
		"/workspace-a/go.mod": []byte("module a\ngo 1.21\n"),
		"/workspace-b/package.json": []byte(`{"scripts": {"start": "node ."}}`),
	}
	mockFS := newManagerTestFS(files)
	mgr := NewManager(mockFS, "/workspace-a")
	_ = mgr.Load()

	if len(mgr.GetAllProfiles()) != 4 {
		t.Fatalf("expected 4 go profiles initially")
	}

	mgr.SetWorkspaceRoot("/workspace-b")
	_ = mgr.Load()

	all := mgr.GetAllProfiles()
	if len(all) != 1 {
		t.Errorf("expected 1 npm profile after workspace switch, got %d", len(all))
	}
}

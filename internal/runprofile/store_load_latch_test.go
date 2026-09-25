package runprofile

import (
	"bytes"
	"encoding/json"
	"firn/internal/filesystem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Issue #359: an unreadable run-profiles.json must never be replaced by the
// empty in-memory list a failed Load leaves behind. These tests drive the
// production constructor (NewProjectManager over the real filesystem), as
// app.go does.

const latchSavedProfiles = `{
  "version": %d,
  "profiles": [
    {"id": "keep-a", "name": "Keep A", "type": "single", "source": "user", "command": "echo a"},
    {"id": "keep-b", "name": "Keep B", "type": "single", "source": "user", "command": "echo b"}
  ]
}
`

func latchRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite","test":"jest"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".firn"), 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

func latchProfilesPath(root string) string { return filepath.Join(root, profilesFileName) }

func latchLoad(t *testing.T, root string) *ProjectRunProfileManager {
	t.Helper()
	m := NewProjectManager(filesystem.NewOS(), root)
	if err := m.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}
	return m
}

func latchDetectedID(t *testing.T, m *ProjectRunProfileManager) string {
	t.Helper()
	for _, p := range m.GetAllProfiles() {
		if p.Source == ProfileSourceDetected {
			return p.ID
		}
	}
	t.Fatal("fixture detected no profiles")
	return ""
}

func latchUserProfile() RunProfile {
	return RunProfile{ID: "new-user", Name: "New", Type: ProfileTypeSingle, Command: "echo new"}
}

type latchAction struct {
	name string
	run  func(t *testing.T, m *ProjectRunProfileManager) error
}

var latchActions = []latchAction{
	{"SaveProfile", func(t *testing.T, m *ProjectRunProfileManager) error {
		_, err := m.SaveProfile(latchUserProfile())
		return err
	}},
	{"PinProfile", func(t *testing.T, m *ProjectRunProfileManager) error {
		return m.PinProfile(latchDetectedID(t, m))
	}},
	{"AdoptProfile", func(t *testing.T, m *ProjectRunProfileManager) error {
		return m.AdoptProfile(latchDetectedID(t, m))
	}},
}

type latchCorruption struct {
	name   string
	data   []byte
	chmod  bool   // make the file unreadable instead of corrupting its content
	remedy string // the remedy the refusal must name
}

func latchCorruptions() []latchCorruption {
	valid := []byte(strings.Replace(latchSavedProfiles, "%d", "3", 1))
	return []latchCorruption{
		{"conflict marker", append(append([]byte{}, valid...), []byte(">>>>>>> feature/branch\n")...), false, "fix or remove it"},
		{"version 4", []byte(strings.Replace(latchSavedProfiles, "%d", "4", 1)), false, "newer Firn"},
		{"unreadable", valid, true, "restore read access"},
	}
}

func TestIssue359UnreadableProfilesFileSurvivesWrites(t *testing.T) {
	for _, c := range latchCorruptions() {
		for _, a := range latchActions {
			t.Run(c.name+"/"+a.name, func(t *testing.T) {
				if c.chmod && os.Geteuid() == 0 {
					t.Skip("root ignores file permissions")
				}
				root := latchRepo(t)
				path := latchProfilesPath(root)
				if err := os.WriteFile(path, c.data, 0o644); err != nil {
					t.Fatal(err)
				}
				if c.chmod {
					if err := os.Chmod(path, 0); err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { _ = os.Chmod(path, 0o644) })
				}

				m := latchLoad(t, root)
				err := a.run(t, m)

				if c.chmod {
					if cerr := os.Chmod(path, 0o644); cerr != nil {
						t.Fatal(cerr)
					}
				}
				got, rerr := os.ReadFile(path)
				if rerr != nil {
					t.Fatal(rerr)
				}
				if !bytes.Equal(got, c.data) {
					t.Fatalf("%s rewrote the unreadable file:\n%s", a.name, got)
				}
				if err == nil {
					t.Fatalf("%s must refuse while the profiles file is unreadable", a.name)
				}
				for _, want := range []string{path, c.remedy, "restart Firn"} {
					if !strings.Contains(err.Error(), want) {
						t.Errorf("refusal %q does not name %q", err, want)
					}
				}
			})
		}
	}
}

func TestIssue359FixedFileAndReloadUnblocksWrites(t *testing.T) {
	root := latchRepo(t)
	path := latchProfilesPath(root)
	valid := strings.Replace(latchSavedProfiles, "%d", "3", 1)
	if err := os.WriteFile(path, []byte(valid+"<<<<<<< HEAD\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	m := latchLoad(t, root)
	if _, err := m.SaveProfile(latchUserProfile()); err == nil {
		t.Fatal("save must refuse before the file is fixed")
	}

	if err := os.WriteFile(path, []byte(valid), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := m.Load(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if _, err := m.SaveProfile(latchUserProfile()); err != nil {
		t.Fatalf("save after fix and reload: %v", err)
	}
	var pf ProfilesFile
	data, _ := os.ReadFile(path)
	if err := json.Unmarshal(data, &pf); err != nil {
		t.Fatal(err)
	}
	if len(pf.Profiles) != 3 {
		t.Fatalf("want the two kept profiles plus the new one, got %+v", pf.Profiles)
	}
}

func TestIssue359StoreReloadClearsLatchAndRecencyStaysWritable(t *testing.T) {
	root := latchRepo(t)
	path := latchProfilesPath(root)
	if err := os.WriteFile(path, []byte("{ not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewStore(filesystem.NewOS(), root)
	if _, err := s.Load(); err == nil {
		t.Fatal("expected a load error")
	}
	// Run recency lives in the sidecar and never touches the profiles file.
	if err := s.RecordRun("anything", 42); err != nil {
		t.Fatalf("RecordRun while latched: %v", err)
	}
	if err := s.Save(latchUserProfile()); err == nil {
		t.Fatal("save must refuse while latched")
	}

	if err := os.WriteFile(path, []byte(strings.Replace(latchSavedProfiles, "%d", "3", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if err := s.Save(latchUserProfile()); err != nil {
		t.Fatalf("save after successful reload: %v", err)
	}
}

func TestIssue359MissingFileStillWrites(t *testing.T) {
	for _, a := range latchActions {
		t.Run(a.name, func(t *testing.T) {
			root := latchRepo(t)
			m := latchLoad(t, root)
			if err := a.run(t, m); err != nil {
				t.Fatalf("%s with no profiles file: %v", a.name, err)
			}
			if _, err := os.Stat(latchProfilesPath(root)); err != nil {
				t.Fatalf("%s did not write the profiles file: %v", a.name, err)
			}
		})
	}
}

func TestIssue359V1MigrationStillWrites(t *testing.T) {
	root := latchRepo(t)
	path := latchProfilesPath(root)
	if err := os.WriteFile(path, []byte(strings.Replace(latchSavedProfiles, "%d", "1", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	m := latchLoad(t, root)
	var pf ProfilesFile
	data, _ := os.ReadFile(path)
	if err := json.Unmarshal(data, &pf); err != nil {
		t.Fatal(err)
	}
	if pf.Version != profilesFileVersion || len(pf.Profiles) != 2 {
		t.Fatalf("migration did not persist v%d with both profiles: %s", profilesFileVersion, data)
	}
	if _, err := m.SaveProfile(latchUserProfile()); err != nil {
		t.Fatalf("save after migration: %v", err)
	}
}

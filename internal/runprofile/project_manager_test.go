package runprofile

import (
	"encoding/json"
	"firn/internal/filesystem"
	"io/fs"
	"strings"
	"testing"
)

type projDirEntry struct {
	name string
	dir  bool
}

func (e projDirEntry) Name() string { return e.name }
func (e projDirEntry) IsDir() bool  { return e.dir }
func (e projDirEntry) Type() fs.FileMode {
	if e.dir {
		return fs.ModeDir
	}
	return 0
}
func (e projDirEntry) Info() (fs.FileInfo, error) { return mockFileInfo{name: e.name}, nil }

// newProjectTestFS derives ReadDir from the file map and serves
// ReadFile/Write/Stat/Mkdir/Remove from the same map.
func newProjectTestFS(files map[string][]byte) *filesystem.Mock {
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
		StatFunc: func(path string) (fs.FileInfo, error) {
			if _, ok := files[path]; ok {
				return mockFileInfo{name: path}, nil
			}
			return nil, fs.ErrNotExist
		},
		MkdirAllFunc: func(path string, perm fs.FileMode) error { return nil },
		RemoveFunc:   func(path string) error { delete(files, path); return nil },
		ReadDirFunc: func(dir string) ([]fs.DirEntry, error) {
			dir = strings.TrimSuffix(dir, "/")
			childDirs := map[string]bool{}
			var entries []fs.DirEntry
			for f := range files {
				if !strings.HasPrefix(f, dir+"/") {
					continue
				}
				rest := strings.TrimPrefix(f, dir+"/")
				parts := strings.SplitN(rest, "/", 2)
				if len(parts) == 1 {
					entries = append(entries, projDirEntry{name: parts[0], dir: false})
				} else {
					childDirs[parts[0]] = true
				}
			}
			for d := range childDirs {
				entries = append(entries, projDirEntry{name: d, dir: true})
			}
			return entries, nil
		},
	}
}

func monorepoFixture() map[string][]byte {
	return map[string][]byte{
		"/repo/go.mod":                        []byte("module example\ngo 1.21\n"),
		"/repo/frontend/package.json":         []byte(`{"scripts":{"dev":"vite","test":"jest"}}`),
		"/repo/backend/python/pyproject.toml": []byte("[project]\nname='x'\n"),
	}
}

func findProfile(profiles []RunProfile, id string) *RunProfile {
	for i := range profiles {
		if profiles[i].ID == id {
			return &profiles[i]
		}
	}
	return nil
}

func TestProjectManagerDetectsAllWorkspacesWithOwnership(t *testing.T) {
	pm := NewProjectManager(newProjectTestFS(monorepoFixture()), "/repo")
	if err := pm.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	all := pm.GetAllProfiles()

	// go (root:go, 4 profiles) + frontend (2 npm) + python (2) = 8
	if len(all) != 8 {
		t.Fatalf("expected 8 profiles, got %d: %+v", len(all), all)
	}

	goBuild := findProfile(all, "detected-root-go-go-mod-build")
	if goBuild == nil || goBuild.WorkspaceID != "root:go" || goBuild.WorkingDir != "" {
		t.Errorf("go build ownership wrong: %+v", goBuild)
	}
	feDev := findProfile(all, "detected-frontend-package-json-dev")
	if feDev == nil || feDev.WorkspaceID != "frontend" || feDev.WorkingDir != "frontend" {
		t.Errorf("frontend dev ownership wrong: %+v", feDev)
	}
	pyTest := findProfile(all, "detected-backend-python-pyproject-toml-test")
	if pyTest == nil || pyTest.WorkspaceID != "backend/python" || pyTest.WorkingDir != "backend/python" {
		t.Errorf("python test ownership wrong: %+v", pyTest)
	}
}

func TestProjectManagerScopesIDsToAvoidCollision(t *testing.T) {
	files := map[string][]byte{
		"/repo/frontend/package.json": []byte(`{"scripts":{"test":"jest"}}`),
		"/repo/web/package.json":      []byte(`{"scripts":{"test":"vitest"}}`),
	}
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	if err := pm.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	all := pm.GetAllProfiles()
	if findProfile(all, "detected-frontend-package-json-test") == nil {
		t.Error("missing frontend-scoped test id")
	}
	if findProfile(all, "detected-web-package-json-test") == nil {
		t.Error("missing web-scoped test id")
	}
}

func TestProjectManagerRoutesSaveToOwningWorkspaceFile(t *testing.T) {
	files := monorepoFixture()
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	if err := pm.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	res, err := pm.SaveProfile(RunProfile{
		ID:          "custom-fe",
		Name:        "Storybook",
		Type:        ProfileTypeSingle,
		Command:     "npm run storybook",
		WorkspaceID: "frontend",
	})
	if err != nil || !res.Valid {
		t.Fatalf("SaveProfile() err=%v res=%+v", err, res)
	}

	raw, ok := files["/repo/frontend/.firn/run-profiles.json"]
	if !ok {
		t.Fatal("expected saved profile in frontend/.firn, not found")
	}
	var pf ProfilesFile
	if err := json.Unmarshal(raw, &pf); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if pf.Version != 2 || len(pf.Profiles) != 1 || pf.Profiles[0].ID != "custom-fe" {
		t.Errorf("frontend store wrong: %+v", pf)
	}
	if _, leaked := files["/repo/.firn/run-profiles.json"]; leaked {
		t.Error("frontend profile must not be written to repo-root store")
	}
}

func TestProjectManagerSaveEmptyWorkspaceDefaultsToRepoRoot(t *testing.T) {
	files := monorepoFixture()
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	_ = pm.Load()

	if _, err := pm.SaveProfile(RunProfile{
		ID: "root-custom", Name: "Tidy", Type: ProfileTypeSingle, Command: "go mod tidy",
	}); err != nil {
		t.Fatalf("SaveProfile() error: %v", err)
	}
	if _, ok := files["/repo/.firn/run-profiles.json"]; !ok {
		t.Error("empty workspaceId should route to repo-root store")
	}
}

func TestProjectManagerSaveUnknownWorkspaceErrors(t *testing.T) {
	pm := NewProjectManager(newProjectTestFS(monorepoFixture()), "/repo")
	_ = pm.Load()
	if res, _ := pm.SaveProfile(RunProfile{
		ID: "x", Name: "X", Type: ProfileTypeSingle, Command: "echo", WorkspaceID: "nope",
	}); res.Valid {
		t.Error("expected invalid result for unknown workspaceId")
	}
}

func TestProjectManagerPinRoutesToOwningWorkspace(t *testing.T) {
	files := monorepoFixture()
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	_ = pm.Load()

	if err := pm.PinProfile("detected-frontend-package-json-dev"); err != nil {
		t.Fatalf("PinProfile() error: %v", err)
	}
	raw := files["/repo/frontend/.firn/run-profiles.json"]
	if raw == nil || !strings.Contains(string(raw), "detected-frontend-package-json-dev") {
		t.Errorf("pinned profile not written to frontend store: %s", raw)
	}
	if len(pm.GetAllProfiles()) != 8 {
		t.Errorf("expected 8 after pin, got %d", len(pm.GetAllProfiles()))
	}
}

func TestProjectManagerMutationUnknownIDErrors(t *testing.T) {
	pm := NewProjectManager(newProjectTestFS(monorepoFixture()), "/repo")
	_ = pm.Load()
	if err := pm.DeleteProfile("does-not-exist"); err == nil {
		t.Error("expected not-found error from DeleteProfile")
	}
}

func TestProjectManagerHandleFileChangeRedetectsOneWorkspace(t *testing.T) {
	files := monorepoFixture()
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	_ = pm.Load()

	files["/repo/frontend/package.json"] = []byte(`{"scripts":{"dev":"vite","test":"jest","lint":"eslint ."}}`)
	if !pm.HandleFileChange("/repo/frontend/package.json") {
		t.Fatal("expected HandleFileChange to report a config change")
	}
	if findProfile(pm.GetAllProfiles(), "detected-frontend-package-json-lint") == nil {
		t.Error("re-detected frontend lint profile missing")
	}
}

func TestProjectManagerHandleFileChangeRoutesToDeepestWorkspace(t *testing.T) {
	files := monorepoFixture()
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	_ = pm.Load()

	// Change the nested python workspace's config; only it should re-detect.
	files["/repo/backend/python/pyproject.toml"] = []byte("[project]\nname='x'\n[tool.poetry]\n")
	if !pm.HandleFileChange("/repo/backend/python/pyproject.toml") {
		t.Fatal("expected config change to be handled")
	}
	all := pm.GetAllProfiles()
	// python profiles still present (re-detected), frontend + go untouched.
	if findProfile(all, "detected-backend-python-pyproject-toml-test") == nil {
		t.Error("python profile missing after re-detect")
	}
	if findProfile(all, "detected-frontend-package-json-dev") == nil {
		t.Error("frontend profile should be unaffected")
	}
	if len(all) != 8 {
		t.Errorf("expected 8 profiles, got %d", len(all))
	}
}

func TestProjectManagerDegradesOnCorruptWorkspaceStore(t *testing.T) {
	files := monorepoFixture()
	// Corrupt the frontend workspace's saved-profile store with invalid JSON.
	files["/repo/frontend/.firn/run-profiles.json"] = []byte("{ not valid json")

	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	if err := pm.Load(); err != nil {
		t.Fatalf("Load() must not fail when one workspace store is corrupt: %v", err)
	}

	all := pm.GetAllProfiles()
	// Other workspaces are unaffected.
	if findProfile(all, "detected-root-go-go-mod-build") == nil {
		t.Error("go profiles should survive a corrupt frontend store")
	}
	if findProfile(all, "detected-backend-python-pyproject-toml-test") == nil {
		t.Error("python profiles should survive a corrupt frontend store")
	}
	// The corrupt unit still contributes detected profiles (only its saved
	// store failed to load).
	if findProfile(all, "detected-frontend-package-json-dev") == nil {
		t.Error("frontend detected profiles should still show despite the corrupt store")
	}
	// The failure is surfaced as a warning, not swallowed.
	if len(pm.Warnings()) == 0 {
		t.Error("expected a warning for the corrupt frontend store")
	}
}

func TestProjectManagerValidateProfileChecksWorkspace(t *testing.T) {
	pm := NewProjectManager(newProjectTestFS(monorepoFixture()), "/repo")
	if err := pm.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	// Known workspace → valid.
	if res := pm.ValidateProfile(RunProfile{ID: "a", Name: "A", Type: ProfileTypeSingle, Command: "x", WorkspaceID: "frontend"}); !res.Valid {
		t.Errorf("known workspace should validate: %+v", res)
	}
	// Empty workspace → valid (routes to repo root).
	if res := pm.ValidateProfile(RunProfile{ID: "b", Name: "B", Type: ProfileTypeSingle, Command: "x"}); !res.Valid {
		t.Errorf("empty workspace should validate: %+v", res)
	}
	// Unknown workspace → invalid.
	if res := pm.ValidateProfile(RunProfile{ID: "c", Name: "C", Type: ProfileTypeSingle, Command: "x", WorkspaceID: "ghost"}); res.Valid {
		t.Error("unknown workspace should be invalid")
	}
	// Base validation still applies (missing name) regardless of workspace.
	if res := pm.ValidateProfile(RunProfile{ID: "d", Type: ProfileTypeSingle, Command: "x", WorkspaceID: "frontend"}); res.Valid {
		t.Error("missing name should be invalid")
	}
}

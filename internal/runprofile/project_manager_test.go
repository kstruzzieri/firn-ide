package runprofile

import (
	"encoding/json"
	"firn/internal/filesystem"
	"fmt"
	"io/fs"
	"reflect"
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

func scopedDetectedID(workspaceID, source, name string) string {
	return scopedID(workspaceID, generateID(source, name))
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

	goBuild := findProfile(all, scopedDetectedID("root:go", "go.mod", "build"))
	if goBuild == nil || goBuild.WorkspaceID != "root:go" || goBuild.WorkingDir != "" {
		t.Errorf("go build ownership wrong: %+v", goBuild)
	}
	feDev := findProfile(all, scopedDetectedID("frontend", "package.json", "dev"))
	if feDev == nil || feDev.WorkspaceID != "frontend" || feDev.WorkingDir != "frontend" {
		t.Errorf("frontend dev ownership wrong: %+v", feDev)
	}
	pyTest := findProfile(all, scopedDetectedID("backend/python", "pyproject.toml", "test"))
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
	if findProfile(all, scopedDetectedID("frontend", "package.json", "test")) == nil {
		t.Error("missing frontend-scoped test id")
	}
	if findProfile(all, scopedDetectedID("web", "package.json", "test")) == nil {
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
	if pf.Version != 3 || len(pf.Profiles) != 1 || pf.Profiles[0].ID != "custom-fe" {
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
	res, err := pm.SaveProfile(RunProfile{
		ID: "x", Name: "X", Type: ProfileTypeSingle, Command: "echo", WorkspaceID: "nope",
	})
	if err != nil {
		t.Fatalf("SaveProfile() returned unexpected transport error: %v", err)
	}
	if res.Valid || len(res.Errors) == 0 || res.Errors[0].Field != "workspaceId" {
		t.Fatalf("expected workspaceId validation error, got %+v", res)
	}
}

func TestProjectManagerSaveProjectOwnerInRootStore(t *testing.T) {
	files := monorepoFixture()
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	_ = pm.Load()

	res, err := pm.SaveProfile(RunProfile{
		ID: "project-note", Name: "Repo Check", Type: ProfileTypeSingle, Command: "echo ok", WorkspaceID: "project",
	})
	if err != nil || !res.Valid {
		t.Fatalf("SaveProfile() err=%v res=%+v", err, res)
	}
	raw := files["/repo/.firn/run-profiles.json"]
	var pf ProfilesFile
	if err := json.Unmarshal(raw, &pf); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(pf.Profiles) != 1 || pf.Profiles[0].WorkspaceID != "project" {
		t.Fatalf("explicit project owner was not preserved: %+v", pf.Profiles)
	}
}

func TestProjectManagerSaveRejectsCrossWorkspaceDuplicateID(t *testing.T) {
	files := monorepoFixture()
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	_ = pm.Load()

	res, err := pm.SaveProfile(RunProfile{
		ID: "shared-custom", Name: "Frontend", Type: ProfileTypeSingle, Command: "npm test", WorkspaceID: "frontend",
	})
	if err != nil || !res.Valid {
		t.Fatalf("first SaveProfile() err=%v res=%+v", err, res)
	}
	res, err = pm.SaveProfile(RunProfile{
		ID: "shared-custom", Name: "Python", Type: ProfileTypeSingle, Command: "pytest", WorkspaceID: "backend/python",
	})
	if err != nil {
		t.Fatalf("second SaveProfile() returned unexpected transport error: %v", err)
	}
	if res.Valid || len(res.Errors) == 0 || res.Errors[0].Field != "id" {
		t.Fatalf("expected duplicate id validation error, got %+v", res)
	}
}

func TestProjectManagerPinRoutesToOwningWorkspace(t *testing.T) {
	files := monorepoFixture()
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	_ = pm.Load()

	frontendDevID := scopedDetectedID("frontend", "package.json", "dev")
	if err := pm.PinProfile(frontendDevID); err != nil {
		t.Fatalf("PinProfile() error: %v", err)
	}
	raw := files["/repo/frontend/.firn/run-profiles.json"]
	if raw == nil || !strings.Contains(string(raw), frontendDevID) {
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
	if findProfile(pm.GetAllProfiles(), scopedDetectedID("frontend", "package.json", "lint")) == nil {
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
	if findProfile(all, scopedDetectedID("backend/python", "pyproject.toml", "test")) == nil {
		t.Error("python profile missing after re-detect")
	}
	if findProfile(all, scopedDetectedID("frontend", "package.json", "dev")) == nil {
		t.Error("frontend profile should be unaffected")
	}
	if len(all) != 8 {
		t.Errorf("expected 8 profiles, got %d", len(all))
	}
}

// hasWarningContaining reports whether any warning mentions substr.
func hasWarningContaining(warnings []string, substr string) bool {
	for _, w := range warnings {
		if strings.Contains(w, substr) {
			return true
		}
	}
	return false
}

// Detector warnings follow re-detection in Warnings() (logged), and never reach
// the snapshot: the panel notice carries store-related load issues only.
func TestProjectManagerWarningsDropDetectorWarningAfterRedetect(t *testing.T) {
	files := monorepoFixture()
	valid := files["/repo/frontend/package.json"]
	files["/repo/frontend/package.json"] = []byte("{ not valid json")
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	if err := pm.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if got := pm.Warnings(); !hasWarningContaining(got, "package.json") {
		t.Fatalf("expected a package.json warning in Warnings() after Load, got %q", got)
	}
	if got := pm.Snapshot().LoadWarnings; hasWarningContaining(got, "package.json") {
		t.Errorf("snapshot carries a detector warning: %q", got)
	}

	files["/repo/frontend/package.json"] = valid
	if !pm.HandleFileChange("/repo/frontend/package.json") {
		t.Fatal("expected HandleFileChange to report a config change")
	}
	if got := pm.Warnings(); hasWarningContaining(got, "package.json") {
		t.Errorf("Warnings() still carries the stale package.json warning: %q", got)
	}
	if got := pm.Snapshot().LoadWarnings; hasWarningContaining(got, "package.json") {
		t.Errorf("snapshot carries a detector warning: %q", got)
	}
}

// The reverse: a file that breaks after Load surfaces its warning in Warnings()
// on the next re-detection, again without a Reload, and still not in the snapshot.
func TestProjectManagerWarningsPickUpNewDetectorWarningAfterRedetect(t *testing.T) {
	files := monorepoFixture()
	pm := NewProjectManager(newProjectTestFS(files), "/repo")
	if err := pm.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if got := pm.Snapshot().LoadWarnings; len(got) != 0 {
		t.Fatalf("expected no warnings after a clean Load, got %q", got)
	}

	files["/repo/frontend/package.json"] = []byte("{ not valid json")
	if !pm.HandleFileChange("/repo/frontend/package.json") {
		t.Fatal("expected HandleFileChange to report a config change")
	}
	if got := pm.Warnings(); !hasWarningContaining(got, "package.json") {
		t.Errorf("Warnings() is missing the new package.json warning: %q", got)
	}
	if got := pm.Snapshot().LoadWarnings; hasWarningContaining(got, "package.json") {
		t.Errorf("snapshot carries a detector warning: %q", got)
	}
}

// A prune that cannot rewrite the recency sidecar is a store-related issue: it
// reaches the snapshot and names the workspace by its display name.
func TestProjectManagerPruneFailureWarningNamesWorkspace(t *testing.T) {
	files := monorepoFixture()
	stale, err := json.Marshal(RecencyFile{Version: recencyFileVersion, Recency: map[string]int64{"gone": 1}})
	if err != nil {
		t.Fatal(err)
	}
	files["/repo/frontend/.firn/run-recency.json"] = stale
	fsys := newProjectTestFS(files)
	fsys.WriteFileFunc = func(string, []byte, fs.FileMode) error { return fs.ErrPermission }
	pm := NewProjectManager(fsys, "/repo")
	if err := pm.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	var name string
	for _, p := range pm.GetAllProfiles() {
		if p.WorkspaceID == "frontend" {
			name = p.WorkspaceName
			break
		}
	}
	if name == "" || name == "frontend" {
		t.Fatalf("fixture must give the frontend workspace a display name distinct from its ID, got %q", name)
	}
	want := fmt.Sprintf("workspace %q: could not prune stale profile state: ", name)
	if got := pm.Snapshot().LoadWarnings; len(got) != 1 || !strings.HasPrefix(got[0], want) {
		t.Fatalf("want one prune warning starting with %q, got %q", want, got)
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
	if findProfile(all, scopedDetectedID("root:go", "go.mod", "build")) == nil {
		t.Error("go profiles should survive a corrupt frontend store")
	}
	if findProfile(all, scopedDetectedID("backend/python", "pyproject.toml", "test")) == nil {
		t.Error("python profiles should survive a corrupt frontend store")
	}
	// The corrupt unit still contributes detected profiles (only its saved
	// store failed to load).
	if findProfile(all, scopedDetectedID("frontend", "package.json", "dev")) == nil {
		t.Error("frontend detected profiles should still show despite the corrupt store")
	}
	// The failure is surfaced as a warning, not swallowed.
	if len(pm.Warnings()) == 0 {
		t.Error("expected a warning for the corrupt frontend store")
	}
	// The snapshot hydrates the panel with the same warnings.
	if got, want := pm.Snapshot().LoadWarnings, pm.Warnings(); !reflect.DeepEqual(got, want) {
		t.Errorf("snapshot load warnings = %q, want %q", got, want)
	}
}

func TestProjectManagerAdoptAndSnapshot(t *testing.T) {
	files := monorepoFixture()
	m := NewProjectManager(newProjectTestFS(files), "/repo")
	if err := m.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	all := m.GetAllProfiles()
	if len(all) == 0 {
		t.Fatal("fixture produced no profiles")
	}
	id := all[0].ID

	if err := m.AdoptProfile(id); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if err := m.RecordRun(id, 12345); err != nil {
		t.Fatalf("record run: %v", err)
	}

	snap := m.Snapshot()
	if len(snap.Profiles) != len(all) {
		t.Errorf("snapshot profiles = %d, want %d", len(snap.Profiles), len(all))
	}
	st, ok := snap.ProfileState[id]
	if !ok || !st.Adopted || st.LastRunAt != 12345 {
		t.Errorf("snapshot state[%s] = %+v, want adopted+ts", id, st)
	}

	if err := m.UnadoptProfile(id); err != nil {
		t.Fatalf("unadopt: %v", err)
	}
	if m.Snapshot().ProfileState[id].Adopted {
		t.Error("expected adopted=false after unadopt")
	}
}

func TestProjectManagerAdoptPersistsToOwningStoreFile(t *testing.T) {
	files := monorepoFixture()
	m := NewProjectManager(newProjectTestFS(files), "/repo")
	if err := m.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	// Pick a profile that is deterministically owned by the "frontend" workspace.
	id := scopedDetectedID("frontend", "package.json", "dev")
	if findProfile(m.GetAllProfiles(), id) == nil {
		t.Fatalf("fixture missing expected frontend dev profile %q", id)
	}

	if err := m.AdoptProfile(id); err != nil {
		t.Fatalf("AdoptProfile(%q): %v", id, err)
	}
	if err := m.RecordRun(id, 777); err != nil {
		t.Fatalf("RecordRun(%q, 777): %v", id, err)
	}

	// --- Adoption persists to the OWNING workspace's profiles file. ---
	raw, ok := files["/repo/frontend/.firn/run-profiles.json"]
	if !ok {
		t.Fatal("expected AdoptProfile to write /repo/frontend/.firn/run-profiles.json")
	}
	var pf ProfilesFile
	if err := json.Unmarshal(raw, &pf); err != nil {
		t.Fatalf("unmarshal frontend store: %v", err)
	}
	if pf.Version != 3 {
		t.Errorf("frontend store version = %d, want 3", pf.Version)
	}
	st, exists := pf.ProfileState[id]
	if !exists {
		t.Fatalf("id %q not found in frontend store ProfileState", id)
	}
	if !st.Adopted {
		t.Errorf("ProfileState[%q].Adopted = false, want true", id)
	}
	// Recency must NOT bloat the profiles file — it lives in the sidecar.
	if st.LastRunAt != 0 {
		t.Errorf("profiles file must not carry recency; ProfileState[%q].LastRunAt = %d", id, st.LastRunAt)
	}

	// --- Recency persists to the OWNING workspace's recency sidecar. ---
	recRaw, ok := files["/repo/frontend/.firn/run-recency.json"]
	if !ok {
		t.Fatal("expected RecordRun to write /repo/frontend/.firn/run-recency.json")
	}
	var rf RecencyFile
	if err := json.Unmarshal(recRaw, &rf); err != nil {
		t.Fatalf("unmarshal frontend recency sidecar: %v", err)
	}
	if rf.Recency[id] != 777 {
		t.Errorf("recency sidecar[%q] = %d, want 777", id, rf.Recency[id])
	}

	// --- Assert the state did NOT leak into a different workspace's store file. ---
	otherRaw, leaked := files["/repo/backend/python/.firn/run-profiles.json"]
	if leaked {
		var other ProfilesFile
		if err := json.Unmarshal(otherRaw, &other); err == nil {
			if _, found := other.ProfileState[id]; found {
				t.Errorf("frontend profile %q must not appear in backend/python store", id)
			}
		}
	}
	// Also confirm the root store (if written) does not contain the id.
	if rootRaw, written := files["/repo/.firn/run-profiles.json"]; written {
		var root ProfilesFile
		if err := json.Unmarshal(rootRaw, &root); err == nil {
			if _, found := root.ProfileState[id]; found {
				t.Errorf("frontend profile %q must not appear in root store", id)
			}
		}
	}
}

func TestProjectManagerAdoptUnknownIDErrors(t *testing.T) {
	m := NewProjectManager(newProjectTestFS(monorepoFixture()), "/repo")
	if err := m.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if err := m.AdoptProfile("nope-not-a-real-id"); err == nil {
		t.Error("expected error adopting unknown id")
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

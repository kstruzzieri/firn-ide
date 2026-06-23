package runprofile

import (
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

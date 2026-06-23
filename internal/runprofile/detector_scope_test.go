package runprofile

import (
	"firn/internal/filesystem"
	"io/fs"
	"testing"
)

func scopeTestFS(files map[string][]byte) *filesystem.Mock {
	return &filesystem.Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			if d, ok := files[path]; ok {
				return d, nil
			}
			return nil, fs.ErrNotExist
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			if _, ok := files[path]; ok {
				return mockFileInfo{name: path}, nil
			}
			return nil, fs.ErrNotExist
		},
	}
}

func TestDetectorScopeScopesIDsAndStampsOwnership(t *testing.T) {
	files := map[string][]byte{
		"/repo/frontend/package.json": []byte(`{"scripts":{"dev":"vite"}}`),
	}
	d := NewDetector(scopeTestFS(files), "/repo/frontend")
	d.SetScope(MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"})

	profiles := d.DetectAll()
	if len(profiles) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(profiles))
	}
	p := profiles[0]
	if p.ID != "detected-frontend-package-json-dev" {
		t.Errorf("scoped ID = %q", p.ID)
	}
	if p.WorkspaceID != "frontend" || p.WorkspaceRelDir != "frontend" || p.WorkingDir != "frontend" {
		t.Errorf("ownership not stamped: %+v", p)
	}
}

func TestDetectorUnscopedKeepsLegacyIDs(t *testing.T) {
	files := map[string][]byte{
		"/repo/package.json": []byte(`{"scripts":{"dev":"vite"}}`),
	}
	d := NewDetector(scopeTestFS(files), "/repo")
	profiles := d.DetectAll()
	if len(profiles) != 1 || profiles[0].ID != "detected-package-json-dev" {
		t.Fatalf("unscoped detection changed: %+v", profiles)
	}
	if profiles[0].WorkspaceID != "" {
		t.Errorf("unscoped profile must not be stamped: %+v", profiles[0])
	}
}

package workspace

import (
	"firn/internal/filesystem"
	"io/fs"
	"reflect"
	"strings"
	"testing"
)

// fsFromPaths builds a mock filesystem from a set of file paths. Intermediate
// directories are inferred. ReadDir returns immediate children (dirs + files).
func fsFromPaths(files ...string) *filesystem.Mock {
	fileSet := map[string]bool{}
	for _, f := range files {
		fileSet[f] = true
	}
	return &filesystem.Mock{
		ReadDirFunc: func(dir string) ([]fs.DirEntry, error) {
			dir = strings.TrimSuffix(dir, "/")
			childDirs := map[string]bool{}
			var entries []fs.DirEntry
			for f := range fileSet {
				if !strings.HasPrefix(f, dir+"/") {
					continue
				}
				rest := strings.TrimPrefix(f, dir+"/")
				parts := strings.SplitN(rest, "/", 2)
				if len(parts) == 1 {
					entries = append(entries, &mockEntry{name: parts[0], dir: false})
				} else {
					childDirs[parts[0]] = true
				}
			}
			for d := range childDirs {
				entries = append(entries, &mockEntry{name: d, dir: true})
			}
			return entries, nil
		},
	}
}

type mockEntry struct {
	name string
	dir  bool
}

func (e *mockEntry) Name() string               { return e.name }
func (e *mockEntry) IsDir() bool                { return e.dir }
func (e *mockEntry) Type() fs.FileMode          { return 0 }
func (e *mockEntry) Info() (fs.FileInfo, error) { return nil, nil }

func TestDetectWorkspaces(t *testing.T) {
	const root = "/repo"
	project := WorkspaceDef{ID: "project", Name: "Project", RelDir: "", Type: TypeProject, Accent: "project"}
	tests := []struct {
		name  string
		files []string
		want  []WorkspaceDef
	}{
		{
			name:  "empty repo yields only project",
			files: []string{"/repo/README.md"},
			want:  []WorkspaceDef{project},
		},
		{
			name:  "frontend subdir",
			files: []string{"/repo/frontend/package.json"},
			want: []WorkspaceDef{
				project,
				{ID: "frontend", Name: "Frontend", RelDir: "frontend", Type: TypeFrontend, Accent: "blue"},
			},
		},
		{
			name:  "root go.mod is a typed entry beside project",
			files: []string{"/repo/go.mod"},
			want: []WorkspaceDef{
				project,
				{ID: "root:go", Name: "Go", RelDir: "", Type: TypeGo, Accent: "cyan"},
			},
		},
		{
			name: "nested depth-2 go and python",
			files: []string{
				"/repo/backend/go/go.mod",
				"/repo/backend/py/pyproject.toml",
			},
			want: []WorkspaceDef{
				project,
				{ID: "backend/go", Name: "Go", RelDir: "backend/go", Type: TypeGo, Accent: "cyan"},
				{ID: "backend/py", Name: "Python", RelDir: "backend/py", Type: TypePython, Accent: "green"},
			},
		},
		{
			name:  "infra by docker-compose",
			files: []string{"/repo/infra/docker-compose.yml"},
			want: []WorkspaceDef{
				project,
				{ID: "infra", Name: "Infrastructure", RelDir: "infra", Type: TypeInfra, Accent: "purple"},
			},
		},
		{
			name:  "infra by .tf suffix",
			files: []string{"/repo/terraform/main.tf"},
			want: []WorkspaceDef{
				project,
				{ID: "terraform", Name: "Infrastructure", RelDir: "terraform", Type: TypeInfra, Accent: "purple"},
			},
		},
		{
			name:  "ignored dirs are skipped",
			files: []string{"/repo/node_modules/foo/package.json", "/repo/app/package.json"},
			want: []WorkspaceDef{
				project,
				{ID: "app", Name: "Frontend", RelDir: "app", Type: TypeFrontend, Accent: "blue"},
			},
		},
		{
			name: "depth-1 workspace with depth-2 child workspace yields both",
			files: []string{
				"/repo/backend/go.mod",
				"/repo/backend/api/go.mod",
			},
			want: []WorkspaceDef{
				project,
				{ID: "backend", Name: "Go (backend)", RelDir: "backend", Type: TypeGo, Accent: "cyan"},
				{ID: "backend/api", Name: "Go (backend/api)", RelDir: "backend/api", Type: TypeGo, Accent: "cyan"},
			},
		},
		{
			name:  "multiple root markers pick the highest priority",
			files: []string{"/repo/package.json", "/repo/go.mod"},
			want: []WorkspaceDef{
				project,
				{ID: "root:go", Name: "Go", RelDir: "", Type: TypeGo, Accent: "cyan"},
			},
		},
		{
			name:  "root marker id does not collide with matching subdir",
			files: []string{"/repo/package.json", "/repo/frontend/package.json"},
			want: []WorkspaceDef{
				project,
				{ID: "root:frontend", Name: "Frontend (root)", RelDir: "", Type: TypeFrontend, Accent: "blue"},
				{ID: "frontend", Name: "Frontend (frontend)", RelDir: "frontend", Type: TypeFrontend, Accent: "blue"},
			},
		},
		{
			name: "wails root: go.mod beats tooling package.json, frontend subdir distinct",
			files: []string{
				"/repo/go.mod",
				"/repo/package.json",
				"/repo/frontend/package.json",
			},
			want: []WorkspaceDef{
				project,
				{ID: "root:go", Name: "Go", RelDir: "", Type: TypeGo, Accent: "cyan"},
				{ID: "frontend", Name: "Frontend", RelDir: "frontend", Type: TypeFrontend, Accent: "blue"},
			},
		},
		{
			name: "hidden/dot dirs are skipped (e.g. .worktrees copies)",
			files: []string{
				"/repo/.worktrees/wt/package.json",
				"/repo/app/package.json",
			},
			want: []WorkspaceDef{
				project,
				{ID: "app", Name: "Frontend", RelDir: "app", Type: TypeFrontend, Accent: "blue"},
			},
		},
		{
			name: "two same-type subdirs get disambiguated names",
			files: []string{
				"/repo/web/package.json",
				"/repo/admin/package.json",
			},
			want: []WorkspaceDef{
				project,
				{ID: "admin", Name: "Frontend (admin)", RelDir: "admin", Type: TypeFrontend, Accent: "blue"},
				{ID: "web", Name: "Frontend (web)", RelDir: "web", Type: TypeFrontend, Accent: "blue"},
			},
		},
		{
			name: "frontend that ships a Dockerfile stays Frontend (infra never shadows a language)",
			files: []string{
				"/repo/frontend/package.json",
				"/repo/frontend/Dockerfile",
				"/repo/frontend/nginx.conf",
			},
			want: []WorkspaceDef{
				project,
				{ID: "frontend", Name: "Frontend", RelDir: "frontend", Type: TypeFrontend, Accent: "blue"},
			},
		},
		{
			name: "python service with a Dockerfile stays Python",
			files: []string{
				"/repo/api/pyproject.toml",
				"/repo/api/Dockerfile",
			},
			want: []WorkspaceDef{
				project,
				{ID: "api", Name: "Python", RelDir: "api", Type: TypePython, Accent: "green"},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DetectWorkspaces(fsFromPaths(tc.files...), root)
			if err != nil {
				t.Fatalf("DetectWorkspaces returned error: %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("mismatch\n got: %+v\nwant: %+v", got, tc.want)
			}
		})
	}
}

package provision

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// PythonDeps are the injected, side-effecting operations PythonProvisioner needs.
type PythonDeps struct {
	// LookPath resolves an executable (used to detect "uv"). Mirrors exec.LookPath.
	LookPath func(string) (string, error)
	// Fetch downloads+verifies+extracts one artifact into destDir. nil => defaultFetch (real download+unzip).
	Fetch func(ctx context.Context, a Artifact, destDir string) error
	// RunUV runs the uv binary (Task 6). nil disables the uv fast-path.
	RunUV func(ctx context.Context, uv string, args, env []string) error
}

// launchSpec is persisted as launch.json and is the install's commit marker.
type launchSpec struct {
	Path    string   `json:"path"`
	Args    []string `json:"args"`
	Version string   `json:"version"`
	Abs     bool     `json:"abs"` // true: Path absolute; false: Path relative to the version dir
}

// PythonProvisioner provisions basedpyright into <cacheRoot>/python/<version>/.
type PythonProvisioner struct {
	cacheRoot string
	goos      string
	goarch    string
	deps      PythonDeps
	mu        sync.Mutex // single-flight: one install at a time for this family
}

func NewPythonProvisioner(cacheRoot, goos, goarch string, deps PythonDeps) *PythonProvisioner {
	return &PythonProvisioner{cacheRoot: cacheRoot, goos: goos, goarch: goarch, deps: deps}
}

func (p *PythonProvisioner) Family() string { return "python" }

func (p *PythonProvisioner) versionDir() string {
	return filepath.Join(p.cacheRoot, "python", pythonCatalogEntry.Version)
}

// Resolve reads the committed launch.json (cache-only, no network).
func (p *PythonProvisioner) Resolve() Resolution {
	spec, err := readLaunchSpec(p.versionDir())
	if err != nil {
		return Resolution{State: StateMissing}
	}
	launchPath := spec.Path
	if !spec.Abs {
		launchPath = filepath.Join(p.versionDir(), spec.Path)
	}
	if _, err := os.Stat(launchPath); err != nil {
		return Resolution{State: StateMissing}
	}
	return Resolution{State: StateAvailable, Path: launchPath, Args: spec.Args, Version: spec.Version}
}

func (p *PythonProvisioner) Install(ctx context.Context, progress func(Progress)) Resolution {
	if progress == nil {
		progress = func(Progress) {}
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	if r := p.Resolve(); r.State == StateAvailable { // a concurrent installer may have finished
		return r
	}

	_, artifacts, ok := PlatformArtifacts("python", p.goos, p.goarch)
	if !ok {
		if uv, uerr := p.lookUV(); uerr == nil {
			return p.installViaUV(ctx, uv, progress)
		}
		return Resolution{State: StateUnsupported, Err: errors.New("no managed catalog entry for platform and uv not found")}
	}
	if uv, uerr := p.lookUV(); uerr == nil {
		if r := p.installViaUV(ctx, uv, progress); r.State == StateAvailable {
			return r
		}
		// fall through to manual on uv failure
	}
	return p.installManual(ctx, artifacts, progress)
}

func (p *PythonProvisioner) lookUV() (string, error) {
	if p.deps.LookPath == nil || p.deps.RunUV == nil {
		return "", errors.New("uv path disabled")
	}
	return p.deps.LookPath("uv")
}

// installViaUV is implemented in Task 6. Stub returns non-available so Install
// falls through to the manual path.
func (p *PythonProvisioner) installViaUV(ctx context.Context, uv string, progress func(Progress)) Resolution {
	// Task 6 implements this.
	return Resolution{State: StateOffline, Err: errors.New("uv path not yet implemented")}
}

// installManual downloads+verifies+unzips wheels into a staging dir, writes
// launch.json (relative paths), then atomically renames staging -> versionDir.
func (p *PythonProvisioner) installManual(ctx context.Context, artifacts []Artifact, progress func(Progress)) Resolution {
	progress(Progress{Phase: "download", Pct: 0})
	parent := filepath.Dir(p.versionDir())
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return Resolution{State: StateOffline, Err: err}
	}
	staging, err := os.MkdirTemp(parent, ".staging-*")
	if err != nil {
		return Resolution{State: StateOffline, Err: err}
	}
	defer os.RemoveAll(staging) // no-op after successful rename

	for i, a := range artifacts {
		if err := p.fetch(ctx, a, staging); err != nil {
			var ce *ChecksumError
			if errors.As(err, &ce) {
				return Resolution{State: StateChecksumFailed, Err: err}
			}
			return Resolution{State: StateOffline, Err: err}
		}
		progress(Progress{Phase: "extract", Pct: (i + 1) * 100 / len(artifacts)})
	}

	nodeRel, jsRel, err := manualLaunchTargets(staging, p.goos)
	if err != nil {
		return Resolution{State: StateOffline, Err: err}
	}
	spec := launchSpec{Path: nodeRel, Args: []string{jsRel, "--stdio"}, Version: pythonCatalogEntry.Version, Abs: false}
	if err := writeLaunchSpec(staging, spec); err != nil {
		return Resolution{State: StateOffline, Err: err}
	}

	// ponytail: RemoveAll-then-Rename has a tiny non-atomic gap — a crash between
	// the two leaves no versionDir (recoverable by re-install). versionDir is
	// version-pinned so this normally only clears a prior partial/corrupt dir.
	// Upgrade path: rename old aside, rename staging in, then RemoveAll the aside.
	_ = os.RemoveAll(p.versionDir()) // clear any partial prior dir
	if err := os.Rename(staging, p.versionDir()); err != nil {
		return Resolution{State: StateOffline, Err: err}
	}
	progress(Progress{Phase: "done", Pct: 100})
	return p.Resolve()
}

func (p *PythonProvisioner) fetch(ctx context.Context, a Artifact, destDir string) error {
	if p.deps.Fetch != nil {
		return p.deps.Fetch(ctx, a, destDir)
	}
	return defaultFetch(ctx, a, destDir)
}

// manualLaunchTargets locates the node binary and langserver entry inside an
// extracted staging dir, returning their paths RELATIVE to staging.
func manualLaunchTargets(staging, goos string) (nodeRel, jsRel string, err error) {
	jsRel = filepath.Join("basedpyright", "langserver.index.js")
	if _, statErr := os.Stat(filepath.Join(staging, jsRel)); statErr != nil {
		return "", "", errors.New("basedpyright langserver entry not found after extract")
	}
	nodeName := "node"
	if goos == "windows" {
		nodeName = "node.exe"
	}
	found, ferr := findFile(staging, nodeName)
	if ferr != nil || found == "" {
		return "", "", errors.New("node binary not found after extract")
	}
	rel, relErr := filepath.Rel(staging, found)
	if relErr != nil {
		return "", "", relErr
	}
	return rel, jsRel, nil
}

func findFile(root, name string) (string, error) {
	var hit string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && d.Name() == name {
			hit = path
			return filepath.SkipAll
		}
		return nil
	})
	return hit, err
}

func readLaunchSpec(dir string) (launchSpec, error) {
	var s launchSpec
	b, err := os.ReadFile(filepath.Join(dir, "launch.json"))
	if err != nil {
		return s, err
	}
	err = json.Unmarshal(b, &s)
	return s, err
}

func writeLaunchSpec(dir string, s launchSpec) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "launch.json"), b, 0o644)
}

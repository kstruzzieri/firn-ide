package provision

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// RustDeps are the injected, side-effecting operations RustProvisioner needs.
type RustDeps struct {
	// Fetch downloads+verifies+extracts one archive-binary artifact into destDir,
	// leaving the runnable rust-analyzer binary there. nil => defaultRustFetch.
	Fetch func(ctx context.Context, a Artifact, destDir string) error
}

// RustProvisioner provisions rust-analyzer into <cacheRoot>/rust/<version>/.
// rust-analyzer ships one self-contained native binary per platform (a gzipped
// binary on macOS/Linux, a zip on Windows), so there is no separate runtime.
type RustProvisioner struct {
	cacheRoot string
	goos      string
	goarch    string
	deps      RustDeps
	mu        sync.Mutex // single-flight: one install at a time for this family
}

func NewRustProvisioner(cacheRoot, goos, goarch string, deps RustDeps) *RustProvisioner {
	return &RustProvisioner{cacheRoot: cacheRoot, goos: goos, goarch: goarch, deps: deps}
}

func (p *RustProvisioner) Family() string { return "rust" }

func (p *RustProvisioner) versionDir() string {
	return filepath.Join(p.cacheRoot, "rust", rustCatalogEntry.Version)
}

// Resolve reads the committed launch.json (cache-only, no network).
func (p *RustProvisioner) Resolve() Resolution {
	return resolveCached(p.versionDir())
}

// Install downloads+verifies+extracts the platform binary into a staging dir,
// writes launch.json (relative path), then atomically renames staging ->
// versionDir.
func (p *RustProvisioner) Install(ctx context.Context, progress func(Progress)) Resolution {
	if progress == nil {
		progress = func(Progress) {}
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	if r := p.Resolve(); r.State == StateAvailable { // a concurrent installer may have finished
		return r
	}

	_, artifacts, ok := PlatformArtifacts("rust", p.goos, p.goarch)
	if !ok {
		return Resolution{State: StateUnsupported, Err: errors.New("no managed rust-analyzer binary for platform")}
	}

	progress(Progress{Phase: "download", Pct: 0})
	parent := filepath.Dir(p.versionDir())
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return Resolution{State: StateOffline, Err: err}
	}
	staging, err := os.MkdirTemp(parent, ".staging-*")
	if err != nil {
		return Resolution{State: StateOffline, Err: err}
	}
	defer func() { _ = os.RemoveAll(staging) }() // no-op after successful rename

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

	binName := "rust-analyzer"
	if p.goos == "windows" {
		binName += ".exe"
	}
	found, ferr := findFile(staging, binName)
	if ferr != nil || found == "" {
		return Resolution{State: StateOffline, Err: errors.New("rust-analyzer binary not found after extract")}
	}
	if err := os.Chmod(found, 0o755); err != nil {
		return Resolution{State: StateOffline, Err: err}
	}
	rel, relErr := filepath.Rel(staging, found)
	if relErr != nil {
		return Resolution{State: StateOffline, Err: relErr}
	}
	// rust-analyzer serves LSP over stdio by default, so it needs no launch args.
	spec := launchSpec{Path: rel, Args: nil, Version: rustCatalogEntry.Version, Abs: false}
	if err := writeLaunchSpec(staging, spec); err != nil {
		return Resolution{State: StateOffline, Err: err}
	}

	_ = os.RemoveAll(p.versionDir()) // clear any partial prior dir
	if err := os.Rename(staging, p.versionDir()); err != nil {
		return Resolution{State: StateOffline, Err: err}
	}
	progress(Progress{Phase: "done", Pct: 100})
	return p.Resolve()
}

func (p *RustProvisioner) fetch(ctx context.Context, a Artifact, destDir string) error {
	if p.deps.Fetch != nil {
		return p.deps.Fetch(ctx, a, destDir)
	}
	return defaultRustFetch(ctx, a, destDir)
}

// defaultRustFetch downloads+verifies one archive-binary artifact and extracts
// the rust-analyzer executable into destDir. macOS/Linux artifacts are a bare
// gzipped binary (.gz); Windows artifacts are a zip containing rust-analyzer.exe.
func defaultRustFetch(ctx context.Context, a Artifact, destDir string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	tmp := filepath.Join(destDir, ".dl-"+a.SHA256[:12])
	if err := DownloadAndVerify(ctx, client, a.URL, a.SHA256, tmp); err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp) }()
	if strings.HasSuffix(a.URL, ".gz") {
		return GunzipFile(tmp, filepath.Join(destDir, "rust-analyzer"))
	}
	return UnzipWheel(tmp, destDir) // .zip (Windows) -> rust-analyzer.exe
}

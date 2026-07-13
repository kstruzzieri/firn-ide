package provision

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// TypeScriptDeps are the injected, side-effecting operations the provisioner needs.
type TypeScriptDeps struct {
	// Fetch downloads+verifies+extracts one artifact into destDir, laying it out
	// at its final location (node runtime, node_modules/typescript-language-server,
	// node_modules/typescript). nil => defaultTypeScriptFetch.
	Fetch func(ctx context.Context, a Artifact, destDir string) error
}

// TypeScriptProvisioner provisions typescript-language-server into
// <cacheRoot>/typescript/<version>/. It bundles the Node runtime plus the
// server and the TypeScript package it drives, all as pinned artifacts, and
// launches `node <cli.mjs> --stdio`.
type TypeScriptProvisioner struct {
	cacheRoot string
	goos      string
	goarch    string
	deps      TypeScriptDeps
	mu        sync.Mutex // single-flight: one install at a time for this family
}

func NewTypeScriptProvisioner(cacheRoot, goos, goarch string, deps TypeScriptDeps) *TypeScriptProvisioner {
	return &TypeScriptProvisioner{cacheRoot: cacheRoot, goos: goos, goarch: goarch, deps: deps}
}

func (p *TypeScriptProvisioner) Family() string { return "typescript" }

func (p *TypeScriptProvisioner) versionDir() string {
	return filepath.Join(p.cacheRoot, "typescript", typescriptCatalogEntry.Version)
}

// Resolve reads the committed launch.json (cache-only, no network).
func (p *TypeScriptProvisioner) Resolve() Resolution {
	return resolveCached(p.versionDir())
}

// Install downloads+verifies+extracts the node runtime and the two npm
// packages into a staging dir, writes launch.json (relative paths), then
// atomically renames staging -> versionDir.
func (p *TypeScriptProvisioner) Install(ctx context.Context, progress func(Progress)) Resolution {
	if progress == nil {
		progress = func(Progress) {}
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	if r := p.Resolve(); r.State == StateAvailable { // a concurrent installer may have finished
		return r
	}

	_, artifacts, ok := PlatformArtifacts("typescript", p.goos, p.goarch)
	if !ok {
		return Resolution{State: StateUnsupported, Err: errors.New("no managed node runtime for platform")}
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

	nodeRel, cliRel, err := typescriptLaunchTargets(staging, p.goos)
	if err != nil {
		return Resolution{State: StateOffline, Err: err}
	}
	spec := launchSpec{Path: nodeRel, ScriptRel: cliRel, Args: []string{"--stdio"}, Version: typescriptCatalogEntry.Version, Abs: false}
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

func (p *TypeScriptProvisioner) fetch(ctx context.Context, a Artifact, destDir string) error {
	if p.deps.Fetch != nil {
		return p.deps.Fetch(ctx, a, destDir)
	}
	return defaultTypeScriptFetch(ctx, a, destDir)
}

// typescriptLaunchTargets locates the node binary and the language-server entry
// inside an extracted staging dir, returning their paths RELATIVE to staging.
// It also verifies the TypeScript package is present, since the server resolves
// it at runtime and would otherwise start but produce no diagnostics.
func typescriptLaunchTargets(staging, goos string) (nodeRel, cliRel string, err error) {
	cliRel = filepath.Join("node_modules", "typescript-language-server", "lib", "cli.mjs")
	if _, statErr := os.Stat(filepath.Join(staging, cliRel)); statErr != nil {
		return "", "", errors.New("typescript-language-server entry (cli.mjs) not found after extract")
	}
	if _, statErr := os.Stat(filepath.Join(staging, "node_modules", "typescript")); statErr != nil {
		return "", "", errors.New("typescript package not found after extract")
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
	return rel, cliRel, nil
}

// defaultTypeScriptFetch downloads+verifies one artifact and extracts it to its
// final layout: the node runtime wheel unzips into destDir; the npm tarballs
// untar (dropping their "package/" prefix) into
// node_modules/{typescript-language-server,typescript}.
func defaultTypeScriptFetch(ctx context.Context, a Artifact, destDir string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	tmp := filepath.Join(destDir, ".dl-"+a.SHA256[:12])
	if err := DownloadAndVerify(ctx, client, a.URL, a.SHA256, tmp); err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp) }()

	switch a.Kind {
	case "node-wheel":
		return UnzipWheel(tmp, destDir)
	case "npm-server":
		return UntarGz(tmp, filepath.Join(destDir, "node_modules", "typescript-language-server"), 1)
	case "npm-typescript":
		return UntarGz(tmp, filepath.Join(destDir, "node_modules", "typescript"), 1)
	default:
		return errors.New("unknown typescript artifact kind: " + a.Kind)
	}
}

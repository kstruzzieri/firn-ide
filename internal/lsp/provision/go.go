package provision

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// goplsModule/goplsVersion pin the managed gopls install. gopls publishes no
// prebuilt binaries, so the only official distribution is `go install`; the
// version is a fixed tag, never a floating @latest.
const (
	goplsModule  = "golang.org/x/tools/gopls"
	goplsVersion = "v0.22.0"
)

// GoDeps are the injected, side-effecting operations GoProvisioner needs.
type GoDeps struct {
	// LookPath resolves the "go" toolchain. Mirrors exec.LookPath.
	LookPath func(string) (string, error)
	// RunGo runs the go binary (e.g. `go install`). nil disables managed install.
	RunGo func(ctx context.Context, goBin string, args, env []string) error
}

// GoProvisioner provisions gopls into <cacheRoot>/go/<version>/ via `go install`.
type GoProvisioner struct {
	cacheRoot string
	goos      string
	goarch    string
	deps      GoDeps
	mu        sync.Mutex // single-flight: one install at a time for this family
}

func NewGoProvisioner(cacheRoot, goos, goarch string, deps GoDeps) *GoProvisioner {
	return &GoProvisioner{cacheRoot: cacheRoot, goos: goos, goarch: goarch, deps: deps}
}

func (p *GoProvisioner) Family() string { return "go" }

func (p *GoProvisioner) versionDir() string {
	return filepath.Join(p.cacheRoot, "go", goplsVersion)
}

// Resolve reads the committed launch.json (cache-only, no network).
func (p *GoProvisioner) Resolve() Resolution {
	return resolveCached(p.versionDir())
}

// Install runs `go install golang.org/x/tools/gopls@<version>` with GOBIN
// pointed at a staging dir, then atomically renames staging -> versionDir. When
// no Go toolchain is present the family is unsupported (gopls ships no binary).
func (p *GoProvisioner) Install(ctx context.Context, progress func(Progress)) Resolution {
	if progress == nil {
		progress = func(Progress) {}
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	if r := p.Resolve(); r.State == StateAvailable { // a concurrent installer may have finished
		return r
	}

	goBin, err := p.lookGo()
	if err != nil {
		return Resolution{State: StateUnsupported, Err: errors.New("go toolchain not found: gopls has no prebuilt binary and requires `go install`")}
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

	binDir := filepath.Join(staging, "bin")
	// gopls is a self-contained, relocatable Go binary, so a shared module cache
	// (default GOPATH) is fine; only GOBIN is redirected into the managed dir.
	env := append(os.Environ(), "GOBIN="+binDir, "GOFLAGS=-mod=mod")
	args := []string{"install", goplsModule + "@" + goplsVersion}
	if err := p.deps.RunGo(ctx, goBin, args, env); err != nil {
		return Resolution{State: StateOffline, Err: err}
	}

	gopls := filepath.Join(binDir, "gopls")
	if p.goos == "windows" {
		gopls += ".exe"
	}
	if _, err := os.Stat(gopls); err != nil {
		return Resolution{State: StateOffline, Err: errors.New("go install produced no gopls binary")}
	}
	rel, relErr := filepath.Rel(staging, gopls)
	if relErr != nil {
		return Resolution{State: StateOffline, Err: relErr}
	}
	// gopls serves LSP over stdio by default, so it needs no launch args.
	spec := launchSpec{Path: rel, Args: nil, Version: goplsVersion, Abs: false}
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

func (p *GoProvisioner) lookGo() (string, error) {
	if p.deps.LookPath == nil || p.deps.RunGo == nil {
		return "", errors.New("go install path disabled")
	}
	return p.deps.LookPath("go")
}

// goBinDir extracts the GOBIN value from a go-install env slice (shared by impl
// + test so they agree on the variable name).
func goBinDir(env []string) string {
	for _, kv := range env {
		if v, ok := strings.CutPrefix(kv, "GOBIN="); ok {
			return v
		}
	}
	return ""
}

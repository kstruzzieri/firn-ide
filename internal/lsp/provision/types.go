// Package provision downloads and caches pinned language servers under
// ~/.firn/servers/<family>/<version>/ so LSP works without any manual install.
// It never mutates the user's global env or PATH.
package provision

import "context"

// ResolveState classifies a managed-server lookup so the manager can map it to
// a ServerStatus setup state without re-deriving anything.
type ResolveState string

const (
	StateMissing        ResolveState = "missing"           // not installed, install not yet attempted
	StateAvailable      ResolveState = "managed-available" // installed + verified; Path/Args set
	StateInstalling     ResolveState = "installing"        // install in flight
	StateOffline        ResolveState = "offline"           // network/download failure
	StateChecksumFailed ResolveState = "checksum-failed"   // artifact hash mismatch (security stop)
	StateUnsupported    ResolveState = "unsupported"       // no provisioner/catalog entry for this platform
)

// Resolution is the outcome of Resolve or Install.
type Resolution struct {
	State   ResolveState
	Path    string   // launch command (cached node, or basedpyright-langserver shim)
	Args    []string // launch args (e.g. [<langserver.index.js>, "--stdio"] or ["--stdio"])
	Version string
	Err     error // populated for offline/checksum-failed/unsupported
}

// Progress reports coarse install progress. Phase is one of
// "download" | "verify" | "extract" | "done".
type Progress struct {
	Phase string
	Pct   int
}

// Provisioner provisions one server family into the managed cache.
type Provisioner interface {
	Family() string
	Resolve() Resolution // cache-only; never hits network
	Install(ctx context.Context, progress func(Progress)) Resolution
}

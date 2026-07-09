package provision

// ArtifactType describes how a family's server is packaged.
type ArtifactType string

const (
	// ArtifactWheelNode: a py3-none-any server wheel + a platform nodejs-wheel-binaries wheel.
	ArtifactWheelNode ArtifactType = "wheel-node"
	// ArtifactNpmNode: universal npm server + typescript tarballs + a platform node wheel.
	ArtifactNpmNode ArtifactType = "npm-node"
	// ArtifactArchiveBinary: one native server binary per platform, shipped as a
	// gzipped binary (.gz) or a zip, with no separate runtime.
	ArtifactArchiveBinary ArtifactType = "archive-binary"
)

// Artifact is one pinned downloadable. Pinned URL/SHA256/Version are
// configuration constants, not placeholder data.
type Artifact struct {
	Kind    string // "server-wheel" | "node-wheel" | "npm-server" | "npm-typescript" | "archive-binary"
	Package string // e.g. "basedpyright" / "nodejs-wheel-binaries" / "rust-analyzer"
	Version string // exact, no floating ranges
	URL     string // HTTPS download URL (pythonhosted / npm registry / github release)
	SHA256  string // hex digest; mismatch is a hard stop
	GOOS    string // "" = any platform (universal wheel/tarball)
	GOARCH  string
}

// CatalogEntry pins one family's managed install.
type CatalogEntry struct {
	Family       string
	Version      string
	ArtifactType ArtifactType
	Artifacts    []Artifact
}

var catalog = map[string]CatalogEntry{
	"python":     pythonCatalogEntry,
	"rust":       rustCatalogEntry,
	"typescript": typescriptCatalogEntry,
}

// PlatformArtifacts returns the catalog entry and the exact artifact set to
// fetch for family on goos/goarch. ok is false when the family or platform is
// unsupported for managed download (missing a required artifact for the shape).
func PlatformArtifacts(family, goos, goarch string) (CatalogEntry, []Artifact, bool) {
	entry, found := catalog[family]
	if !found {
		return CatalogEntry{}, nil, false
	}
	var out []Artifact
	for _, a := range entry.Artifacts {
		if (a.GOOS == "" && a.GOARCH == "") || (a.GOOS == goos && a.GOARCH == goarch) {
			out = append(out, a)
		}
	}
	if !platformComplete(entry.ArtifactType, out) {
		return entry, nil, false
	}
	return entry, out, true
}

// platformComplete reports whether the collected artifact set contains every
// piece the artifact type needs to launch on the target platform.
func platformComplete(t ArtifactType, arts []Artifact) bool {
	have := map[string]bool{}
	for _, a := range arts {
		have[a.Kind] = true
	}
	switch t {
	case ArtifactWheelNode:
		return have["server-wheel"] && have["node-wheel"]
	case ArtifactNpmNode:
		return have["npm-server"] && have["npm-typescript"] && have["node-wheel"]
	case ArtifactArchiveBinary:
		return have["archive-binary"]
	default:
		return false
	}
}

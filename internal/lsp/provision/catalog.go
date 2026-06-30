package provision

// ArtifactType describes how a family's server is packaged.
type ArtifactType string

const (
	// ArtifactWheelNode: a py3-none-any server wheel + a platform nodejs-wheel-binaries wheel.
	ArtifactWheelNode ArtifactType = "wheel-node"
)

// Artifact is one pinned downloadable. Pinned URL/SHA256/Version are
// configuration constants, not placeholder data.
type Artifact struct {
	Kind    string // "server-wheel" | "node-wheel"
	Package string // e.g. "basedpyright" / "nodejs-wheel-binaries"
	Version string // exact, no floating ranges
	URL     string // HTTPS files.pythonhosted.org URL
	SHA256  string // hex digest; mismatch is a hard stop
	GOOS    string // "" = any platform (universal wheel)
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
	"python": pythonCatalogEntry,
}

// PlatformArtifacts returns the catalog entry and the exact artifact set to
// fetch for family on goos/goarch. ok is false when the family or platform is
// unsupported (no universal server wheel + matching platform node wheel).
func PlatformArtifacts(family, goos, goarch string) (CatalogEntry, []Artifact, bool) {
	entry, found := catalog[family]
	if !found {
		return CatalogEntry{}, nil, false
	}
	var out []Artifact
	var haveServer, haveNode bool
	for _, a := range entry.Artifacts {
		switch {
		case a.GOOS == "" && a.GOARCH == "": // universal
			out = append(out, a)
			haveServer = haveServer || a.Kind == "server-wheel"
		case a.GOOS == goos && a.GOARCH == goarch:
			out = append(out, a)
			haveNode = haveNode || a.Kind == "node-wheel"
		}
	}
	if !haveServer || !haveNode {
		return entry, nil, false
	}
	return entry, out, true
}

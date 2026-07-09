package provision

// pythonCatalogEntry pins basedpyright (universal py3-none-any wheel) plus the
// shared nodejs-wheel-binaries runtime (see nodeWheelArtifacts). musl/Alpine
// falls through to the uv fast-path or a guidance card.
var pythonCatalogEntry = CatalogEntry{
	Family:       "python",
	Version:      "1.39.9",
	ArtifactType: ArtifactWheelNode,
	Artifacts: append([]Artifact{
		{
			Kind:    "server-wheel",
			Package: "basedpyright",
			Version: "1.39.9",
			URL:     "https://files.pythonhosted.org/packages/2a/d4/e1fa108710d0498a18c77b1e13897f31eab47c69aa8cfe2d2a4df746541e/basedpyright-1.39.9-py3-none-any.whl",
			SHA256:  "6b0837b9eba972c71895167ab9b127e6afdbc17abc92312e3f8d15ca82a5611c",
		},
	}, nodeWheelArtifacts...),
}

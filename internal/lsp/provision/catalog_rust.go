package provision

// rustCatalogEntry pins rust-analyzer's native release binaries per OS/arch.
// rust-analyzer publishes a self-contained executable per target — a gzipped
// binary (.gz) on macOS/Linux and a zip on Windows — so no separate runtime is
// bundled. The pinned tag is a dated rust-analyzer release (the project ships
// rolling releases; there is no semver line to track).
// ponytail: glibc-only linux binaries; add the -musl target if Alpine demand appears.
var rustCatalogEntry = CatalogEntry{
	Family:       "rust",
	Version:      "2026-07-06",
	ArtifactType: ArtifactArchiveBinary,
	Artifacts: []Artifact{
		{Kind: "archive-binary", Package: "rust-analyzer", Version: "2026-07-06", GOOS: "darwin", GOARCH: "arm64",
			URL:    "https://github.com/rust-lang/rust-analyzer/releases/download/2026-07-06/rust-analyzer-aarch64-apple-darwin.gz",
			SHA256: "0fb2229496105666460d22d062a55e154c862bb8004c464a38c6ffaff6fd68fe"},
		{Kind: "archive-binary", Package: "rust-analyzer", Version: "2026-07-06", GOOS: "darwin", GOARCH: "amd64",
			URL:    "https://github.com/rust-lang/rust-analyzer/releases/download/2026-07-06/rust-analyzer-x86_64-apple-darwin.gz",
			SHA256: "3a6bc5b42c27d3f8d308dacb25fdbe9bba0577be2970500cdb936e53c21c3496"},
		{Kind: "archive-binary", Package: "rust-analyzer", Version: "2026-07-06", GOOS: "linux", GOARCH: "arm64",
			URL:    "https://github.com/rust-lang/rust-analyzer/releases/download/2026-07-06/rust-analyzer-aarch64-unknown-linux-gnu.gz",
			SHA256: "7e2627d96c6f1614115d212b61fd5f8dc9279853054b800f2b023c883e3ae056"},
		{Kind: "archive-binary", Package: "rust-analyzer", Version: "2026-07-06", GOOS: "linux", GOARCH: "amd64",
			URL:    "https://github.com/rust-lang/rust-analyzer/releases/download/2026-07-06/rust-analyzer-x86_64-unknown-linux-gnu.gz",
			SHA256: "2fb596e12676e512de5dbf1c322dd591127ee089a1cca47995605593f2fc8850"},
		{Kind: "archive-binary", Package: "rust-analyzer", Version: "2026-07-06", GOOS: "windows", GOARCH: "arm64",
			URL:    "https://github.com/rust-lang/rust-analyzer/releases/download/2026-07-06/rust-analyzer-aarch64-pc-windows-msvc.zip",
			SHA256: "9429a8d2c6309b78bc8a944fdd3ac036fd3ec022266a92836cab02de56d69b65"},
		{Kind: "archive-binary", Package: "rust-analyzer", Version: "2026-07-06", GOOS: "windows", GOARCH: "amd64",
			URL:    "https://github.com/rust-lang/rust-analyzer/releases/download/2026-07-06/rust-analyzer-x86_64-pc-windows-msvc.zip",
			SHA256: "b046120af10d0cb7c735bbd377a53007d97048666fe967e95ea88a9fc177fa09"},
	},
}

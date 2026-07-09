package provision

// typescriptCatalogEntry pins typescript-language-server plus the TypeScript
// package it drives, both as universal npm tarballs, on the shared Node runtime
// (see nodeWheelArtifacts). typescript-language-server has no runtime npm
// dependencies of its own (it is a bundled single package), so the two tarballs
// laid out as node_modules/{typescript-language-server,typescript} are enough
// to launch it without running a package manager.
var typescriptCatalogEntry = CatalogEntry{
	Family:       "typescript",
	Version:      "5.3.0",
	ArtifactType: ArtifactNpmNode,
	Artifacts: append([]Artifact{
		{Kind: "npm-server", Package: "typescript-language-server", Version: "5.3.0",
			URL:    "https://registry.npmjs.org/typescript-language-server/-/typescript-language-server-5.3.0.tgz",
			SHA256: "398cacc17fff2108652e7b4050e3182008d17063246b3fea7dcf5fae2ce1560e"},
		{Kind: "npm-typescript", Package: "typescript", Version: "5.9.3",
			URL:    "https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz",
			SHA256: "10e108c9cf7d5f2879053dff18515fb405abf2ccef63eaaf017d9c571687a1d3"},
	}, nodeWheelArtifacts...),
}

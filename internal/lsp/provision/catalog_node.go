package provision

// nodeWheelArtifacts pins the nodejs-wheel-binaries runtime per supported
// OS/arch. Both the Python (basedpyright) and TypeScript
// (typescript-language-server) managed installs run on this bundled Node, so
// the pinned wheels live here and are shared by both catalog entries. Linux
// uses the glibc (manylinux) wheels; musl/Alpine falls through to a family fast
// path or a guidance card.
// ponytail: glibc-only linux node wheels; add musllinux entries if Alpine demand appears.
var nodeWheelArtifacts = []Artifact{
	{Kind: "node-wheel", Package: "nodejs-wheel-binaries", Version: "22.20.0", GOOS: "darwin", GOARCH: "arm64",
		URL:    "https://files.pythonhosted.org/packages/24/6d/333e5458422f12318e3c3e6e7f194353aa68b0d633217c7e89833427ca01/nodejs_wheel_binaries-22.20.0-py2.py3-none-macosx_11_0_arm64.whl",
		SHA256: "455add5ac4f01c9c830ab6771dbfad0fdf373f9b040d3aabe8cca9b6c56654fb"},
	{Kind: "node-wheel", Package: "nodejs-wheel-binaries", Version: "22.20.0", GOOS: "darwin", GOARCH: "amd64",
		URL:    "https://files.pythonhosted.org/packages/56/30/dcd6879d286a35b3c4c8f9e5e0e1bcf4f9e25fe35310fc77ecf97f915a23/nodejs_wheel_binaries-22.20.0-py2.py3-none-macosx_11_0_x86_64.whl",
		SHA256: "5d8c12f97eea7028b34a84446eb5ca81829d0c428dfb4e647e09ac617f4e21fa"},
	{Kind: "node-wheel", Package: "nodejs-wheel-binaries", Version: "22.20.0", GOOS: "linux", GOARCH: "arm64",
		URL:    "https://files.pythonhosted.org/packages/58/be/c7b2e7aa3bb281d380a1c531f84d0ccfe225832dfc3bed1ca171753b9630/nodejs_wheel_binaries-22.20.0-py2.py3-none-manylinux_2_17_aarch64.manylinux2014_aarch64.whl",
		SHA256: "7a2b0989194148f66e9295d8f11bc463bde02cbe276517f4d20a310fb84780ae"},
	{Kind: "node-wheel", Package: "nodejs-wheel-binaries", Version: "22.20.0", GOOS: "linux", GOARCH: "amd64",
		URL:    "https://files.pythonhosted.org/packages/3e/c5/8befacf4190e03babbae54cb0809fb1a76e1600ec3967ab8ee9f8fc85b65/nodejs_wheel_binaries-22.20.0-py2.py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
		SHA256: "b5c500aa4dc046333ecb0a80f183e069e5c30ce637f1c1a37166b2c0b642dc21"},
	{Kind: "node-wheel", Package: "nodejs-wheel-binaries", Version: "22.20.0", GOOS: "windows", GOARCH: "amd64",
		URL:    "https://files.pythonhosted.org/packages/b4/a9/c6a480259aa0d6b270aac2c6ba73a97444b9267adde983a5b7e34f17e45a/nodejs_wheel_binaries-22.20.0-py2.py3-none-win_amd64.whl",
		SHA256: "4bd658962f24958503541963e5a6f2cc512a8cb301e48a69dc03c879f40a28ae"},
	{Kind: "node-wheel", Package: "nodejs-wheel-binaries", Version: "22.20.0", GOOS: "windows", GOARCH: "arm64",
		URL:    "https://files.pythonhosted.org/packages/42/b1/6a4eb2c6e9efa028074b0001b61008c9d202b6b46caee9e5d1b18c088216/nodejs_wheel_binaries-22.20.0-py2.py3-none-win_arm64.whl",
		SHA256: "1fccac931faa210d22b6962bcdbc99269d16221d831b9a118bbb80fe434a60b8"},
}

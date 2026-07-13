package provision

import "testing"

func TestPlatformArtifacts_Rust_supported(t *testing.T) {
	for _, plat := range [][2]string{{"darwin", "arm64"}, {"darwin", "amd64"}, {"linux", "amd64"}, {"linux", "arm64"}, {"windows", "amd64"}, {"windows", "arm64"}} {
		entry, arts, ok := PlatformArtifacts("rust", plat[0], plat[1])
		if !ok {
			t.Fatalf("rust/%s/%s expected supported", plat[0], plat[1])
		}
		if entry.ArtifactType != ArtifactArchiveBinary {
			t.Errorf("rust artifact type = %q", entry.ArtifactType)
		}
		var bins int
		for _, a := range arts {
			if a.Kind == "archive-binary" {
				bins++
			}
			if a.URL == "" || a.SHA256 == "" || a.Version == "" {
				t.Errorf("rust artifact missing pinned field: %+v", a)
			}
			if a.GOOS != plat[0] || a.GOARCH != plat[1] {
				t.Errorf("rust artifact platform = %s/%s, want %s/%s", a.GOOS, a.GOARCH, plat[0], plat[1])
			}
		}
		if bins != 1 {
			t.Errorf("rust/%s/%s: got %d archive-binary artifacts, want 1", plat[0], plat[1], bins)
		}
	}
}

func TestPlatformArtifacts_Rust_unsupportedPlatform(t *testing.T) {
	if _, _, ok := PlatformArtifacts("rust", "plan9", "mips"); ok {
		t.Error("expected rust/plan9/mips unsupported")
	}
}

func TestPlatformArtifacts_TypeScript_supported(t *testing.T) {
	entry, arts, ok := PlatformArtifacts("typescript", "darwin", "arm64")
	if !ok {
		t.Fatal("typescript/darwin/arm64 expected supported")
	}
	if entry.ArtifactType != ArtifactNpmNode {
		t.Errorf("typescript artifact type = %q", entry.ArtifactType)
	}
	var server, tsc, node int
	for _, a := range arts {
		switch a.Kind {
		case "npm-server":
			server++
		case "npm-typescript":
			tsc++
		case "node-wheel":
			node++
		}
		if a.URL == "" || a.SHA256 == "" || a.Version == "" || a.Package == "" {
			t.Errorf("typescript artifact missing pinned field: %+v", a)
		}
	}
	if server != 1 || tsc != 1 || node != 1 {
		t.Errorf("got server=%d typescript=%d node=%d, want 1/1/1", server, tsc, node)
	}
}

func TestPlatformArtifacts_TypeScript_unsupportedPlatform(t *testing.T) {
	// No node wheel for plan9/mips -> incomplete -> unsupported.
	if _, _, ok := PlatformArtifacts("typescript", "plan9", "mips"); ok {
		t.Error("expected typescript/plan9/mips unsupported")
	}
}

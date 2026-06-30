package provision

import "testing"

func TestPlatformArtifacts_Python_supported(t *testing.T) {
	entry, arts, ok := PlatformArtifacts("python", "darwin", "arm64")
	if !ok {
		t.Fatal("expected python/darwin/arm64 supported")
	}
	if entry.Version != "1.39.9" {
		t.Errorf("version = %q, want 1.39.9", entry.Version)
	}
	var server, node int
	for _, a := range arts {
		switch a.Kind {
		case "server-wheel":
			server++
		case "node-wheel":
			node++
		}
		if a.SHA256 == "" || a.URL == "" || a.Package == "" || a.Version == "" {
			t.Errorf("artifact missing pinned field: %+v", a)
		}
	}
	if server != 1 || node != 1 {
		t.Errorf("got server=%d node=%d, want 1/1", server, node)
	}
}

func TestPlatformArtifacts_unsupported(t *testing.T) {
	if _, _, ok := PlatformArtifacts("python", "plan9", "mips"); ok {
		t.Error("expected plan9/mips unsupported")
	}
	if _, _, ok := PlatformArtifacts("ruby", "darwin", "arm64"); ok {
		t.Error("expected unknown family unsupported")
	}
}

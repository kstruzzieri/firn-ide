package provision

import (
	"strings"
	"testing"
)

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

func TestPlatformArtifacts_LinuxNodeWheelMatchesHostLibc(t *testing.T) {
	orig := hostLinuxLibc
	t.Cleanup(func() { hostLinuxLibc = orig })

	for _, tc := range []struct{ libc, wantTag string }{
		{"gnu", "manylinux"},
		{"musl", "musllinux"},
	} {
		hostLinuxLibc = func() string { return tc.libc }
		for _, arch := range []string{"amd64", "arm64"} {
			_, arts, ok := PlatformArtifacts("python", "linux", arch)
			if !ok {
				t.Fatalf("python/linux/%s libc=%s expected supported", arch, tc.libc)
			}
			var nodes []Artifact
			for _, a := range arts {
				if a.Kind == "node-wheel" {
					nodes = append(nodes, a)
				}
			}
			if len(nodes) != 1 {
				t.Fatalf("python/linux/%s libc=%s: got %d node wheels, want exactly 1", arch, tc.libc, len(nodes))
			}
			if !strings.Contains(nodes[0].URL, tc.wantTag) {
				t.Errorf("python/linux/%s libc=%s: node wheel URL %q missing %q", arch, tc.libc, nodes[0].URL, tc.wantTag)
			}
			if nodes[0].SHA256 == "" || nodes[0].Version == "" {
				t.Errorf("python/linux/%s libc=%s: node wheel missing pinned field: %+v", arch, tc.libc, nodes[0])
			}
		}
	}
}

func TestDetectLinuxLibc_returnsGnuOrMusl(t *testing.T) {
	got := detectLinuxLibc()
	if got != "gnu" && got != "musl" {
		t.Errorf("detectLinuxLibc() = %q, want gnu or musl", got)
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

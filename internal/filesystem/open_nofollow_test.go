package filesystem

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// Windows only grants SeCreateSymbolicLinkPrivilege under Developer Mode or
// elevation. Probe once so an unsupported host skips for exactly that reason and
// every other os.Symlink failure stays a hard failure.
var symlinkSupported = func() bool {
	dir, err := os.MkdirTemp("", "firn-symlink-probe")
	if err != nil {
		return false
	}
	defer func() { _ = os.RemoveAll(dir) }()
	target := filepath.Join(dir, "target")
	if err := os.Mkdir(target, 0o700); err != nil {
		return false
	}
	return os.Symlink(target, filepath.Join(dir, "link")) == nil
}()

func requireSymlinks(t *testing.T) {
	t.Helper()
	if !symlinkSupported {
		t.Skipf("symlink creation is unavailable on %s", runtime.GOOS)
	}
}

// This is the only test that proves openReadNoFollow itself refuses a link.
// Everything else in the tree reaches ErrUnsafePath through an Lstat type check
// several layers up, which would still pass if the no-follow open silently
// started traversing — so this must run on every platform that ships a real
// implementation, Windows included.
func TestOpenReadNoFollowRefusesSymlink(t *testing.T) {
	requireSymlinks(t)

	for _, tc := range []struct {
		name      string
		directory bool
		seed      func(t *testing.T, target string)
	}{
		{
			name: "file",
			seed: func(t *testing.T, target string) {
				if err := os.WriteFile(target, []byte("secret"), 0o600); err != nil {
					t.Fatalf("WriteFile: %v", err)
				}
			},
		},
		{
			name:      "directory",
			directory: true,
			seed: func(t *testing.T, target string) {
				if err := os.Mkdir(target, 0o700); err != nil {
					t.Fatalf("Mkdir: %v", err)
				}
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			target := filepath.Join(root, "target")
			tc.seed(t, target)
			link := filepath.Join(root, "link")
			if err := os.Symlink(target, link); err != nil {
				t.Fatalf("Symlink: %v", err)
			}

			file, err := openReadNoFollow(link, tc.directory)
			if file != nil {
				_ = file.Close()
			}
			// ErrSymlinkRefused, not merely ErrUnsafePath: the umbrella is also
			// what a downstream type check returns, so asserting it would not
			// distinguish "the open refused" from "something later noticed".
			if !errors.Is(err, ErrSymlinkRefused) {
				t.Fatalf("openReadNoFollow(%s) error = %v, want ErrSymlinkRefused", tc.name, err)
			}
			if !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("ErrSymlinkRefused must stay under the ErrUnsafePath umbrella, got %v", err)
			}
		})
	}
}

// The bounded readers are the callers that matter, so pin that a link is still
// refused once the refusal has travelled back up through them.
func TestBoundedReadsRefuseSymlinks(t *testing.T) {
	requireSymlinks(t)

	root := t.TempDir()
	target := filepath.Join(root, "target")
	if err := os.WriteFile(target, []byte("secret"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	fileLink := filepath.Join(root, "file-link")
	if err := os.Symlink(target, fileLink); err != nil {
		t.Fatalf("Symlink(file): %v", err)
	}
	targetDir := filepath.Join(root, "target-dir")
	if err := os.Mkdir(targetDir, 0o700); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	dirLink := filepath.Join(root, "dir-link")
	if err := os.Symlink(targetDir, dirLink); err != nil {
		t.Fatalf("Symlink(dir): %v", err)
	}

	if _, _, err := NewOS().ReadFileLimited(fileLink, 10); !errors.Is(err, ErrSymlinkRefused) {
		t.Fatalf("ReadFileLimited error = %v, want ErrSymlinkRefused", err)
	}
	if _, err := NewOS().ReadDirLimited(dirLink, 10); !errors.Is(err, ErrSymlinkRefused) {
		t.Fatalf("ReadDirLimited error = %v, want ErrSymlinkRefused", err)
	}
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("ReadFile(target): %v", err)
	}
	if string(data) != "secret" {
		t.Fatalf("symlink target was modified: %q", data)
	}
}

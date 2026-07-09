package provision

import (
	"os"
	"path/filepath"
)

// resolveCached reads the committed launch.json under versionDir and reports the
// managed server as available only when its launch target still exists on disk.
// It is the cache-only Resolve path shared by every family provisioner (never
// touches the network). A relative launchSpec.Path is joined to versionDir; an
// absolute one (uv/go-install shims that bake in absolute paths) is used as-is.
func resolveCached(versionDir string) Resolution {
	spec, err := readLaunchSpec(versionDir)
	if err != nil {
		return Resolution{State: StateMissing}
	}
	launchPath := spec.Path
	if !spec.Abs {
		launchPath = filepath.Join(versionDir, spec.Path)
	}
	if _, err := os.Stat(launchPath); err != nil {
		return Resolution{State: StateMissing}
	}
	args := spec.Args
	// A node-based launch stores its entry script in ScriptRel so it can be
	// resolved to an absolute path here and prepended to Args. The server runs
	// with cwd=projectRoot (not the version dir), so a relative script arg would
	// fail with "cannot find module".
	if spec.ScriptRel != "" {
		script := spec.ScriptRel
		if !spec.Abs {
			script = filepath.Join(versionDir, spec.ScriptRel)
		}
		args = append([]string{script}, spec.Args...)
	}
	return Resolution{State: StateAvailable, Path: launchPath, Args: args, Version: spec.Version}
}

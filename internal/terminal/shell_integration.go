package terminal

import (
	"bytes"
	"embed"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const integrationVersion = "v1"

//go:embed integration/zdotdir/.zshenv
//go:embed integration/zdotdir/.zshrc
//go:embed integration/firn.bashrc
var integrationFS embed.FS

// wrapperFiles maps the on-disk name to its embedded source path.
var wrapperFiles = map[string]string{
	".zshenv":     "integration/zdotdir/.zshenv",
	".zshrc":      "integration/zdotdir/.zshrc",
	"firn.bashrc": "integration/firn.bashrc",
}

// ensureWrapperFiles writes the shell-integration scripts under
// <root>/firn-ide/shell-integration/<version>/ and returns that directory.
// It rewrites any file whose content differs from the embedded source and
// re-asserts perms even when content is current. Dirs are 0700 and scripts
// 0600 — they are code-execution inputs.
func ensureWrapperFiles(root string) (string, error) {
	dir := filepath.Join(root, "firn-ide", "shell-integration", integrationVersion)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return "", err
	}
	for name, src := range wrapperFiles {
		want, err := integrationFS.ReadFile(src)
		if err != nil {
			return "", err
		}
		dst := filepath.Join(dir, name)
		if got, err := os.ReadFile(dst); err == nil && bytes.Equal(got, want) {
			// Content current; re-assert perms in case they drifted.
			if err := os.Chmod(dst, 0o600); err != nil {
				return "", err
			}
			continue
		}
		// Write atomically (temp + rename) so a shell sourcing the file never
		// observes a partial write when terminals are created concurrently.
		if err := writeFileAtomic(dir, dst, want, 0o600); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// writeFileAtomic writes data to a temp file in dir, then renames it over dst.
// Rename is atomic within a filesystem, so a concurrent reader (a shell sourcing
// the script) sees either the complete old file or the complete new one.
func writeFileAtomic(dir, dst string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(dir, ".firn-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, dst); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return nil
}

// integratedCommand builds the shell command with OSC 133 integration when the
// shell is supported and wrapper setup succeeds. It is FAIL-OPEN: any failure
// yields a plain shell command so terminal creation never breaks on integration.
func integratedCommand(shellPath, cacheRoot string) *exec.Cmd {
	plain := exec.Command(shellPath)

	kind := shellKind(shellPath)
	if kind == "" || cacheRoot == "" {
		return plain
	}
	dir, err := ensureWrapperFiles(cacheRoot)
	if err != nil {
		return plain
	}

	switch kind {
	case "zsh":
		cmd := exec.Command(shellPath)
		userZdotdir := os.Getenv("ZDOTDIR")
		if userZdotdir == "" {
			userZdotdir = os.Getenv("HOME")
		}
		cmd.Env = append(os.Environ(),
			"ZDOTDIR="+dir,
			"USER_ZDOTDIR="+userZdotdir,
		)
		return cmd
	case "bash":
		return exec.Command(shellPath, "--rcfile", filepath.Join(dir, "firn.bashrc"), "-i")
	default:
		return plain
	}
}

// shellKind returns "zsh", "bash", or "" (unsupported) for a shell path.
func shellKind(shellPath string) string {
	// Normalize Windows separators so filepath.Base works regardless of host OS.
	normalized := strings.ReplaceAll(shellPath, "\\", "/")
	base := strings.ToLower(filepath.Base(normalized))
	base = strings.TrimSuffix(base, ".exe")
	switch base {
	case "zsh":
		return "zsh"
	case "bash":
		return "bash"
	default:
		return ""
	}
}

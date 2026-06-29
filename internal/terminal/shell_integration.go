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
			if err := os.Chmod(dst, 0o600); err != nil {
				return "", err
			}
			continue
		}
		if err := os.WriteFile(dst, want, 0o600); err != nil {
			return "", err
		}
		if err := os.Chmod(dst, 0o600); err != nil {
			return "", err
		}
	}
	return dir, nil
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

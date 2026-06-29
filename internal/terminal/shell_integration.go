package terminal

import (
	"path/filepath"
	"strings"
)

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

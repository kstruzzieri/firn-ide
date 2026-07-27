package filesystem

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io/fs"
)

// WriteFileAtomic writes data to a unique sibling temp file and renames it over path.
func WriteFileAtomic(fsys FileSystem, path string, data []byte, perm fs.FileMode) error {
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return fmt.Errorf("creating atomic write temp name: %w", err)
	}
	tempPath := path + "." + hex.EncodeToString(suffix[:])
	defer func() { _ = fsys.Remove(tempPath) }()

	if err := fsys.WriteFile(tempPath, data, perm); err != nil {
		return fmt.Errorf("writing atomic temp file: %w", err)
	}
	if err := fsys.Rename(tempPath, path); err != nil {
		return fmt.Errorf("renaming atomic temp file: %w", err)
	}
	return nil
}

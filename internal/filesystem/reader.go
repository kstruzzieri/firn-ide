package filesystem

import (
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// FileEntry represents a file or directory in the tree.
// Used by ReadDirectory to return the directory structure.
type FileEntry struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"isDir"`
	Size     int64       `json:"size"`
	ModTime  time.Time   `json:"modTime"`
	Children []FileEntry `json:"children,omitempty"`
}

// DirectoryReader provides directory tree reading functionality.
type DirectoryReader struct {
	fs FileSystem
}

// NewDirectoryReader creates a new DirectoryReader with the given filesystem.
func NewDirectoryReader(fs FileSystem) *DirectoryReader {
	return &DirectoryReader{fs: fs}
}

// ReadDirectory reads a directory and returns its contents as a tree structure.
// It respects .gitignore patterns and includes file metadata.
// Returns an error if the path is invalid or inaccessible.
func (d *DirectoryReader) ReadDirectory(path string) ([]FileEntry, error) {
	// Load gitignore patterns from the directory
	ignorePatterns := d.loadGitignore(path)

	return d.readDirRecursive(path, ignorePatterns)
}

// loadGitignore reads .gitignore file and returns patterns to ignore.
func (d *DirectoryReader) loadGitignore(path string) []string {
	gitignorePath := filepath.Join(path, ".gitignore")
	content, err := d.fs.ReadFile(gitignorePath)
	if err != nil {
		return nil
	}

	var patterns []string
	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		patterns = append(patterns, line)
	}
	return patterns
}

// shouldIgnore checks if a name matches any gitignore pattern.
func (d *DirectoryReader) shouldIgnore(name string, isDir bool, patterns []string) bool {
	for _, pattern := range patterns {
		// Handle directory-specific patterns (ending with /)
		if dirPattern, found := strings.CutSuffix(pattern, "/"); found {
			if isDir && name == dirPattern {
				return true
			}
			continue
		}

		// Simple name matching (not full glob support)
		matched, _ := filepath.Match(pattern, name)
		if matched {
			return true
		}
	}
	return false
}

// buildEntries reads ONE directory level: filter (dot-dirs, gitignore), stat,
// sort folders-first. Child directories are returned WITHOUT Children populated.
func (d *DirectoryReader) buildEntries(path string, ignorePatterns []string) ([]FileEntry, error) {
	dirEntries, err := d.fs.ReadDir(path)
	if err != nil {
		return nil, err
	}

	entries := make([]FileEntry, 0, len(dirEntries))
	for _, de := range dirEntries {
		name := de.Name()
		if de.IsDir() && strings.HasPrefix(name, ".") {
			continue
		}
		if name != ".gitignore" && d.shouldIgnore(name, de.IsDir(), ignorePatterns) {
			continue
		}
		fullPath := filepath.Join(path, name)
		info, err := d.fs.Stat(fullPath)
		if err != nil {
			continue
		}
		entries = append(entries, FileEntry{
			Name:    name,
			Path:    fullPath,
			IsDir:   de.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime(),
		})
	}
	sortEntries(entries)
	return entries, nil
}

// ReadDirectoryShallow reads a single directory level (immediate children only).
// Child directories are returned without their own children populated.
func (d *DirectoryReader) ReadDirectoryShallow(path string, rootPath string) ([]FileEntry, error) {
	ignorePatterns := d.loadGitignore(rootPath)
	return d.buildEntries(path, ignorePatterns)
}

// readDirRecursive reads a directory recursively and returns FileEntry slice.
func (d *DirectoryReader) readDirRecursive(path string, ignorePatterns []string) ([]FileEntry, error) {
	entries, err := d.buildEntries(path, ignorePatterns)
	if err != nil {
		return nil, err
	}
	for i := range entries {
		if entries[i].IsDir {
			children, err := d.readDirRecursive(entries[i].Path, ignorePatterns)
			if err != nil {
				entries[i].Children = []FileEntry{}
			} else {
				entries[i].Children = children
			}
		}
	}
	return entries, nil
}

// sortEntries sorts file entries with folders first, then alphabetically by name.
func sortEntries(entries []FileEntry) {
	sort.Slice(entries, func(i, j int) bool {
		// Folders come before files
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		// Within same type, sort alphabetically (case-insensitive)
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
}

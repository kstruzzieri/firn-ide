package main

import (
	"path/filepath"
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

// readDirRecursive reads a directory recursively and returns FileEntry slice.
func (d *DirectoryReader) readDirRecursive(path string, ignorePatterns []string) ([]FileEntry, error) {
	dirEntries, err := d.fs.ReadDir(path)
	if err != nil {
		return nil, err
	}

	entries := make([]FileEntry, 0, len(dirEntries))

	for _, de := range dirEntries {
		name := de.Name()

		// Check if should be ignored (but always include .gitignore itself)
		if name != ".gitignore" && d.shouldIgnore(name, de.IsDir(), ignorePatterns) {
			continue
		}

		fullPath := filepath.Join(path, name)

		// Get file info for metadata
		info, err := d.fs.Stat(fullPath)
		if err != nil {
			// Skip files we can't stat
			continue
		}

		entry := FileEntry{
			Name:    name,
			Path:    fullPath,
			IsDir:   de.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime(),
		}

		// Recursively read subdirectories
		if de.IsDir() {
			children, err := d.readDirRecursive(fullPath, ignorePatterns)
			if err != nil {
				// Permission denied or other error on subdirectory
				// Continue with empty children rather than failing
				entry.Children = []FileEntry{}
			} else {
				entry.Children = children
			}
		}

		entries = append(entries, entry)
	}

	return entries, nil
}

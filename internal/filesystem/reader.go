package filesystem

import (
	pathpkg "path"
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

type ignoreRule struct {
	baseDir  string
	pattern  string
	negated  bool
	dirOnly  bool
	anchored bool
}

// NewDirectoryReader creates a new DirectoryReader with the given filesystem.
func NewDirectoryReader(fs FileSystem) *DirectoryReader {
	return &DirectoryReader{fs: fs}
}

// ReadDirectory reads a directory and returns its contents as a tree structure.
// It respects .gitignore patterns and includes file metadata.
// Returns an error if the path is invalid or inaccessible.
func (d *DirectoryReader) ReadDirectory(path string) ([]FileEntry, error) {
	return d.readDirRecursive(path, nil)
}

// loadGitignore reads the rules scoped to one directory.
func (d *DirectoryReader) loadGitignore(path string) []ignoreRule {
	gitignorePath := filepath.Join(path, ".gitignore")
	content, err := d.fs.ReadFile(gitignorePath)
	if err != nil {
		return nil
	}

	var rules []ignoreRule
	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		line = trimGitignoreLine(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		rule := ignoreRule{baseDir: path}
		if strings.HasPrefix(line, "!") {
			rule.negated = true
			line = strings.TrimPrefix(line, "!")
		}
		if line == "" {
			continue
		}
		if strings.HasSuffix(line, "/") {
			rule.dirOnly = true
			line = strings.TrimSuffix(line, "/")
		}
		if strings.HasPrefix(line, "/") {
			rule.anchored = true
			line = strings.TrimPrefix(line, "/")
		}
		rule.anchored = rule.anchored || strings.Contains(line, "/")
		rule.pattern = normalizeGitignorePattern(line)
		rules = append(rules, rule)
	}
	return rules
}

func trimGitignoreLine(line string) string {
	line = strings.TrimSuffix(line, "\r")
	for strings.HasSuffix(line, " ") {
		backslashes := 0
		for i := len(line) - 2; i >= 0 && line[i] == '\\'; i-- {
			backslashes++
		}
		if backslashes%2 == 1 {
			break
		}
		line = strings.TrimSuffix(line, " ")
	}
	return line
}

func normalizeGitignorePattern(pattern string) string {
	var normalized strings.Builder
	normalized.Grow(len(pattern))
	for i := 0; i < len(pattern); i++ {
		if pattern[i] == '\\' && i+1 < len(pattern) {
			normalized.WriteByte(pattern[i])
			i++
			normalized.WriteByte(pattern[i])
			continue
		}
		if pattern[i] == '[' && i+1 < len(pattern) && pattern[i+1] == '!' {
			normalized.WriteString("[^")
			i++
			continue
		}
		normalized.WriteByte(pattern[i])
	}
	return normalized.String()
}

// shouldIgnore applies matching rules in order; the last match wins.
func (d *DirectoryReader) shouldIgnore(path string, isDir bool, rules []ignoreRule) bool {
	ignored := false
	for _, rule := range rules {
		if rule.dirOnly && !isDir {
			continue
		}

		rel, err := filepath.Rel(rule.baseDir, path)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		rel = filepath.ToSlash(rel)
		candidate := pathpkg.Base(rel)
		if rule.anchored {
			candidate = rel
		}
		matched := matchGitignorePath(rule.pattern, candidate)
		if matched {
			ignored = !rule.negated
		}
	}
	return ignored
}

func matchGitignorePath(pattern, name string) bool {
	patternParts := strings.Split(pattern, "/")
	nameParts := strings.Split(name, "/")
	memo := make(map[[2]int]bool)
	var match func(int, int) bool
	match = func(patternIndex, nameIndex int) bool {
		state := [2]int{patternIndex, nameIndex}
		if matched, ok := memo[state]; ok {
			return matched
		}

		matched := false
		switch {
		case patternIndex == len(patternParts):
			matched = nameIndex == len(nameParts)
		case patternParts[patternIndex] == "**":
			if patternIndex == len(patternParts)-1 {
				matched = nameIndex < len(nameParts)
			} else {
				matched = match(patternIndex+1, nameIndex) ||
					(nameIndex < len(nameParts) && match(patternIndex, nameIndex+1))
			}
		case nameIndex < len(nameParts):
			componentMatched, err := pathpkg.Match(patternParts[patternIndex], nameParts[nameIndex])
			matched = err == nil && componentMatched && match(patternIndex+1, nameIndex+1)
		}
		memo[state] = matched
		return matched
	}
	return match(0, 0)
}

// buildEntries reads ONE directory level: filter (dot-dirs, gitignore), stat,
// sort folders-first. Child directories are returned WITHOUT Children populated.
func (d *DirectoryReader) buildEntries(path string, ignoreRules []ignoreRule) ([]FileEntry, error) {
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
		fullPath := filepath.Join(path, name)
		if name != ".gitignore" && d.shouldIgnore(fullPath, de.IsDir(), ignoreRules) {
			continue
		}
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
	ignoreRules, ignored := d.loadGitignoreRules(rootPath, path)
	if ignored {
		return []FileEntry{}, nil
	}
	return d.buildEntries(path, ignoreRules)
}

// readDirRecursive reads a directory recursively and returns FileEntry slice.
func (d *DirectoryReader) readDirRecursive(path string, inheritedRules []ignoreRule) ([]FileEntry, error) {
	ignoreRules := append(inheritedRules, d.loadGitignore(path)...)
	entries, err := d.buildEntries(path, ignoreRules)
	if err != nil {
		return nil, err
	}
	for i := range entries {
		if entries[i].IsDir {
			children, err := d.readDirRecursive(entries[i].Path, ignoreRules)
			if err != nil {
				entries[i].Children = []FileEntry{}
			} else {
				entries[i].Children = children
			}
		}
	}
	return entries, nil
}

func (d *DirectoryReader) loadGitignoreRules(rootPath, path string) ([]ignoreRule, bool) {
	rules := d.loadGitignore(rootPath)
	rel, err := filepath.Rel(rootPath, path)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return rules, false
	}

	current := rootPath
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		if d.shouldIgnore(current, true, rules) {
			return rules, true
		}
		rules = append(rules, d.loadGitignore(current)...)
	}
	return rules, false
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

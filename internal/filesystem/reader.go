package filesystem

import (
	pathpkg "path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// FileEntry represents a file or directory in the tree.
// Used by ReadDirectory to return the directory structure.
type FileEntry struct {
	Name       string      `json:"name"`
	Path       string      `json:"path"`
	IsDir      bool        `json:"isDir"`
	Size       int64       `json:"size"`
	ModTime    time.Time   `json:"modTime"`
	Children   []FileEntry `json:"children,omitempty"`
	Unreadable bool        `json:"unreadable,omitempty"`
}

// DirectoryReader provides directory tree reading functionality.
type DirectoryReader struct {
	fs FileSystem

	trackedMu sync.RWMutex
	// tracked holds, per workspace root, the files git tracks that .gitignore
	// rules match (#536). Git applies .gitignore only to untracked files, so
	// the tree lists these anyway. A workspace outside any git repository
	// lists as empty. Every root keeps its last set, the baseline its next
	// SetTrackedIgnored diffs against, even when a late git status for
	// another workspace lands after a switch.
	tracked map[string]trackedIgnored
	// freshRoot is the root stored last. One workspace is open at a time, and
	// another root's set may have gone stale while it was closed (its
	// .gitignore can change meanwhile), so a read of any other root lists it
	// again first.
	freshRoot string
	// listTracked lists a root no SetTrackedIgnored call has covered yet, so
	// a workspace's first read (startup, restore) already has its exceptions.
	listTracked func(root string) []string
}

// SetTrackedLister installs the function that lists, for a root the reader
// has no set for yet, the files git tracks that .gitignore rules match, in
// SetTrackedIgnored's form. It runs once per root, on the first read.
func (d *DirectoryReader) SetTrackedLister(list func(root string) []string) {
	d.trackedMu.Lock()
	defer d.trackedMu.Unlock()
	d.listTracked = list
}

// store records root's set and makes root the fresh one. trackedMu must be
// held for writing.
func (d *DirectoryReader) store(root string, set trackedIgnored) {
	if d.tracked == nil {
		d.tracked = make(map[string]trackedIgnored)
	}
	d.tracked[root] = set
	d.freshRoot = root
}

// newTrackedIgnored builds a root's exception set from root-relative,
// "/"-separated paths.
func newTrackedIgnored(paths []string) trackedIgnored {
	set := trackedIgnored{files: map[string]bool{}, dirs: map[string]bool{}}
	for _, rel := range paths {
		if rel == "" {
			continue
		}
		set.files[rel] = true
		for dir := pathpkg.Dir(rel); dir != "."; dir = pathpkg.Dir(dir) {
			set.dirs[dir] = true
		}
	}
	return set
}

// trackedIgnored is one root's exception set: root-relative, "/"-separated
// tracked files a .gitignore rule matches, and every folder leading to one.
// A zero value (nil maps) is the empty set.
type trackedIgnored struct {
	files map[string]bool
	dirs  map[string]bool
}

// listScope is what buildEntries needs beyond the ignore rules: the workspace
// root and its exception set, and whether the folder being listed is itself
// ignored but listed for the tracked files it holds. Inside such a folder a
// child may match no rule on its own ("data/" matches only the folder), so
// only the paths in the set are listed there, as git treats them.
type listScope struct {
	root    string
	tracked trackedIgnored
	ignored bool
}

// lists reports whether the exception set lists fullPath, a file or folder
// under the scope's root.
func (s listScope) lists(fullPath string, isDir bool) bool {
	set := s.tracked.files
	if isDir {
		set = s.tracked.dirs
	}
	if len(set) == 0 {
		return false
	}
	rel, err := filepath.Rel(s.root, fullPath)
	if err != nil {
		return false
	}
	return set[filepath.ToSlash(rel)]
}

// ignoreRule is a single parsed .gitignore line, scoped to the directory whose
// .gitignore it came from (baseDir). patternParts is the normalized pattern
// pre-split on "/" so matching never re-splits it; hasDoubleStar records whether
// any component is "**" so the matcher only pays for memoization when a pattern
// can actually branch.
//
// Scope note: matching is always case-sensitive (git's core.ignorecase is not
// consulted), and only per-directory .gitignore files are read — global excludes
// (core.excludesFile) and .git/info/exclude are intentionally out of scope for
// the file tree.
type ignoreRule struct {
	baseDir       string
	patternParts  []string
	hasDoubleStar bool
	negated       bool
	dirOnly       bool
	anchored      bool
}

// NewDirectoryReader creates a new DirectoryReader with the given filesystem.
func NewDirectoryReader(fs FileSystem) *DirectoryReader {
	return &DirectoryReader{fs: fs}
}

// ReadDirectory reads a directory and returns its contents as a tree structure.
// It respects .gitignore patterns and includes file metadata.
// Returns an error if the path is invalid or inaccessible.
func (d *DirectoryReader) ReadDirectory(path string) ([]FileEntry, error) {
	return d.readDirRecursive(path, nil, d.scopeFor(path))
}

// SetTrackedIgnored replaces root's exception set with paths: the files git
// tracks that .gitignore rules match, relative to root and "/"-separated, as
// `git ls-files --cached --ignored` lists them. It returns, sorted, the
// folders whose listings may change as a result: every folder from root down
// to the parent of each file that joined or left the set.
func (d *DirectoryReader) SetTrackedIgnored(root string, paths []string) []string {
	root = filepath.Clean(root)
	next := newTrackedIgnored(paths)

	d.trackedMu.Lock()
	prev := d.tracked[root]
	d.store(root, next)
	d.trackedMu.Unlock()

	changed := map[string]bool{}
	markAncestors := func(rel string) {
		for dir := pathpkg.Dir(rel); !changed[dir]; dir = pathpkg.Dir(dir) {
			changed[dir] = true
			if dir == "." {
				return
			}
		}
	}
	for rel := range prev.files {
		if !next.files[rel] {
			markAncestors(rel)
		}
	}
	for rel := range next.files {
		if !prev.files[rel] {
			markAncestors(rel)
		}
	}
	if len(changed) == 0 {
		return nil
	}
	dirs := make([]string, 0, len(changed))
	for rel := range changed {
		dirs = append(dirs, filepath.Join(root, filepath.FromSlash(rel)))
	}
	sort.Strings(dirs)
	return dirs
}

// TrackedIgnoredFiles returns, sorted and absolute, the files in root's
// exception set that exist on disk, leaving out those inside dot-folders,
// which the tree does not list (#450 settles those). Search hands them to
// ripgrep, which otherwise skips them as ignored.
func (d *DirectoryReader) TrackedIgnoredFiles(root string) []string {
	root = filepath.Clean(root)
	tracked := d.scopeFor(root).tracked
	var files []string
	for rel := range tracked.files {
		if inDotFolder(rel) {
			continue
		}
		path := filepath.Join(root, filepath.FromSlash(rel))
		// ripgrep fails the whole search on a path that does not exist, and a
		// file deleted from the working tree stays in the index until commit.
		if info, err := d.fs.Stat(path); err != nil || info.IsDir() {
			continue
		}
		files = append(files, path)
	}
	sort.Strings(files)
	return files
}

// inDotFolder reports whether the "/"-separated rel lies inside a folder
// whose name starts with a dot.
func inDotFolder(rel string) bool {
	parts := strings.Split(rel, "/")
	for _, part := range parts[:len(parts)-1] {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}

// scopeFor returns the listing scope for a read rooted at root.
func (d *DirectoryReader) scopeFor(root string) listScope {
	root = filepath.Clean(root)
	d.trackedMu.RLock()
	tracked := d.tracked[root]
	fresh := root == d.freshRoot
	list := d.listTracked
	d.trackedMu.RUnlock()
	if !fresh && list != nil {
		// Listed outside the lock: git may take a while, and reads of other
		// roots must not wait. A set SetTrackedIgnored stored meanwhile is
		// newer than this listing and wins.
		listed := newTrackedIgnored(list(root))
		d.trackedMu.Lock()
		if root == d.freshRoot {
			tracked = d.tracked[root]
		} else {
			d.store(root, listed)
			tracked = listed
		}
		d.trackedMu.Unlock()
	}
	return listScope{root: root, tracked: tracked}
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

		pattern := normalizeGitignorePattern(line)
		if pattern == "" {
			// e.g. a bare "/" line: nothing left to match on.
			continue
		}
		parts := strings.Split(pattern, "/")
		if !validGitignoreParts(parts) {
			// Malformed pattern (e.g. an unterminated "["). Reject it once here
			// rather than letting path.Match fail and be swallowed on every
			// candidate it is later tested against.
			continue
		}
		rule.patternParts = parts
		for _, part := range parts {
			if part == "**" {
				rule.hasDoubleStar = true
				break
			}
		}
		rules = append(rules, rule)
	}
	return rules
}

// validGitignoreParts reports whether every non-"**" component is a pattern
// path.Match can evaluate. Invalid components (unterminated character classes)
// make path.Match return ErrBadPattern; catching that here keeps shouldIgnore's
// hot loop free of swallowed errors.
func validGitignoreParts(parts []string) bool {
	for _, part := range parts {
		if part == "**" {
			continue
		}
		if _, err := pathpkg.Match(part, ""); err != nil {
			return false
		}
	}
	return true
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
		matched := matchGitignorePath(rule, candidate)
		if matched {
			ignored = !rule.negated
		}
	}
	return ignored
}

// matchGitignorePath reports whether the pre-split pattern matches name (also
// "/"-separated). A non-final "**" spans zero or more components; a final "**"
// matches one or more, so "dir/**" matches its contents but not "dir" itself.
// Every other component uses path.Match (which never crosses "/"). The memo is
// allocated only for "**" patterns; otherwise recursion never revisits a state.
func matchGitignorePath(rule ignoreRule, name string) bool {
	patternParts := rule.patternParts
	nameParts := strings.Split(name, "/")

	var memo map[[2]int]bool
	if rule.hasDoubleStar {
		memo = make(map[[2]int]bool)
	}

	var match func(int, int) bool
	match = func(patternIndex, nameIndex int) bool {
		state := [2]int{patternIndex, nameIndex}
		if memo != nil {
			if matched, ok := memo[state]; ok {
				return matched
			}
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
		if memo != nil {
			memo[state] = matched
		}
		return matched
	}
	return match(0, 0)
}

// buildEntries reads ONE directory level: filter (dot-dirs, gitignore), stat,
// sort folders-first. Child directories are returned WITHOUT Children populated.
// A path a rule would hide is still listed when scope's exception set lists
// it; inside an ignored folder, only those paths are.
func (d *DirectoryReader) buildEntries(path string, ignoreRules []ignoreRule, scope listScope) ([]FileEntry, error) {
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
		if scope.ignored {
			if !scope.lists(fullPath, de.IsDir()) {
				continue
			}
		} else if name != ".gitignore" && d.shouldIgnore(fullPath, de.IsDir(), ignoreRules) && !scope.lists(fullPath, de.IsDir()) {
			continue
		}
		entry := FileEntry{Name: name, Path: fullPath, IsDir: de.IsDir()}
		info, err := d.fs.Stat(fullPath)
		if err != nil {
			entry.Unreadable = true
		} else {
			entry.Size = info.Size()
			entry.ModTime = info.ModTime()
		}
		entries = append(entries, entry)
	}
	sortEntries(entries)
	return entries, nil
}

// ReadDirectoryShallow reads a single directory level (immediate children only).
// Child directories are returned without their own children populated.
func (d *DirectoryReader) ReadDirectoryShallow(path string, rootPath string) ([]FileEntry, error) {
	scope := d.scopeFor(rootPath)
	ignoreRules, hidden := d.loadGitignoreRules(rootPath, path, &scope)
	if hidden {
		return []FileEntry{}, nil
	}
	return d.buildEntries(path, ignoreRules, scope)
}

// readDirRecursive reads a directory recursively and returns FileEntry slice.
func (d *DirectoryReader) readDirRecursive(path string, inheritedRules []ignoreRule, scope listScope) ([]FileEntry, error) {
	local := d.loadGitignore(path)
	// Build on a fresh backing array. Reusing inheritedRules' array via
	// append(inheritedRules, ...) would let each sibling recursion write local
	// rules into the same spare capacity and clobber the previous sibling's.
	ignoreRules := make([]ignoreRule, 0, len(inheritedRules)+len(local))
	ignoreRules = append(ignoreRules, inheritedRules...)
	ignoreRules = append(ignoreRules, local...)
	entries, err := d.buildEntries(path, ignoreRules, scope)
	if err != nil {
		return nil, err
	}
	for i := range entries {
		if entries[i].IsDir && !entries[i].Unreadable {
			childScope := scope
			// Only a folder the set lists can be ignored and still listed, so
			// the rules are consulted again just for those.
			childScope.ignored = scope.ignored ||
				(scope.lists(entries[i].Path, true) && d.shouldIgnore(entries[i].Path, true, ignoreRules))
			children, err := d.readDirRecursive(entries[i].Path, ignoreRules, childScope)
			if err != nil {
				entries[i].Unreadable = true
			} else {
				entries[i].Children = children
			}
		}
	}
	return entries, nil
}

// loadGitignoreRules walks from rootPath down to path, gathering the rules
// that apply to path's children. It reports hidden when a folder on the way
// is ignored and scope's exception set does not list it; a listed one marks
// scope ignored, so path's listing holds only the set's paths.
func (d *DirectoryReader) loadGitignoreRules(rootPath, path string, scope *listScope) ([]ignoreRule, bool) {
	rules := d.loadGitignore(rootPath)
	rel, err := filepath.Rel(rootPath, path)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return rules, false
	}

	current := rootPath
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		if scope.ignored || d.shouldIgnore(current, true, rules) {
			if !scope.lists(current, true) {
				return rules, true
			}
			scope.ignored = true
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

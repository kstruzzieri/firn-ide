package git

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"firn/internal/filesystem"
)

// ConflictSnapshot is the single, atomic read of a conflicted working-tree
// file: the exact bytes the frontend displays plus the regions parsed from
// those same bytes. Parsing regions from the same read the UI renders closes
// the window where an external write between two reads would leave region
// coordinates pointing at different content. Encoding/LineEndings mirror
// filesystem.FileContent so the frontend can persist the resolved file without
// a lossy round-trip.
type ConflictSnapshot struct {
	Content     string           `json:"content"`
	Encoding    string           `json:"encoding"`
	LineEndings string           `json:"lineEndings"`
	Regions     []ConflictRegion `json:"regions"`
}

// ConflictSnapshot reads the conflicted file at a repo-root-relative path once
// and parses its conflict regions. dir may be a nested workspace inside the
// repo, so the path is resolved against the repository top-level (porcelain
// paths are always repo-root-relative). Binary files and files past the
// diffable size cap are refused with an error — the resolution surface only
// handles text, and the caller falls back to the plain conflict playbook.
func (s *Service) ConflictSnapshot(ctx context.Context, dir, path string) (ConflictSnapshot, error) {
	if err := validateRepoRelPaths([]string{path}); err != nil {
		return ConflictSnapshot{}, err
	}
	root, err := s.repoRoot(ctx, dir)
	if err != nil {
		return ConflictSnapshot{}, err
	}
	abs := filepath.Join(root, filepath.FromSlash(path))

	// Containment: the fully symlink-resolved path must stay under the
	// symlink-resolved repo root, so a crafted path through an in-repo
	// directory symlink (which git never emits but a tampered binding could
	// send) cannot read outside the repository.
	if err := verifyUnderRoot(root, abs); err != nil {
		return ConflictSnapshot{}, fmt.Errorf("cannot resolve %s: %w", path, err)
	}
	// Lstat before reading: reject a final-component symlink (ReadFileWithMetadata
	// would follow it) and enforce the size cap on the raw file before decoding
	// a huge file into memory. A small TOCTOU window remains before the read;
	// acceptable for a single-user local IDE reading its own working tree.
	info, err := os.Lstat(abs)
	if err != nil {
		return ConflictSnapshot{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return ConflictSnapshot{}, fmt.Errorf("cannot resolve %s: path is a symlink", path)
	}
	if info.Size() > maxDiffableBytes {
		return ConflictSnapshot{}, fmt.Errorf("cannot resolve %s: file is too large (%d bytes)", path, info.Size())
	}

	reader := filesystem.NewFileReader(filesystem.NewOS())
	fc, err := reader.ReadFileWithMetadata(abs)
	if err != nil {
		return ConflictSnapshot{}, err
	}
	if fc.IsBinary {
		return ConflictSnapshot{}, fmt.Errorf("cannot resolve %s: file is binary", path)
	}

	regions, err := parseConflictRegions(fc.Content, s.conflictMarkerSize(ctx, dir, path))
	if err != nil {
		return ConflictSnapshot{}, fmt.Errorf("cannot resolve %s: %w", path, err)
	}
	// Git adds conflict markers around the merge hunks; it does NOT widen them
	// to avoid colliding with marker-shaped lines already in the file's content.
	// So a file whose unchanged content contains a literal conflict example
	// produces a region the parser cannot distinguish from a real one. A real
	// region's opening marker is git-added and never appears in a stage blob; a
	// spurious one is content and does. If any region's opener is found in a
	// stage, refuse and fall back rather than surface a region that, if
	// "resolved", would corrupt unchanged text.
	if len(regions) > 0 {
		spurious, err := s.regionOpenerInStages(ctx, dir, path, fc.Content, regions)
		if err != nil {
			return ConflictSnapshot{}, err
		}
		if spurious {
			return ConflictSnapshot{}, fmt.Errorf("cannot resolve %s: file content contains literal conflict markers", path)
		}
	}
	return ConflictSnapshot{
		Content:     fc.Content,
		Encoding:    fc.Encoding,
		LineEndings: fc.LineEndings,
		Regions:     regions,
	}, nil
}

// MergeHead describes one side of an in-progress conflict for the card header.
// Label is a branch name when resolvable, else the short hash; Hash/Subject
// come from the commit that side points at.
type MergeHead struct {
	Label   string `json:"label"`
	Hash    string `json:"hash"`
	Subject string `json:"subject"`
}

// MergeHeads names both sides of the conflict the user is resolving, plus the
// operation (merge, rebase, or cherry-pick) so the UI can phrase "incoming"
// correctly. It reads HEAD (ours) and the operation's incoming ref (theirs).
type MergeHeads struct {
	Operation string    `json:"operation"`
	Ours      MergeHead `json:"ours"`
	Theirs    MergeHead `json:"theirs"`
}

// MergeHeads returns the two sides of the in-progress conflict. The incoming
// ref is chosen by which operation is underway: MERGE_HEAD for a merge,
// CHERRY_PICK_HEAD for a cherry-pick, REBASE_HEAD for a rebase. When no
// conflicting operation is in progress it returns an error rather than
// inventing a side — porcelain reports "(detached)" mid-rebase, so ours is
// always taken from HEAD directly, never from the branch name.
func (s *Service) MergeHeads(ctx context.Context, dir string) (MergeHeads, error) {
	operation, incomingRef := "", ""
	switch {
	// Rebase is detected by its state directory (git's own signal in
	// wt-status.c) and takes precedence: a stale REBASE_HEAD can linger, and a
	// merge step inside `rebase --rebase-merges` sets MERGE_HEAD while still
	// being a rebase. Its incoming ref is MERGE_HEAD for an inner merge step,
	// else REBASE_HEAD for a normal pick step.
	case s.gitPathExists(ctx, dir, "rebase-merge"), s.gitPathExists(ctx, dir, "rebase-apply"):
		operation = "rebase"
		// An inner merge step of `rebase --rebase-merges` writes MERGE_HEAD;
		// otherwise the pick step's incoming commit is REBASE_HEAD. Detect the
		// former via its state file (not a DWIM ref) so a branch literally
		// named MERGE_HEAD cannot shadow it. If the apply backend leaves no
		// REBASE_HEAD, describeHead errors and the caller falls back safely.
		if s.gitPathExists(ctx, dir, "MERGE_HEAD") {
			incomingRef = "MERGE_HEAD"
		} else {
			incomingRef = "REBASE_HEAD"
		}
	case s.gitPathExists(ctx, dir, "CHERRY_PICK_HEAD"):
		operation, incomingRef = "cherry-pick", "CHERRY_PICK_HEAD"
	case s.gitPathExists(ctx, dir, "MERGE_HEAD"):
		operation, incomingRef = "merge", "MERGE_HEAD"
	default:
		return MergeHeads{}, fmt.Errorf("no merge, rebase, or cherry-pick in progress")
	}

	ours, err := s.describeHead(ctx, dir, "HEAD")
	if err != nil {
		return MergeHeads{}, err
	}
	// Prefer the current branch name for ours; empty (detached) keeps the hash.
	if branch, err := s.run(ctx, dir, "symbolic-ref", "--short", "-q", "HEAD"); err == nil {
		if name := strings.TrimSpace(branch); name != "" {
			ours.Label = name
		}
	}
	theirs, err := s.describeHead(ctx, dir, incomingRef)
	if err != nil {
		return MergeHeads{}, err
	}
	return MergeHeads{Operation: operation, Ours: ours, Theirs: theirs}, nil
}

// gitPathExists reports whether a file or directory exists under the git dir
// (e.g. "MERGE_HEAD", "rebase-merge"). It asks git for the absolute path so
// linked worktrees resolve correctly and a symlinked dir cannot mislead a
// lexical join, then stats it. This checks the operation-state file directly
// rather than resolving a ref name, which cannot be shadowed by a branch.
func (s *Service) gitPathExists(ctx context.Context, dir, name string) bool {
	out, err := s.run(ctx, dir, "rev-parse", "--path-format=absolute", "--git-path", name)
	if err != nil {
		return false
	}
	p := strings.TrimSpace(out)
	if p == "" {
		return false
	}
	_, statErr := os.Stat(p)
	return statErr == nil
}

// verifyUnderRoot fails unless abs, with all symlinks resolved, stays within
// the symlink-resolved repository root. Both sides are resolved so platform
// symlinks in the root path itself (e.g. macOS /var -> /private/var) do not
// cause a false escape.
func verifyUnderRoot(root, abs string) error {
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	realAbs, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(realRoot, realAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path escapes the repository")
	}
	return nil
}

// describeHead resolves a ref to short hash + subject, seeding Label with the
// short hash (callers may override with a branch name).
func (s *Service) describeHead(ctx context.Context, dir, ref string) (MergeHead, error) {
	out, err := s.run(ctx, dir, "log", "-1", "--format=%h%x00%s", ref)
	if err != nil {
		return MergeHead{}, err
	}
	hash, subject, _ := strings.Cut(strings.TrimRight(out, "\n"), "\x00")
	return MergeHead{Label: hash, Hash: hash, Subject: subject}, nil
}

// ResolveConflictSide finalizes a whole-file conflict (binary, or a
// delete/modify where a marker-based resolution is impossible) by taking one
// side. side is "ours" or "theirs". When the chosen side has content (its
// index stage exists) that content is checked out and staged; when the chosen
// side is a deletion (its stage is absent) the path is removed and the deletion
// is staged. This is the only write the merge surface makes, and only at Write
// and stage time — never on a click — so closing the surface leaves the working
// tree untouched.
func (s *Service) ResolveConflictSide(ctx context.Context, dir, path, side string) error {
	if err := validateRepoRelPaths([]string{path}); err != nil {
		return err
	}
	var checkoutFlag string
	switch side {
	case "ours":
		checkoutFlag = "--ours"
	case "theirs":
		checkoutFlag = "--theirs"
	default:
		return fmt.Errorf("invalid conflict side %q (allowed: ours, theirs)", side)
	}

	stages, err := s.ConflictStages(ctx, dir, path)
	if err != nil {
		return err
	}
	// Refuse when the path has no conflict stages at all: it is not conflicted
	// (already resolved, a stale card, or a double-click). Without this guard
	// the "chosen side absent = deletion" branch below would `git rm -f` a
	// clean tracked file and destroy uncommitted content.
	if stages.Base == nil && stages.Ours == nil && stages.Theirs == nil {
		return fmt.Errorf("%s is not conflicted", path)
	}
	chosen := stages.Ours
	if side == "theirs" {
		chosen = stages.Theirs
	}

	// Chosen side is a deletion (its stage is absent though the path IS
	// conflicted): remove the path and stage the removal. No -f: plain `git rm`
	// still removes an unmerged path, but keeps git's up-to-date safety check so
	// a resolution raced in between ConflictStages and here is rejected rather
	// than force-deleted.
	if chosen == nil {
		_, err := s.runAtRoot(ctx, dir, literalPathspecs, "rm", "--", path)
		return err
	}
	// Chosen side has content: write it to the working tree, then stage it,
	// collapsing the conflict stages to a resolved entry.
	if _, err := s.runAtRoot(ctx, dir, literalPathspecs, "checkout", checkoutFlag, "--", path); err != nil {
		return err
	}
	_, err = s.runAtRoot(ctx, dir, literalPathspecs, "add", "--", path)
	return err
}

// literalPathspecs is the global git flag that disables pathspec magic, so a
// user-supplied path is always matched as a literal filename. It guards the
// path-bearing commands (checkout, rm, add, ls-files) against a filename that
// contains pathspec metacharacters ("*", a leading ":") matching or mutating
// unrelated files — critical for the destructive rm/checkout in
// ResolveConflictSide.
const literalPathspecs = "--literal-pathspecs"

// StageBlob is one conflict index entry (a stage-1/2/3 object). Size is the
// blob byte size. A nil *StageBlob on ConflictStages means the stage is absent
// — the explicit signal for a delete/modify conflict, never conflated with
// empty content.
type StageBlob struct {
	Hash string `json:"hash"`
	Size int64  `json:"size"`
}

// ConflictStages reports which index stages exist for a conflicted path, so the
// frontend can tell a whole-file side conflict (binary, or delete/modify with a
// stage absent) from a mergeable text conflict, and offer only the sides that
// actually exist. Stage 1 is the merge base, 2 is ours (HEAD), 3 is theirs.
type ConflictStages struct {
	Path   string     `json:"path"`
	Base   *StageBlob `json:"base"`
	Ours   *StageBlob `json:"ours"`
	Theirs *StageBlob `json:"theirs"`
	Binary bool       `json:"binary"`
}

// ConflictStages runs `git ls-files -u` for a single path and records which of
// the three conflict stages are present, along with a binary flag derived from
// a representative present stage. An unconflicted path yields all-nil stages
// and no error, letting the caller decide it is nothing to resolve.
func (s *Service) ConflictStages(ctx context.Context, dir, path string) (ConflictStages, error) {
	if err := validateRepoRelPaths([]string{path}); err != nil {
		return ConflictStages{}, err
	}
	out, err := s.runAtRoot(ctx, dir, literalPathspecs, "ls-files", "-u", "-z", "--", path)
	if err != nil {
		return ConflictStages{}, err
	}

	result := ConflictStages{Path: path}
	for _, rec := range strings.Split(out, "\x00") {
		if rec == "" {
			continue
		}
		// Record: "<mode> <object> <stage>\t<path>". Accept only records for
		// the exact requested path — a directory-like pathspec (e.g. ".") would
		// otherwise aggregate descendants' stages into one result and let
		// ResolveConflictSide act on the wrong files.
		meta, name, ok := strings.Cut(rec, "\t")
		if !ok || name != path {
			continue
		}
		fields := strings.Fields(meta)
		if len(fields) != 3 {
			continue
		}
		blob := &StageBlob{Hash: fields[1], Size: s.blobSize(ctx, dir, fields[1])}
		switch fields[2] {
		case "1":
			result.Base = blob
		case "2":
			result.Ours = blob
		case "3":
			result.Theirs = blob
		}
	}

	// Git merges a file as binary when ANY present stage is binary, so probe
	// every present stage — a text-ours/binary-theirs conflict is still binary.
	for _, blob := range []*StageBlob{result.Base, result.Ours, result.Theirs} {
		if blob != nil && s.blobIsBinary(ctx, dir, blob) {
			result.Binary = true
			break
		}
	}
	return result, nil
}

// blobSize returns the byte size of a git object, or 0 when it cannot be read.
func (s *Service) blobSize(ctx context.Context, dir, hash string) int64 {
	out, err := s.runAtRoot(ctx, dir, "cat-file", "-s", hash)
	if err != nil {
		return 0
	}
	var n int64
	if _, scanErr := fmt.Sscanf(strings.TrimSpace(out), "%d", &n); scanErr != nil {
		return 0
	}
	return n
}

// blobIsBinary probes a blob for a NUL byte using git's own heuristic. A blob
// past the diffable size cap is treated as binary without reading it: the merge
// surface refuses over-cap text anyway (ConflictSnapshot), so this both avoids
// an unbounded read of a huge object and routes it to the whole-file-side UI.
func (s *Service) blobIsBinary(ctx context.Context, dir string, blob *StageBlob) bool {
	if blob.Size > maxDiffableBytes {
		return true
	}
	out, err := s.runAtRoot(ctx, dir, "cat-file", "blob", blob.Hash)
	if err != nil {
		return false
	}
	return isBinary(out)
}

// conflictMarkerSize returns the effective conflict-marker-size for a path
// (git's gitattributes-controlled marker width), defaulting to 7 when unset or
// unparseable. `git check-attr -z` emits "<path>\0conflict-marker-size\0<value>\0";
// value is a positive integer when set, else "unspecified"/"set"/"unset".
func (s *Service) conflictMarkerSize(ctx context.Context, dir, path string) int {
	out, err := s.runAtRoot(ctx, dir, literalPathspecs, "check-attr", "-z", "conflict-marker-size", "--", path)
	if err != nil {
		return defaultMarkerSize
	}
	fields := strings.Split(out, "\x00")
	if len(fields) < 3 {
		return defaultMarkerSize
	}
	if n, convErr := strconv.Atoi(fields[2]); convErr == nil && n > 0 {
		return n
	}
	return defaultMarkerSize
}

// regionOpenerInStages reports whether any parsed region's opening marker line
// appears verbatim as a line in one of the conflict's index stages (base/ours/
// theirs). Because git adds real conflict markers around the merge — they are
// never part of the clean stage blobs — a match means that region's markers are
// literal file content, so the marker-based parse cannot be trusted.
func (s *Service) regionOpenerInStages(ctx context.Context, dir, path, content string, regions []ConflictRegion) (bool, error) {
	lines := strings.Split(content, "\n")
	openers := make(map[string]bool, len(regions))
	for _, r := range regions {
		if idx := r.StartLine - 1; idx >= 0 && idx < len(lines) {
			openers[strings.TrimSuffix(lines[idx], "\r")] = true
		}
	}
	if len(openers) == 0 {
		return false, nil
	}
	for _, rev := range []string{":1", ":2", ":3"} {
		fc, err := s.FileAtRev(ctx, dir, rev, path)
		if err != nil {
			return false, err
		}
		if fc.Content == "" {
			continue // stage absent (delete/modify) or binary/too-large
		}
		for _, raw := range strings.Split(fc.Content, "\n") {
			if openers[strings.TrimSuffix(raw, "\r")] {
				return true, nil
			}
		}
	}
	return false, nil
}

// repoRoot returns the repository top-level for dir. Unlike runAtRoot (which
// silently falls back to dir), this surfaces the error, because a path that
// cannot be resolved to a repo root must fail the operation rather than read a
// file relative to the wrong directory.
func (s *Service) repoRoot(ctx context.Context, dir string) (string, error) {
	out, err := s.run(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// ConflictRegion is one <<<<<<< / ======= / >>>>>>> block in a conflicted
// working-tree file. Line numbers are 1-based into the file the frontend
// displays. Ours/Base/Theirs hold the region's lines without their trailing
// newline (each entry is one line); they are always non-nil slices so a side
// that resolves to nothing (a delete/modify within the block) is an empty
// slice, never a JSON null. Base is populated only for diff3-style markers
// (HasBase); the default merge style omits the ||||||| section.
type ConflictRegion struct {
	Index      int      `json:"index"`
	StartLine  int      `json:"startLine"` // 1-based line of the <<<<<<< marker
	EndLine    int      `json:"endLine"`   // 1-based line of the >>>>>>> marker
	Ours       []string `json:"ours"`
	Base       []string `json:"base"`
	Theirs     []string `json:"theirs"`
	HasBase    bool     `json:"hasBase"`
	OursLabel  string   `json:"oursLabel"`  // text after <<<<<<< (e.g. "HEAD")
	TheirLabel string   `json:"theirLabel"` // text after >>>>>>> (e.g. branch name)
}

// Conflict marker characters. Git begins each marker line with a run of the
// same character exactly conflict-marker-size long, optionally followed by a
// space and a label.
const (
	markerOurs  = '<'
	markerBase  = '|'
	markerSep   = '='
	markerTheir = '>'
	// defaultMarkerSize is git's default marker width when the
	// conflict-marker-size attribute is unset.
	defaultMarkerSize = 7
)

// markerRun measures the leading run of the character ch in line and, if it is
// a conflict marker (run of at least minWidth, followed by end-of-line or a
// single space), returns the run width and the label after it. minWidth is the
// exact width to require when > 0 (used for the base/separator/closing markers,
// which must match the width of the region's opening marker), or the minimum
// acceptable width when passed as a floor for the opening marker.
func markerRun(line string, ch byte, exactWidth, minWidth int) (width int, label string, ok bool) {
	n := 0
	for n < len(line) && line[n] == ch {
		n++
	}
	if exactWidth > 0 {
		if n != exactWidth {
			return 0, "", false
		}
	} else if n < minWidth {
		return 0, "", false
	}
	rest := line[n:]
	switch {
	case rest == "":
		return n, "", true
	case rest[0] == ' ':
		return n, rest[1:], true
	default:
		return 0, "", false
	}
}

// parseConflictRegions extracts conflict regions from decoded file text. It is
// pure (no git, no disk) so the marker grammar is unit-testable in isolation.
//
// Git widens a conflict's markers past the base conflict-marker-size (+1 for
// rename conflicts, more for nested recursive merges) precisely so a region's
// own content can never contain a marker line of the region's exact width. We
// exploit that guarantee: gather the widths of the opening <<< runs actually
// present (each >= markerSize), then parse strictly at each candidate width and
// take the first that yields a clean, non-empty set of regions. Parsing at the
// exact width means a wider or narrower marker-shaped content line (a Markdown
// "=======" heading, documentation showing conflict markers) is treated as
// content, never mistaken for structure and never rejected as a stray marker.
// A file whose markers do not form clean regions at any candidate width returns
// an error, and the caller falls back to a plain editor.
func parseConflictRegions(content string, markerSize int) ([]ConflictRegion, error) {
	if markerSize < 1 {
		markerSize = defaultMarkerSize
	}
	// CRLF files decode with a trailing \r on every line; strip it so markers
	// match and side lines stay logical. The file's line ending is carried
	// separately (ConflictSnapshot.LineEndings) and reapplied on write.
	lines := strings.Split(content, "\n")
	for i := range lines {
		lines[i] = strings.TrimSuffix(lines[i], "\r")
	}

	widths := openingWidths(lines, markerSize)
	if len(widths) == 0 {
		return []ConflictRegion{}, nil // no conflict openings: nothing to resolve
	}
	// A well-formed file uses one marker width (occasionally a couple across
	// nested merges). A large spread of distinct opening-run widths is either
	// malformed or crafted to make us parse the whole file many times; cap the
	// candidates and fall back rather than do superlinear work.
	const maxCandidateWidths = 8
	if len(widths) > maxCandidateWidths {
		return nil, fmt.Errorf("too many distinct conflict marker widths (%d)", len(widths))
	}

	var cleanParses [][]ConflictRegion
	var firstErr error
	for _, w := range widths {
		regions, err := parseAtWidth(lines, w)
		switch {
		case err == nil && len(regions) > 0:
			cleanParses = append(cleanParses, regions)
		case err != nil && firstErr == nil:
			firstErr = err
		}
	}
	switch {
	case len(cleanParses) == 1:
		return cleanParses[0], nil
	case len(cleanParses) > 1:
		// More than one width parses cleanly (e.g. a widened conflict whose
		// content contains a complete narrower marker sample). We cannot tell
		// which is the real structure, so refuse rather than pick wrong.
		return nil, fmt.Errorf("ambiguous conflict markers: %d widths parse cleanly", len(cleanParses))
	case firstErr != nil:
		return nil, firstErr
	default:
		return []ConflictRegion{}, nil
	}
}

// openingWidths returns the distinct widths of opening (<<<) marker runs of at
// least markerSize, sorted ascending so the narrowest plausible width is tried
// first.
func openingWidths(lines []string, markerSize int) []int {
	seen := map[int]bool{}
	var widths []int
	for _, line := range lines {
		if w, _, ok := markerRun(line, markerOurs, 0, markerSize); ok && !seen[w] {
			seen[w] = true
			widths = append(widths, w)
		}
	}
	sort.Ints(widths)
	return widths
}

// parseAtWidth runs the conflict grammar with every marker required to be
// exactly w characters. Inside a region, a marker-shaped line at width w in the
// wrong position is malformed (git never emits it) and errors out; a line that
// is not a width-w marker is content. An unterminated region errors.
func parseAtWidth(lines []string, w int) ([]ConflictRegion, error) {
	const (
		outside = iota
		inOurs
		inBase
		inTheirs
	)
	isMark := func(line string, ch byte) bool {
		_, _, ok := markerRun(line, ch, w, 0)
		return ok
	}

	regions := []ConflictRegion{}
	section := outside
	var cur ConflictRegion

	for i, line := range lines {
		lineNo := i + 1
		switch section {
		case outside:
			if _, label, ok := markerRun(line, markerOurs, w, 0); ok {
				cur = ConflictRegion{
					Index:     len(regions),
					StartLine: lineNo,
					Ours:      []string{},
					Base:      []string{},
					Theirs:    []string{},
					OursLabel: label,
				}
				section = inOurs
			}
			// Any other line (including a narrower/wider marker-shaped divider)
			// is content outside a conflict.
		case inOurs:
			switch {
			case isMark(line, markerBase):
				cur.HasBase = true
				section = inBase
			case isMark(line, markerSep):
				section = inTheirs
			case isMark(line, markerOurs) || isMark(line, markerTheir):
				return nil, fmt.Errorf("malformed conflict marker at line %d", lineNo)
			default:
				cur.Ours = append(cur.Ours, line)
			}
		case inBase:
			switch {
			case isMark(line, markerSep):
				section = inTheirs
			case isMark(line, markerOurs) || isMark(line, markerBase) || isMark(line, markerTheir):
				return nil, fmt.Errorf("malformed conflict marker at line %d", lineNo)
			default:
				cur.Base = append(cur.Base, line)
			}
		case inTheirs:
			switch {
			case isMark(line, markerTheir):
				_, label, _ := markerRun(line, markerTheir, w, 0)
				cur.EndLine = lineNo
				cur.TheirLabel = label
				regions = append(regions, cur)
				section = outside
			case isMark(line, markerOurs) || isMark(line, markerSep) || isMark(line, markerBase):
				return nil, fmt.Errorf("malformed conflict marker at line %d", lineNo)
			default:
				cur.Theirs = append(cur.Theirs, line)
			}
		}
	}

	if section != outside {
		return nil, fmt.Errorf("unterminated conflict starting at line %d", cur.StartLine)
	}
	return regions, nil
}

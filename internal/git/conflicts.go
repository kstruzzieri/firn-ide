package git

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
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
	// conflicted): remove the path and stage the removal.
	if chosen == nil {
		_, err := s.runAtRoot(ctx, dir, literalPathspecs, "rm", "-f", "--", path)
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
// Malformed markers (a nested <<<<<<<, a stray =======, an unterminated block,
// or a >>>>>>> with no open conflict) return an error: the caller falls back to
// a plain editor rather than presenting a resolution surface it cannot trust.
func parseConflictRegions(content string, markerSize int) ([]ConflictRegion, error) {
	if markerSize < 1 {
		markerSize = defaultMarkerSize
	}
	regions := []ConflictRegion{}
	lines := strings.Split(content, "\n")

	// section tracks where inside a conflict block we are.
	const (
		outside = iota
		inOurs
		inBase
		inTheirs
	)
	section := outside
	var cur ConflictRegion
	// curWidth is the marker width of the region currently open, set from its
	// opening <<< run. Git widens outer markers by one char for rename/add and
	// rename/rename conflicts (and by more for nested merges), so the opening
	// run is >= markerSize; every later marker in the SAME region must match
	// that exact width, which keeps a narrower marker-shaped content line from
	// being read as a separator.
	curWidth := 0

	newRegion := func(lineNo int, label string) ConflictRegion {
		return ConflictRegion{
			Index:     len(regions),
			StartLine: lineNo,
			Ours:      []string{},
			Base:      []string{},
			Theirs:    []string{},
			OursLabel: label,
		}
	}

	for i, raw := range lines {
		lineNo := i + 1
		// CRLF files decode with a trailing \r on every line; strip it so
		// markers match and side lines stay logical. The file's line ending is
		// carried separately (ConflictSnapshot.LineEndings) and reapplied when
		// the resolved file is written, so dropping \r here is lossless.
		line := strings.TrimSuffix(raw, "\r")

		if section == outside {
			if w, label, ok := markerRun(line, markerOurs, 0, markerSize); ok {
				cur = newRegion(lineNo, label)
				curWidth = w
				section = inOurs
				continue
			}
			// A closing/base/separator marker with no open conflict is malformed.
			if isStrayMarker(line, markerSize) {
				return nil, fmt.Errorf("unexpected conflict marker at line %d", lineNo)
			}
			continue // ordinary content outside any conflict
		}

		switch section {
		case inOurs:
			if _, _, ok := markerRun(line, markerBase, curWidth, 0); ok {
				cur.HasBase = true
				section = inBase
				continue
			}
			if _, _, ok := markerRun(line, markerSep, curWidth, 0); ok {
				section = inTheirs
				continue
			}
			if _, _, ok := markerRun(line, markerOurs, curWidth, 0); ok {
				return nil, fmt.Errorf("nested conflict marker at line %d", lineNo)
			}
			cur.Ours = append(cur.Ours, line)
		case inBase:
			if _, _, ok := markerRun(line, markerSep, curWidth, 0); ok {
				section = inTheirs
				continue
			}
			cur.Base = append(cur.Base, line)
		case inTheirs:
			if _, label, ok := markerRun(line, markerTheir, curWidth, 0); ok {
				cur.EndLine = lineNo
				cur.TheirLabel = label
				regions = append(regions, cur)
				section = outside
				curWidth = 0
				continue
			}
			cur.Theirs = append(cur.Theirs, line)
		}
	}

	if section != outside {
		return nil, fmt.Errorf("unterminated conflict starting at line %d", cur.StartLine)
	}
	return regions, nil
}

// isStrayMarker reports whether line is a base, separator, or closing marker
// (run >= markerSize) appearing with no conflict open — a malformed file the
// caller treats as fallback-to-plain-editor.
func isStrayMarker(line string, markerSize int) bool {
	for _, ch := range []byte{markerBase, markerSep, markerTheir} {
		if _, _, ok := markerRun(line, ch, 0, markerSize); ok {
			return true
		}
	}
	return false
}

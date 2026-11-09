package search

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// rgLookup is the function used to resolve the ripgrep binary on PATH. It is
// a package variable solely so tests can swap in a deterministic stub. There
// is no fallback path or hard-coded alternate location: if rg is missing, the
// caller receives StatusMissingTool.
var rgLookup = exec.LookPath

// rgBinaryName is the program name we resolve via rgLookup. Like rgLookup it
// is a package variable so a test can point the runner at a different program
// name. No test does today, but the tests that stub rgLookup save and restore
// this alongside it: Go runs a package's tests in a single process, so an
// override left behind would follow every later test in the package.
var rgBinaryName = "rg"

// runnerConfig holds per-run knobs. We keep it tiny so tests can construct
// configs inline without referencing unexported globals.
type runnerConfig struct {
	// MatchCap is the maximum number of LineMatch entries collected before
	// the runner stops appending and flags the response Truncated.
	MatchCap int
	// Timeout is the maximum wall-clock time a single rg run may take.
	Timeout time.Duration
}

// defaultRunnerConfig provides production defaults. They are referenced
// rather than copied into every call site so the values are easy to tune.
func defaultRunnerConfig() runnerConfig {
	return runnerConfig{
		MatchCap: 5000,
		Timeout:  30 * time.Second,
	}
}

// errInvalidRegex is returned by runRipgrep when rg exits with status 2
// and its stderr indicates a regex parse failure.
var errInvalidRegex = errors.New("invalid regular expression")

// errCanceled is returned when the supplied context is canceled before
// rg finishes. The caller maps it to StatusCanceled.
var errCanceled = errors.New("search canceled")

// isMissingTool reports whether err originated from exec.LookPath failing to
// find ripgrep on PATH. exec.LookPath returns an *exec.Error wrapping
// exec.ErrNotFound; we walk the chain via errors.Is.
func isMissingTool(err error) bool {
	return errors.Is(err, exec.ErrNotFound)
}

// buildArgs converts a SearchRequest into ripgrep arguments. It never
// concatenates the query into a flag value; --regexp is used to keep the
// query in its own argv slot so leading dashes and other patterns are not
// mistaken for flags.
//
// Order:
//  1. --no-config: ignore user-level ripgrep configuration so our flags are
//     authoritative.
//  2. --no-require-git: honor .gitignore / .ignore even when the search root
//     is not inside a Git repository. Firn IDE workspaces commonly target
//     plain folders; without this flag ripgrep silently disables ignore rules
//     for non-Git roots and surfaces files the user expects to be hidden.
//  3. --json, --line-number, --column, --color=never: stable parsing contract.
//  4. Hidden folders (#450): --glob exclusions for .git, .hg and .svn, then
//     --hidden when IncludeHidden, otherwise --glob '!.*/'.
//  5. Mode flags: --fixed-strings, --case-sensitive/--ignore-case, --word-regexp.
//  6. --regexp <query>: query is its own argv element; leading "-" is safe.
//  7. -- <paths...>: end-of-options sentinel so paths starting with "-" are
//     safe. paths defaults to the search root. runRipgrep also names files
//     ripgrep must search although an ignore rule matches them, the tracked
//     files of #536: ripgrep always searches a path named on its command line.
func buildArgs(req SearchRequest, paths ...string) []string {
	if len(paths) == 0 {
		paths = []string{req.Root}
	}
	args := make([]string, 0, 22+len(paths))
	args = append(args,
		// Ignore any user-level ripgrep config file so our explicit flags
		// are authoritative. Without this, a stray RIPGREP_CONFIG_PATH or
		// ~/.ripgreprc could change case behavior, ignore rules, etc.
		"--no-config",
		// Apply .gitignore / .ignore even outside a Git repo so workspaces
		// rooted at a plain folder still hide ignored files. Without this,
		// ripgrep requires the root to be inside a .git tree before it
		// honors any ignore rules at all.
		"--no-require-git",
		"--json",
		"--line-number",
		"--column",
		"--color", "never",
		// Version-control metadata is never searched (#450). ripgrep skips
		// it only as a hidden folder, so --hidden or an ignore file that
		// whitelists it would let it in. internal/filesystem's vcsDirs names
		// the same three for the tree and the named files.
		"--glob", "!.git",
		"--glob", "!.hg",
		"--glob", "!.svn",
	)
	if req.Options.IncludeHidden {
		args = append(args, "--hidden")
	} else {
		// Leaving out --hidden is not enough: ripgrep still enters a
		// dot-folder an ignore file whitelists. The trailing slash limits the
		// glob to folders, so dot-files stay as ripgrep treats them.
		args = append(args, "--glob", "!.*/")
	}

	if !req.Options.Regex {
		args = append(args, "--fixed-strings")
	}
	if req.Options.CaseSensitive {
		args = append(args, "--case-sensitive")
	} else {
		args = append(args, "--ignore-case")
	}
	if req.Options.WholeWord {
		args = append(args, "--word-regexp")
	}

	args = append(args, "--regexp", req.Query)
	args = append(args, "--")
	args = append(args, paths...)
	return args
}

// commandLineBudget bounds one ripgrep command line, in bytes. Windows caps a
// whole command line at 32,767 UTF-16 units, and a string's UTF-8 length is
// never below its UTF-16 length, so counting bytes is safe; the rest is the
// margin argsSize does not cover. A repository that committed a vendored
// folder and then ignored it can have thousands of tracked, ignored files.
// ponytail: one budget for every platform, sized for Windows; a few extra
// ripgrep starts elsewhere (macOS allows 1 MB) when the list is that long.
const commandLineBudget = 30 << 10

// argSize is the most command-line length arg can take: itself, the
// separating space, the quotes Windows may add, and a backslash for each quote
// or backslash in it, the most Windows escaping adds.
// ponytail: counts every backslash though Windows doubles only those before a
// quote or at the end, so Windows paths batch a little smaller than needed.
func argSize(arg string) int {
	return len(arg) + strings.Count(arg, `"`) + strings.Count(arg, `\`) + 3
}

// argsSize is the most command-line length args can take.
func argsSize(args []string) int {
	size := 0
	for _, arg := range args {
		size += argSize(arg)
	}
	return size
}

// includeBudget is the room one pass has for include paths: the command-line
// budget less the binary and everything else buildArgs puts on the line,
// root and query included. It can be negative for a query too long to search
// at all; includeBatches then gives each path a pass of its own.
func includeBudget(bin string, req SearchRequest) int {
	return commandLineBudget - argsSize([]string{bin}) - argsSize(buildArgs(req))
}

// includeBatches splits include into groups whose argsSize stays within
// budget. A path that does not fit even alone gets a group of its own.
func includeBatches(include []string, budget int) [][]string {
	var batches [][]string
	var batch []string
	size := 0
	for _, path := range include {
		cost := argSize(path)
		if len(batch) > 0 && size+cost > budget {
			batches = append(batches, batch)
			batch, size = nil, 0
		}
		batch = append(batch, path)
		size += cost
	}
	if len(batch) > 0 {
		batches = append(batches, batch)
	}
	return batches
}

// runOutcome captures the terminal state of one rg invocation.
type runOutcome struct {
	Truncated bool
	Err       error // typed: nil, errInvalidRegex, errCanceled, or wrapped failure
}

// runRipgrep executes ripgrep for req, streaming JSON events to onMatch via
// parseEvents. The function returns whether the result was truncated and an
// optional typed error. Exit code 1 is mapped to a successful empty run.
//
// include names files to search although an ignore rule matches them. They
// ride in batches sized to the command-line budget (includeBatches): the
// first pass searches the root and the first batch, each later pass one batch. The passes share one timeout, one
// MatchCap and one duplicate-line guard, and the first failure ends the run.
//
// The context owned by the caller controls cancelation. When ctx is canceled
// before rg finishes, runRipgrep returns errCanceled. Process group
// cleanup is delegated to exec.CommandContext + Wait; exec.CommandContext
// already kills the child process on context expiry on all supported OSes.
func runRipgrep(ctx context.Context, cfg runnerConfig, req SearchRequest, include []string, onMatch func(filePath string, m LineMatch) bool) runOutcome {
	bin, err := rgLookup(rgBinaryName)
	if err != nil {
		return runOutcome{Err: fmt.Errorf("ripgrep not found on PATH: %w", err)}
	}

	runCtx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()

	run := &ripgrepRun{
		ctx:      ctx,
		runCtx:   runCtx,
		cancel:   cancel,
		cfg:      cfg,
		bin:      bin,
		onMatch:  onMatch,
		lastLine: make(map[string]int),
	}
	batches := includeBatches(include, includeBudget(bin, req))
	paths := []string{req.Root}
	if len(batches) > 0 {
		paths = append(paths, batches[0]...)
	}
	for i := 0; ; i++ {
		// Cancelled before this pass starts (while the include paths were
		// listed, or between passes): exec would report a failed start.
		if ctx.Err() != nil {
			return runOutcome{Truncated: run.truncated, Err: errCanceled}
		}
		outcome := run.pass(buildArgs(req, paths...))
		if outcome.Err != nil || run.canceledAfterCap || i+1 >= len(batches) {
			return outcome
		}
		paths = batches[i+1]
	}
}

// ripgrepRun is the state one search shares across its ripgrep passes.
type ripgrepRun struct {
	ctx, runCtx context.Context
	cancel      context.CancelFunc
	cfg         runnerConfig
	bin         string
	onMatch     func(filePath string, m LineMatch) bool

	collected        int
	truncated        bool
	canceledAfterCap bool
	// lastLine is the last line delivered per file. ripgrep reports a file's
	// lines in ascending order, once per search of it, and searches a file
	// twice when the walk and an included path both reach it (git and
	// ripgrep can disagree about an ignore rule). A line at or before the
	// last one seen for that file is that second search: it is neither
	// delivered nor counted toward MatchCap.
	lastLine map[string]int
}

// pass runs one ripgrep process with args and classifies how it ended.
func (r *ripgrepRun) pass(args []string) runOutcome {
	ctx, runCtx, cfg := r.ctx, r.runCtx, r.cfg
	cmd := exec.CommandContext(runCtx, r.bin, args...)
	// Intentionally do not set cmd.Dir: we always pass an absolute search
	// root as a positional argument, and ripgrep emits absolute paths in
	// that mode. Setting Dir would couple ripgrep's CWD to the search root
	// and could surprise downstream tooling that inspects relative paths.

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return runOutcome{Err: fmt.Errorf("create rg stdout pipe: %w", err)}
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return runOutcome{Err: fmt.Errorf("create rg stderr pipe: %w", err)}
	}

	if err := cmd.Start(); err != nil {
		return runOutcome{Err: fmt.Errorf("start rg: %w", err)}
	}

	// Drain stderr concurrently so rg never blocks on a full pipe. We keep
	// the bytes for diagnostics in the failure path.
	stderrCh := make(chan []byte, 1)
	go func() {
		buf, _ := io.ReadAll(stderrPipe)
		stderrCh <- buf
	}()

	cancelAfterCap := func() {
		r.truncated = true
		r.canceledAfterCap = true
		r.cancel()
	}
	parseErr := parseEvents(stdout, func(filePath string, m LineMatch) bool {
		if last, seen := r.lastLine[filePath]; seen && m.Line <= last {
			return true
		}
		r.lastLine[filePath] = m.Line
		if r.collected >= cfg.MatchCap {
			cancelAfterCap()
			return false
		}
		r.collected++
		if !r.onMatch(filePath, m) {
			cancelAfterCap()
			return false
		}
		return true
	})
	truncated := r.truncated

	// Always read remaining stdout so rg can exit cleanly even after we stop
	// collecting. parseEvents already drains via the scanner, but if it
	// returned early on a malformed line we need to copy the rest into the
	// void to unblock rg.
	_, _ = io.Copy(io.Discard, stdout)

	// Receive the drained stderr before Wait: Wait closes the pipe, and a
	// close racing the goroutine's ReadAll can drop stderr bytes we need for
	// the exit-code-2 regex classification below. Stdout is already at EOF
	// here, so the process has finished writing and this receive is bounded
	// by process exit (which the runCtx timeout in turn bounds).
	stderrBytes := <-stderrCh
	waitErr := cmd.Wait()

	// Cancelation outranks all other classifications. Check ctx (caller
	// cancel) and runCtx (timeout) separately so we can give a precise
	// message later if needed.
	if ctxErr := ctx.Err(); ctxErr != nil {
		return runOutcome{Truncated: truncated, Err: errCanceled}
	}

	if r.canceledAfterCap {
		return runOutcome{Truncated: true}
	}

	if waitErr == nil {
		// Exit code 0: matches found. parseErr (if any) is a real failure.
		if parseErr != nil {
			return runOutcome{Truncated: truncated, Err: fmt.Errorf("parse rg output: %w", parseErr)}
		}
		return runOutcome{Truncated: truncated}
	}

	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		switch exitErr.ExitCode() {
		case 1:
			// Successful empty run. parseErr should be nil but if it isn't,
			// the JSON stream was malformed which is a real failure.
			if parseErr != nil {
				return runOutcome{Truncated: truncated, Err: fmt.Errorf("parse rg output: %w", parseErr)}
			}
			return runOutcome{}
		case 2:
			msg := classifyStderr(stderrBytes)
			if isRegexError(stderrBytes) {
				return runOutcome{Err: fmt.Errorf("%w: %s", errInvalidRegex, msg)}
			}
			return runOutcome{Err: fmt.Errorf("ripgrep failed: %s", msg)}
		default:
			// Negative exit code on Unix indicates the process was signaled
			// (for example by context cancelation killing it). If runCtx is
			// done due to deadline we report a timeout-shaped failure; if
			// the parent ctx is already canceled we returned earlier.
			if runCtx.Err() != nil && ctx.Err() == nil {
				return runOutcome{Truncated: truncated, Err: fmt.Errorf("ripgrep timed out after %s", cfg.Timeout)}
			}
			return runOutcome{Truncated: truncated, Err: fmt.Errorf("ripgrep exited with code %d: %s", exitErr.ExitCode(), classifyStderr(stderrBytes))}
		}
	}

	// Non-ExitError waitErr typically means the process could not be reaped
	// or was killed before producing an exit status.
	return runOutcome{Truncated: truncated, Err: fmt.Errorf("ripgrep wait failed: %w (%s)", waitErr, classifyStderr(stderrBytes))}
}

// classifyStderr returns a single-line, trimmed version of stderr suitable
// for surfacing in error messages. Multi-line stderr is collapsed to its
// first non-empty line so the user sees the headline cause.
func classifyStderr(b []byte) string {
	s := strings.TrimSpace(string(b))
	if s == "" {
		return "no stderr output"
	}
	if first, _, found := strings.Cut(s, "\n"); found {
		first = strings.TrimSpace(first)
		if first != "" {
			return first
		}
	}
	return s
}

// isRegexError detects ripgrep's pattern-rejection stderr signatures.
// ripgrep prints messages such as "regex parse error:" or "error parsing
// regex" when the supplied pattern is invalid, and refuses literal newlines
// in patterns ("the literal \n is not allowed in a regex"). We treat all of
// these as invalid-regex/invalid-pattern conditions so the UI can ask the
// user to adjust the query rather than reporting a generic failure. We
// match stable substrings to stay robust across ripgrep versions.
func isRegexError(stderr []byte) bool {
	s := strings.ToLower(string(stderr))
	return strings.Contains(s, "regex parse error") ||
		strings.Contains(s, "error parsing regex") ||
		strings.Contains(s, "unrecognized escape sequence") ||
		strings.Contains(s, "invalid character class") ||
		strings.Contains(s, "not allowed in a regex")
}

// validateRequest enforces the contract documented on SearchRequest. It
// returns a typed status (StatusInvalidRegex is reserved for ripgrep itself;
// validation here covers structural problems before we even spawn rg) and
// an error message safe to forward to the user.
func validateRequest(req SearchRequest, statRoot func(string) (isDir bool, err error)) (SearchStatus, string) {
	if strings.TrimSpace(req.RequestID) == "" {
		return StatusFailed, "requestId is required"
	}
	if req.Query == "" {
		return StatusFailed, "query is required"
	}
	if strings.TrimSpace(req.Root) == "" {
		return StatusFailed, "search root is required"
	}
	if !filepath.IsAbs(req.Root) {
		return StatusFailed, "search root must be an absolute path"
	}
	isDir, err := statRoot(req.Root)
	if err != nil {
		return StatusFailed, fmt.Sprintf("search root unavailable: %s", err.Error())
	}
	if !isDir {
		return StatusFailed, "search root is not a directory"
	}
	return StatusSuccess, ""
}

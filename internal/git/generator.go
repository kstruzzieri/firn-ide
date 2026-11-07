package git

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"unicode"

	"github.com/kstruzzieri/go-llm/agent"
	agenttools "github.com/kstruzzieri/go-llm/agent/tools"
	"github.com/kstruzzieri/go-llm/golem"
	"github.com/kstruzzieri/go-llm/provider"

	"firn/internal/ai"
)

// maxPromptBytes bounds the serialized staged-diff context handed to golem.
const maxPromptBytes = 48 * 1024

const truncatedDiffMarker = "\n[diff truncated for prompt budget]"

const generateSystem = "Generate commit messages using only the supplied staged-diff context. Do not call tools."

const generateInstruction = `Write a git commit message for the staged diff below.
Rules: imperative mood, subject line of at most 72 characters, optional short
body separated by a blank line explaining why. Output ONLY the commit message,
no fences, no commentary.`

var (
	errNothingStaged = errors.New("nothing staged: stage changes before generating a message")
	// errStagedChangesMoved stops a request when the staged paths or the
	// policy's verdict on them changed between checking them and building
	// the diff: an unchecked path could have landed under an allowed one.
	errStagedChangesMoved = errors.New("the staged changes or the AI policy changed while the message was being prepared; generate again")
	// errNoToolAccess denies every runtime file tool: the staged diff is the
	// only workspace content a commit message may use.
	errNoToolAccess = errors.New("commit message generation reads no workspace files")
	// errNoGolemModel stops a scope that names no model before any request.
	errNoGolemModel = errors.New("commit message generation has no Golem model")
)

// noWindowInputCeiling is the input budget, in tokens, for a Golem model that
// declares no context window: the 48 KiB byte-bounded diff is ~12K tokens,
// well under it, and past it the provider's own limit applies (#506).
const noWindowInputCeiling = 32 * 1024

// MessageGenerator produces commit messages from a staged diff via the public
// golem runtime, sent only to the Golem model (#491), behind the AI scope
// policy for staged paths.
type MessageGenerator struct {
	scopeSource func(repoRoot string) (StagedScope, error)
}

// StagedScope decides which staged paths of one git working tree may reach
// the model (#384). Paths are relative to the git top level.
type StagedScope struct {
	// Guard denies a path that may not reach the model.
	Guard agenttools.ScopeGuard
	// Protected reports a path whose content the policy protects, as opposed
	// to one Guard denies only for lying outside the open project. Unmodified
	// and deleted protected files are checked as copy sources; nil checks
	// none.
	Protected func(path string) bool
	// Model is the Golem model generation sends to: the target Golem chat
	// resolved from the configuration it has loaded (#491). Nil sends nothing.
	Model *ai.GolemModel
	// Release, when set, runs once generation is done with Model.
	Release func()
}

func NewMessageGenerator() *MessageGenerator { return &MessageGenerator{} }

// CommitMessageResult is a generated message and the staged paths the scope
// policy withheld from the model, each "path" or "old -> new". Withheld is for
// local display only and never reaches the model. Message is empty when every
// staged path was withheld: no request was made.
type CommitMessageResult struct {
	Message  string   `json:"message"`
	Withheld []string `json:"withheld"`
}

// SetScopeSource injects what decides which staged paths may reach the model
// for the git working tree at repoRoot. An error stops generation before any
// request. Nil (the default) withholds every path, as a detached policy does
// in chat.
func (g *MessageGenerator) SetScopeSource(src func(repoRoot string) (StagedScope, error)) {
	g.scopeSource = src
}

// GenerateStaged lists what is staged in dir's repository, withholds every
// path the scope policy denies (a rename or copy when either side is), builds
// the diff from the rest and asks the model for a message. Neither the content
// nor the name of a withheld path reaches the model; the prompt says only how
// many were withheld. When everything is withheld no runtime is started and
// the result carries no message.
func (g *MessageGenerator) GenerateStaged(ctx context.Context, svc *Service, dir string) (CommitMessageResult, error) {
	root, err := svc.TopLevel(ctx, dir)
	if err != nil {
		return CommitMessageResult{}, err
	}
	scope := StagedScope{Guard: func(string, bool) error { return errors.New("no AI scope policy") }}
	if g.scopeSource != nil {
		if scope, err = g.scopeSource(root); err != nil {
			return CommitMessageResult{}, err
		}
	}
	if scope.Release != nil {
		defer scope.Release()
	}
	guard := scope.Guard
	changes, err := svc.StagedChanges(ctx, dir, memoize(scope.Protected))
	if err != nil {
		return CommitMessageResult{}, err
	}
	if len(changes) == 0 {
		return CommitMessageResult{}, errNothingStaged
	}
	allowed, withheld, excluded := partitionStaged(changes, guard)
	result := CommitMessageResult{Withheld: withheld}
	if len(allowed) == 0 {
		return result, nil
	}
	diff, err := svc.StagedDiff(ctx, dir, excluded)
	if err != nil {
		return CommitMessageResult{}, err
	}
	// The diff names everything staged but excluded, so anything staged after
	// the listing would ride along unchecked: list and check again.
	// ponytail: a re-list, not an index snapshot, so an index changed and
	// changed back between the two listings goes unseen; copying the index
	// for GIT_INDEX_FILE would close it if that ever matters.
	// A fresh cache, so the recheck sees a source the policy protected since.
	recheck := func() error {
		again, err := svc.StagedChanges(ctx, dir, memoize(scope.Protected))
		if err != nil {
			return err
		}
		if againAllowed, _, _ := partitionStaged(again, guard); !slices.Equal(again, changes) || !slices.Equal(againAllowed, allowed) {
			return errStagedChangesMoved
		}
		return nil
	}
	if err := recheck(); err != nil {
		return CommitMessageResult{}, err
	}
	result.Message, err = g.generate(ctx, dir, diff, len(withheld), scope.Model, recheck)
	if err != nil {
		return CommitMessageResult{}, err
	}
	return result, nil
}

// memoize caches protected's answers for one listing, which asks about some
// paths more than once. nil stays nil.
func memoize(protected func(string) bool) func(string) bool {
	if protected == nil {
		return nil
	}
	seen := map[string]bool{}
	return func(path string) bool {
		answer, ok := seen[path]
		if !ok {
			answer = protected(path)
			seen[path] = answer
		}
		return answer
	}
}

// partitionStaged applies guard to each staged change. allowed holds every
// path the diff may name, both sides of an allowed rename or copy; withheld
// holds each withheld change for display, "path" or "old -> new"; excluded
// holds every withheld path, both sides, which the diff leaves out.
func partitionStaged(changes []StagedChange, guard agenttools.ScopeGuard) (allowed, withheld, excluded []string) {
	withheld = []string{}
	for _, change := range changes {
		paths := []string{change.Path}
		if change.OldPath != "" {
			paths = append(paths, change.OldPath)
		}
		denied := false
		for _, path := range paths {
			denied = denied || guard(path, false) != nil
		}
		if !denied {
			allowed = append(allowed, paths...)
			continue
		}
		name := change.Path
		if change.OldPath != "" {
			name = change.OldPath + " -> " + change.Path
		}
		withheld = append(withheld, name)
		excluded = append(excluded, paths...)
	}
	return allowed, withheld, excluded
}

// deniedFieldCap bounds each rendered field in RUNES.
const deniedFieldCap = 256

// scrubField drops control, format, and line/paragraph separator runes and
// truncates on a rune boundary, so a field can neither forge message lines
// nor split a multibyte sequence (spec D3b).
func scrubField(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || unicode.Is(unicode.Zl, r) || unicode.Is(unicode.Zp, r) {
			continue
		}
		out = append(out, r)
		if len(out) == deniedFieldCap {
			break
		}
	}
	return string(out)
}

// runError words a failed generation run for the Git panel. window is the
// Golem model's declared context window.
func runError(err error, window int) error {
	// Golem joins a cancellation that lands before it commits the run's end onto
	// the run's error, and that is no reason to send anyone to their config.
	if errors.Is(err, agent.ErrContextExhausted) && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
		return contextWindowError(window)
	}
	return fmt.Errorf("golem runtime run: %w", err)
}

// contextWindowError refuses a prompt the Golem model's context window cannot
// hold. No request was sent.
func contextWindowError(window int) error {
	size := "no context_window"
	if window != 0 {
		size = fmt.Sprintf("context_window %d", window)
	}
	return fmt.Errorf("commit message generation blocked: the Golem model's context window (%s) is too small for this staged diff; raise context_window for the Golem model in the Golem configuration view, or stage less: %w", size, ai.ErrContextWindowTooSmall)
}

// destinationDeniedMessage renders a boundary-safe description from the
// TYPED error's own fields only — never from the surrounding chain (F14).
func destinationDeniedMessage(err error) (string, bool) {
	var denied *provider.DestinationDeniedError
	if !errors.As(err, &denied) {
		return "", false
	}
	target := denied.Destination.String()
	if denied.Destination.IsZero() {
		target = "provider " + denied.Provider
	}
	purpose := denied.Purpose
	if purpose == "" {
		purpose = "unknown purpose"
	}
	return "destination " + scrubField(target) + " is not consented for " + scrubField(purpose), true
}

// Available reports whether commit-message generation is embedded in Firn.
// Always true: a static probe cannot predict whether generation will work — the
// Golem model may be missing, unapproved or stopped — so failures surface as
// errors from Generate instead of hiding the feature.
func (*MessageGenerator) Available(context.Context) bool { return true }

// generate runs one golem turn over diff, which the caller has already
// filtered, sent only to model (#491). withheld is the number of staged paths
// left out of diff; the prompt states the count and nothing else.
func (g *MessageGenerator) generate(ctx context.Context, root, diff string, withheld int, model *ai.GolemModel, beforeSend func() error) (message string, err error) {
	if strings.TrimSpace(diff) == "" {
		return "", errNothingStaged
	}
	if model == nil {
		return "", errNoGolemModel
	}
	stagedDiff, err := stagedDiffContext(diff)
	if err != nil {
		return "", fmt.Errorf("golem runtime context: %w", err)
	}

	// The model's own orchestrator, budget and options: golem bootstraps no
	// provider and loads no configuration. Its destination is admitted here.
	opts, err := model.Options()
	if err != nil {
		if msg, ok := destinationDeniedMessage(err); ok {
			// Wraps the SENTINEL only: classification survives, the original
			// chain does not travel (spec D3b).
			return "", fmt.Errorf("commit message generation blocked: %s; use Approve missing destinations in the Golem configuration view: %w", msg, provider.ErrDestinationDenied)
		}
		if errors.Is(err, ai.ErrContextWindowTooSmall) {
			return "", contextWindowError(model.ContextWindow())
		}
		return "", fmt.Errorf("golem runtime initialization: %w", err)
	}
	if opts.Budget.InputCeiling == 0 {
		opts.Budget.InputCeiling = noWindowInputCeiling
	}
	opts.Root = root
	opts.ScopeGuard = func(string, bool) error { return errNoToolAccess }
	opts.System = generateSystem
	opts.MaxSteps = 1 // Never send built-in read-tool output in a second provider request.
	// Every generation is one isolated conversation. Keep its session only in
	// memory; a non-empty ThreadID otherwise opens golem's durable store.
	opts.SessionStore = ai.NewMemorySessionStore()
	// No history is reused, so nothing is ever summarized.
	opts.DisableCompression = true
	opts.OnWarning = func(warning error) { log.Printf("git: golem warning: %v", warning) }
	runtime, err := golem.New(ctx, opts)
	if err != nil {
		return "", fmt.Errorf("golem runtime initialization: %w", err)
	}
	defer func() {
		if closeErr := runtime.Close(); closeErr != nil {
			message = ""
			err = errors.Join(err, fmt.Errorf("golem runtime close: %w", closeErr))
		}
	}()

	instruction := generateInstruction
	if withheld > 0 {
		noun := "files were"
		if withheld == 1 {
			noun = "file was"
		}
		instruction += fmt.Sprintf("\n%d staged %s withheld from this diff by the repository's AI policy. Do not guess at what was withheld.", withheld, noun)
	}
	// Recheck just before sending the diff, in case the repository, policy, or
	// staged paths changed since the first recheck.
	if beforeSend != nil {
		if err := beforeSend(); err != nil {
			return "", err
		}
	}
	result, err := runtime.Run(ctx, golem.Turn{
		// OpenCode Go requires a session even for an auxiliary coding request;
		// the model's caller blinds this thread ID into the one opencode gets,
		// as chat's does. Unlike chat's repo-derived thread ID, it carries no
		// repository or user identity and cannot correlate separate
		// generations (#306).
		ThreadID: "firn-commit-" + rand.Text(),
		RunID:    "firn-commit-message",
		Message:  instruction,
		Context:  []golem.ContextItem{stagedDiff},
	}, func(golem.Event) error { return nil })
	if err != nil {
		return "", runError(err, model.ContextWindow())
	}

	message = strings.TrimSpace(result.Answer)
	if message == "" || strings.ContainsRune(message, '\x00') {
		return "", errors.New("golem returned an unusable message")
	}
	return message, nil
}

func stagedDiffContext(diff string) (golem.ContextItem, error) {
	searchLimit := min(len(diff), maxPromptBytes)
	item := golem.ContextItem{Description: "staged diff", Value: diff[:searchLimit]}
	encoded, err := json.Marshal([]golem.ContextItem{item})
	if err != nil {
		return golem.ContextItem{}, fmt.Errorf("serialize staged diff: %w", err)
	}
	if searchLimit == len(diff) && len(encoded) <= maxPromptBytes {
		return item, nil
	}

	low, high := 0, searchLimit
	for low < high {
		mid := low + (high-low+1)/2
		item.Value = diff[:mid] + truncatedDiffMarker
		encoded, err = json.Marshal([]golem.ContextItem{item})
		if err != nil {
			return golem.ContextItem{}, fmt.Errorf("serialize staged diff: %w", err)
		}
		if len(encoded) <= maxPromptBytes {
			low = mid
		} else {
			high = mid - 1
		}
	}
	item.Value = diff[:low] + truncatedDiffMarker
	encoded, err = json.Marshal([]golem.ContextItem{item})
	if err != nil {
		return golem.ContextItem{}, fmt.Errorf("serialize staged diff: %w", err)
	}
	if len(encoded) > maxPromptBytes {
		return golem.ContextItem{}, errors.New("serialized staged diff exceeds prompt budget")
	}
	return item, nil
}

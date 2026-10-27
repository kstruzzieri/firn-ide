package git

import (
	"context"
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
)

// MessageGenerator produces commit messages from a staged diff via the public
// golem runtime, behind the consent-derived destination policy and the AI
// scope policy for staged paths.
type MessageGenerator struct {
	destinationPolicy func() provider.DestinationPolicy
	scopeSource       func(repoRoot string) (StagedScope, error)
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
	// ConfigPath is the go-llm config source Guard protects, which the runtime
	// then loads; "" lets go-llm discover its own.
	ConfigPath string
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
	guard, configPath := scope.Guard, scope.ConfigPath
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
	again, err := svc.StagedChanges(ctx, dir, memoize(scope.Protected))
	if err != nil {
		return CommitMessageResult{}, err
	}
	if againAllowed, _, _ := partitionStaged(again, guard); !slices.Equal(again, changes) || !slices.Equal(againAllowed, allowed) {
		return CommitMessageResult{}, errStagedChangesMoved
	}
	result.Message, err = g.generate(ctx, dir, diff, len(withheld), configPath)
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

// SetDestinationPolicySource injects the consent-derived policy, evaluated
// fresh on every Generate so a new grant applies without restart. Nil (the
// default) leaves the zero policy: local-only, fail closed. Firn only ever
// builds an exact-grant policy here — the go-llm variant that grants every
// destination is forbidden in Firn (spec D2).
func (g *MessageGenerator) SetDestinationPolicySource(src func() provider.DestinationPolicy) {
	g.destinationPolicy = src
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
// Always true: a static probe cannot predict whether generation will work — a
// missing models.json falls back to a synthetic local-provider config, and a
// present config can still point at a stopped provider — so failures surface
// as errors from Generate instead of hiding the feature.
func (*MessageGenerator) Available(context.Context) bool { return true }

// generate runs one golem turn over diff, which the caller has already
// filtered. withheld is the number of staged paths left out of diff; the
// prompt states the count and nothing else. configPath pins the go-llm config
// the runtime loads; "" lets it discover its own.
func (g *MessageGenerator) generate(ctx context.Context, root, diff string, withheld int, configPath string) (message string, err error) {
	if strings.TrimSpace(diff) == "" {
		return "", errNothingStaged
	}
	stagedDiff, err := stagedDiffContext(diff)
	if err != nil {
		return "", fmt.Errorf("golem runtime context: %w", err)
	}

	policy := provider.DestinationPolicy{}
	if g.destinationPolicy != nil {
		policy = g.destinationPolicy()
	}
	runtime, err := golem.New(ctx, golem.Options{
		Root:       root,
		ConfigPath: configPath,
		ScopeGuard: func(string, bool) error { return errNoToolAccess },
		System:     generateSystem,
		MaxSteps:   1, // Never send built-in read-tool output in a second provider request.
		// No ThreadID is ever submitted, so history compression cannot run for
		// this consumer; disabling it keeps the summarize route OUT of
		// destination admission entirely (spec D3a).
		DisableCompression: true,
		// InputCeiling is tokens, not bytes: the 48 KiB byte-bounded context is
		// ~12K tokens, well under it. It does not track the configured model's
		// real context window; an undersized model rejects at the provider and
		// that error surfaces from Run.
		Budget:            agent.Budget{InputCeiling: 32 * 1024},
		DestinationPolicy: policy,
		OnWarning:         func(warning error) { log.Printf("git: golem warning: %v", warning) },
	})
	if err != nil {
		if msg, ok := destinationDeniedMessage(err); ok {
			// Wraps the SENTINEL only: classification survives, the original
			// chain does not travel (spec D3b).
			return "", fmt.Errorf("commit message generation blocked: %s; use Approve missing destinations in the Golem configuration view: %w", msg, provider.ErrDestinationDenied)
		}
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
	result, err := runtime.Run(ctx, golem.Turn{
		RunID:   "firn-commit-message",
		Message: instruction,
		Context: []golem.ContextItem{stagedDiff},
	}, func(golem.Event) error { return nil })
	if err != nil {
		if msg, ok := destinationDeniedMessage(err); ok {
			return "", fmt.Errorf("commit message generation blocked: %s; use Approve missing destinations in the Golem configuration view: %w", msg, provider.ErrDestinationDenied)
		}
		return "", fmt.Errorf("golem runtime run: %w", err)
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

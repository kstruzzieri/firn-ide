package git

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
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

var errNothingStaged = errors.New("nothing staged: stage changes before generating a message")

// MessageGenerator produces commit messages from a staged diff via the public
// golem runtime, behind the consent-derived destination policy and the AI
// scope policy for staged paths.
type MessageGenerator struct {
	destinationPolicy func() provider.DestinationPolicy
	scopeGuard        func(repoRoot string) agenttools.ScopeGuard
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

// SetScopeGuardSource injects the guard that decides which staged paths may
// reach the model: Golem chat's scope policy for the repository at repoRoot,
// applied to repo-relative paths (#384). Nil (the default) withholds every
// path, as a detached policy does in chat.
func (g *MessageGenerator) SetScopeGuardSource(src func(repoRoot string) agenttools.ScopeGuard) {
	g.scopeGuard = src
}

// GenerateStaged lists what is staged in dir's repository, withholds every
// path the scope policy denies (a rename or copy when either side is), builds
// the diff from the rest and asks the model for a message. Neither the content
// nor the name of a withheld path reaches the model; the prompt says only how
// many were withheld. When everything is withheld no runtime is started and
// the result carries no message.
func (g *MessageGenerator) GenerateStaged(ctx context.Context, svc *Service, dir string) (CommitMessageResult, error) {
	changes, err := svc.StagedChanges(ctx, dir)
	if err != nil {
		return CommitMessageResult{}, err
	}
	if len(changes) == 0 {
		return CommitMessageResult{}, errNothingStaged
	}
	root, err := svc.TopLevel(ctx, dir)
	if err != nil {
		return CommitMessageResult{}, err
	}
	guard := agenttools.ScopeGuard(func(string, bool) error { return errors.New("no AI scope policy") })
	if g.scopeGuard != nil {
		guard = g.scopeGuard(root)
	}
	result := CommitMessageResult{Withheld: []string{}}
	var allowed []string
	for _, change := range changes {
		if guard(change.Path, false) != nil || (change.OldPath != "" && guard(change.OldPath, false) != nil) {
			name := change.Path
			if change.OldPath != "" {
				name = change.OldPath + " -> " + change.Path
			}
			result.Withheld = append(result.Withheld, name)
			continue
		}
		allowed = append(allowed, change.Path)
		if change.OldPath != "" {
			allowed = append(allowed, change.OldPath)
		}
	}
	if len(allowed) == 0 {
		return result, nil
	}
	diff, err := svc.StagedDiff(ctx, dir, allowed)
	if err != nil {
		return CommitMessageResult{}, err
	}
	result.Message, err = g.generate(ctx, dir, diff, len(result.Withheld))
	if err != nil {
		return CommitMessageResult{}, err
	}
	return result, nil
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

// Generate asks the embedded golem runtime for a commit message describing
// diff, which the caller has already filtered.
func (g *MessageGenerator) Generate(ctx context.Context, root, diff string) (string, error) {
	return g.generate(ctx, root, diff, 0)
}

// generate runs one golem turn over diff. withheld is the number of staged
// paths left out of diff; the prompt states the count and nothing else.
func (g *MessageGenerator) generate(ctx context.Context, root, diff string, withheld int) (message string, err error) {
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
		Root:     root,
		System:   generateSystem,
		MaxSteps: 1, // Never send built-in read-tool output in a second provider request.
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

package git

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/kstruzzieri/go-llm/agent"
	"github.com/kstruzzieri/go-llm/golem"
)

// maxPromptBytes bounds the prompt handed to golem. Local models have small
// context windows; a giant diff would be truncated by the model anyway, so
// truncate deliberately and say so in the prompt.
const maxPromptBytes = 48 * 1024

const generateInstruction = `Write a git commit message for the staged diff below.
Rules: imperative mood, subject line of at most 72 characters, optional short
body separated by a blank line explaining why. Output ONLY the commit message,
no fences, no commentary.`

// MessageGenerator produces commit messages from a staged diff via the public
// golem runtime.
type MessageGenerator struct{}

func NewMessageGenerator() *MessageGenerator { return &MessageGenerator{} }

// Available reports whether commit-message generation is embedded in Firn.
func (*MessageGenerator) Available(context.Context) bool { return true }

// Generate asks the embedded golem runtime for a commit message describing diff.
func (*MessageGenerator) Generate(ctx context.Context, root, diff string) (message string, err error) {
	if strings.TrimSpace(diff) == "" {
		return "", errors.New("nothing staged: stage changes before generating a message")
	}
	if len(diff) > maxPromptBytes {
		diff = diff[:maxPromptBytes] + "\n[diff truncated for prompt budget]"
	}

	runtime, err := golem.New(ctx, golem.Options{
		Root:   root,
		Budget: agent.Budget{InputCeiling: 32 * 1024},
	})
	if err != nil {
		return "", fmt.Errorf("golem runtime initialization: %w", err)
	}
	defer func() {
		if closeErr := runtime.Close(); err == nil && closeErr != nil {
			message = ""
			err = fmt.Errorf("golem runtime close: %w", closeErr)
		}
	}()

	result, err := runtime.Run(ctx, golem.Turn{
		RunID:   "firn-commit-message",
		Message: generateInstruction,
		Context: []golem.ContextItem{{
			Description: "staged diff",
			Value:       diff,
		}},
	}, func(golem.Event) error { return nil })
	if err != nil {
		return "", fmt.Errorf("golem runtime run: %w", err)
	}

	message = strings.TrimSpace(result.Answer)
	if message == "" || strings.ContainsRune(message, '\x00') {
		return "", errors.New("golem returned an unusable message")
	}
	return message, nil
}

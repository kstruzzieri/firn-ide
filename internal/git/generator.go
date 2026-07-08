package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// maxPromptBytes bounds the prompt handed to golem. Local models have small
// context windows; a giant diff would be truncated by the model anyway, so
// truncate deliberately and say so in the prompt.
const maxPromptBytes = 48 * 1024

const generateInstruction = `Write a git commit message for the staged diff below.
Rules: imperative mood, subject line of at most 72 characters, optional short
body separated by a blank line explaining why. Output ONLY the commit message,
no fences, no commentary.`

// MessageGenerator produces commit messages from a staged diff via the golem
// one-shot CLI (`golem -p`). The exec seams are exported fields so tests (and
// a future go-llm library-backed implementation) can replace them; that
// library swap is the planned end state, this shell-out is phase one.
type MessageGenerator struct {
	LookPath func(name string) (string, error)
	Run      func(ctx context.Context, bin string, args []string) (string, error)
}

// NewMessageGenerator wires the real exec implementations.
func NewMessageGenerator() *MessageGenerator {
	return &MessageGenerator{
		LookPath: exec.LookPath,
		Run: func(ctx context.Context, bin string, args []string) (string, error) {
			cmd := exec.CommandContext(ctx, bin, args...)
			var stdout, stderr bytes.Buffer
			cmd.Stdout = &stdout
			cmd.Stderr = &stderr
			if err := cmd.Run(); err != nil {
				msg := strings.TrimSpace(stderr.String())
				if msg == "" {
					msg = err.Error()
				}
				return "", errors.New(msg)
			}
			return stdout.String(), nil
		},
	}
}

// Available reports whether golem is on PATH and new enough to support the
// -p one-shot flag. Older golems are REPL-only; feeding them a prompt would
// hang, so the feature stays hidden until the user upgrades.
func (g *MessageGenerator) Available(ctx context.Context) bool {
	bin, err := g.LookPath("golem")
	if err != nil {
		return false
	}
	help, err := g.Run(ctx, bin, []string{"-h"})
	if err != nil {
		// flag packages exit non-zero on -h; the usage text still arrives.
		help = err.Error()
	}
	return strings.Contains(help, "-p ")
}

// Generate asks golem for a commit message describing diff. root scopes
// golem's workspace tools to the repository.
func (g *MessageGenerator) Generate(ctx context.Context, root, diff string) (string, error) {
	if strings.TrimSpace(diff) == "" {
		return "", errors.New("nothing staged: stage changes before generating a message")
	}
	bin, err := g.LookPath("golem")
	if err != nil {
		return "", fmt.Errorf("golem not found on PATH: %w", err)
	}

	if len(diff) > maxPromptBytes {
		diff = diff[:maxPromptBytes] + "\n[diff truncated for prompt budget]"
	}
	prompt := generateInstruction + "\n\n" + diff

	out, err := g.Run(ctx, bin, []string{"-root", root, "-p", prompt})
	if err != nil {
		return "", fmt.Errorf("golem: %w", err)
	}
	msg := strings.TrimSpace(out)
	if msg == "" {
		return "", errors.New("golem returned an empty message")
	}
	return msg, nil
}

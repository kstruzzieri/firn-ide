package git

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeRunner struct {
	lookPathErr error
	helpOut     string
	genOut      string
	genErr      error
	gotArgs     []string
}

func (f *fakeRunner) lookPath(name string) (string, error) {
	if f.lookPathErr != nil {
		return "", f.lookPathErr
	}
	return "/usr/local/bin/" + name, nil
}

func (f *fakeRunner) run(_ context.Context, _ string, args []string) (string, error) {
	if len(args) == 1 && args[0] == "-h" {
		return f.helpOut, nil
	}
	f.gotArgs = args
	return f.genOut, f.genErr
}

func newTestGenerator(f *fakeRunner) *MessageGenerator {
	return &MessageGenerator{LookPath: f.lookPath, Run: f.run}
}

func TestMessageGenerator_Available_NoBinary(t *testing.T) {
	f := &fakeRunner{lookPathErr: errors.New("not found")}

	if newTestGenerator(f).Available(context.Background()) {
		t.Error("Available = true, want false when golem is not on PATH")
	}
}

func TestMessageGenerator_Available_BinaryWithoutOneShotFlag(t *testing.T) {
	f := &fakeRunner{helpOut: "Usage of golem:\n  -root string\n  -config string\n"}

	if newTestGenerator(f).Available(context.Background()) {
		t.Error("Available = true, want false when golem lacks -p one-shot flag")
	}
}

func TestMessageGenerator_Available_WithOneShotFlag(t *testing.T) {
	f := &fakeRunner{helpOut: "Usage of golem:\n  -p string\n    \trun one prompt non-interactively\n"}

	if !newTestGenerator(f).Available(context.Background()) {
		t.Error("Available = false, want true when golem supports -p")
	}
}

func TestMessageGenerator_Generate_PassesDiffAndRoot(t *testing.T) {
	f := &fakeRunner{
		helpOut: "  -p string\n",
		genOut:  "feat(auth): add token refresh\n",
	}
	gen := newTestGenerator(f)

	msg, err := gen.Generate(context.Background(), "/repo/root", "diff --git a/x b/x\n+added line\n")

	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if msg != "feat(auth): add token refresh" {
		t.Errorf("msg = %q, want trimmed model reply", msg)
	}
	joined := strings.Join(f.gotArgs, " ")
	if !strings.Contains(joined, "-root /repo/root") {
		t.Errorf("args %q missing -root", joined)
	}
	if !strings.Contains(joined, "+added line") {
		t.Errorf("args %q missing diff content in prompt", joined)
	}
	if !strings.Contains(strings.ToLower(joined), "commit message") {
		t.Errorf("args %q missing instruction wording", joined)
	}
}

func TestMessageGenerator_Generate_TruncatesHugeDiff(t *testing.T) {
	f := &fakeRunner{helpOut: "  -p string\n", genOut: "chore: big change"}
	gen := newTestGenerator(f)
	huge := strings.Repeat("+x\n", 40_000) // ~120KB, over the prompt budget

	_, err := gen.Generate(context.Background(), "/repo", huge)

	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	joined := strings.Join(f.gotArgs, " ")
	if len(joined) > maxPromptBytes+1024 {
		t.Errorf("prompt length %d exceeds budget %d", len(joined), maxPromptBytes)
	}
	if !strings.Contains(joined, "truncated") {
		t.Error("truncated prompt should say so, or the model invents context")
	}
}

func TestMessageGenerator_Generate_EmptyDiff(t *testing.T) {
	f := &fakeRunner{helpOut: "  -p string\n"}
	gen := newTestGenerator(f)

	_, err := gen.Generate(context.Background(), "/repo", "   \n")

	if err == nil {
		t.Error("Generate() with empty diff: error = nil, want error (nothing staged)")
	}
}

func TestMessageGenerator_Generate_RunError(t *testing.T) {
	f := &fakeRunner{helpOut: "  -p string\n", genErr: errors.New("model backend unreachable")}
	gen := newTestGenerator(f)

	_, err := gen.Generate(context.Background(), "/repo", "+change\n")

	if err == nil || !strings.Contains(err.Error(), "model backend unreachable") {
		t.Errorf("error = %v, want golem failure surfaced", err)
	}
}

func TestNewMessageGenerator_DefaultsWired(t *testing.T) {
	gen := NewMessageGenerator()
	if gen.LookPath == nil || gen.Run == nil {
		t.Error("NewMessageGenerator() must wire real exec defaults")
	}
}

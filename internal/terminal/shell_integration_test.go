package terminal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestShellKind(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"/bin/zsh", "zsh"},
		{"/usr/local/bin/bash", "bash"},
		{"/bin/sh", ""},
		{"/usr/bin/fish", ""},
		{"C:\\Program Files\\Git\\bin\\bash.EXE", "bash"},
		{"/opt/homebrew/bin/ZSH", "zsh"},
		{"", ""},
	}
	for _, c := range cases {
		if got := shellKind(c.path); got != c.want {
			t.Errorf("shellKind(%q) = %q, want %q", c.path, got, c.want)
		}
	}
}

func TestEnsureWrapperFiles(t *testing.T) {
	root := t.TempDir()

	dir, err := ensureWrapperFiles(root)
	if err != nil {
		t.Fatalf("ensureWrapperFiles() error: %v", err)
	}

	if info, err := os.Stat(dir); err != nil {
		t.Fatalf("missing wrapper dir: %v", err)
	} else if info.Mode().Perm() != 0o700 {
		t.Errorf("wrapper dir perm = %o, want 700", info.Mode().Perm())
	}

	for _, name := range []string{".zshenv", ".zshrc", "firn.bashrc"} {
		p := filepath.Join(dir, name)
		info, err := os.Stat(p)
		if err != nil {
			t.Fatalf("missing %s: %v", name, err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("%s perm = %o, want 600", name, info.Mode().Perm())
		}
	}

	// Content matches the embedded source.
	got, _ := os.ReadFile(filepath.Join(dir, ".zshrc"))
	if !strings.Contains(string(got), "__firn_precmd") {
		t.Error(".zshrc missing hook content")
	}

	// Idempotent: second call succeeds and dir is stable.
	dir2, err := ensureWrapperFiles(root)
	if err != nil || dir2 != dir {
		t.Fatalf("second call: dir=%q dir2=%q err=%v", dir, dir2, err)
	}

	// Content drift is repaired.
	if err := os.WriteFile(filepath.Join(dir, ".zshrc"), []byte("stale"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureWrapperFiles(root); err != nil {
		t.Fatal(err)
	}
	repaired, _ := os.ReadFile(filepath.Join(dir, ".zshrc"))
	if string(repaired) == "stale" {
		t.Error("ensureWrapperFiles did not repair drifted content")
	}

	// Permission drift is repaired even when content is already current.
	bashrc := filepath.Join(dir, "firn.bashrc")
	if err := os.Chmod(bashrc, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureWrapperFiles(root); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(bashrc)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("repaired firn.bashrc perm = %o, want 600", info.Mode().Perm())
	}
}

func hasArg(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}

func envValue(env []string, key string) (string, bool) {
	for i := len(env) - 1; i >= 0; i-- {
		e := env[i]
		if strings.HasPrefix(e, key+"=") {
			return strings.TrimPrefix(e, key+"="), true
		}
	}
	return "", false
}

func TestIntegratedCommandZsh(t *testing.T) {
	root := t.TempDir()
	cmd := integratedCommand("/bin/zsh", root)

	if cmd.Path != "/bin/zsh" {
		t.Errorf("Path = %q", cmd.Path)
	}
	zdot, ok := envValue(cmd.Env, "ZDOTDIR")
	if !ok || !strings.Contains(zdot, "shell-integration") {
		t.Errorf("ZDOTDIR = %q ok=%v", zdot, ok)
	}
	if _, ok := envValue(cmd.Env, "USER_ZDOTDIR"); !ok {
		t.Error("USER_ZDOTDIR not set")
	}
}

func TestIntegratedCommandBash(t *testing.T) {
	root := t.TempDir()
	cmd := integratedCommand("/usr/bin/bash", root)

	if !hasArg(cmd.Args, "--rcfile") || !hasArg(cmd.Args, "-i") {
		t.Errorf("bash args missing --rcfile/-i: %v", cmd.Args)
	}
}

func TestIntegratedCommandUnsupportedIsPlain(t *testing.T) {
	root := t.TempDir()
	for _, sh := range []string{"/bin/sh", "/usr/bin/fish"} {
		cmd := integratedCommand(sh, root)
		if len(cmd.Args) != 1 {
			t.Errorf("%s: expected plain command, got args %v", sh, cmd.Args)
		}
		if cmd.Env != nil {
			t.Errorf("%s: plain command should not set Env, got %v", sh, cmd.Env)
		}
	}
}

func TestIntegratedCommandFailsOpen(t *testing.T) {
	// A root that cannot be created (a file, not a dir) forces ensureWrapperFiles
	// to fail; integratedCommand must still return a usable plain zsh command.
	f := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(f, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := integratedCommand("/bin/zsh", f)
	if cmd == nil || cmd.Path == "" {
		t.Fatal("expected plain command on setup failure")
	}
	if cmd.Env != nil {
		t.Fatalf("fail-open should return plain command with nil Env, got %v", cmd.Env)
	}
}

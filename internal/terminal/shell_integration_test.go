package terminal

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
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

func TestEnsureWrapperFilesConcurrent(t *testing.T) {
	root := t.TempDir()

	// Concurrent terminal creation calls ensureWrapperFiles in parallel. With
	// atomic writes none should error and every file must end up complete.
	const n = 16
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() {
			_, err := ensureWrapperFiles(root)
			errs <- err
		}()
	}
	for i := 0; i < n; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent ensureWrapperFiles error: %v", err)
		}
	}

	dir := filepath.Join(root, "firn-ide", "shell-integration", integrationVersion)
	for name, src := range wrapperFiles {
		want, err := integrationFS.ReadFile(src)
		if err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s content not complete after concurrent writes", name)
		}
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

// unsetenv removes keys from the process env for the test's duration and
// restores them afterwards (t.Setenv records the original for cleanup).
func unsetenv(t *testing.T, keys ...string) {
	t.Helper()
	for _, k := range keys {
		t.Setenv(k, "")
		if err := os.Unsetenv(k); err != nil {
			t.Fatal(err)
		}
	}
}

// hermeticHome returns an empty HOME for a test shell whose .zshenv turns
// off the system-wide startup files zsh reads after zshenv (/etc/zshrc,
// /etc/zsh/zshrc, and the zprofile/zlogin pair for login shells). Those
// differ by host: Ubuntu's zshrc runs compinit, which on a CI runner finds an
// insecure fpath directory and stops at a y/n prompt instead of drawing the
// shell's prompt. The wrapper .zshenv sources this file before zsh reaches
// them. The global zshenv still runs first and cannot be skipped. bash never
// reads this file.
func hermeticHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	if err := os.WriteFile(filepath.Join(home, ".zshenv"), []byte("unsetopt GLOBAL_RCS\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return home
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
	unsetenv(t, "ZDOTDIR", "USER_ZDOTDIR") // tests may run inside a Firn terminal
	root := t.TempDir()
	for _, sh := range []string{"/bin/sh", "/usr/bin/fish"} {
		cmd := integratedCommand(sh, root)
		if len(cmd.Args) != 1 {
			t.Errorf("%s: expected plain command, got args %v", sh, cmd.Args)
		}
		if _, ok := envValue(cmd.Env, "ZDOTDIR"); ok {
			t.Errorf("%s: plain command should not set ZDOTDIR, got %v", sh, cmd.Env)
		}
	}
}

// TestIntegratedCommandSetsTerminalEnv: every shell Firn starts must describe
// xterm.js, the real emulator, whatever terminal (or none, under launchd) Firn
// itself was started from. Without TERM, zsh treats the PTY as dumb and draws
// Backspace as a space (#556). Covers every exit of integratedCommand,
// including the fail-open ones.
func TestIntegratedCommandSetsTerminalEnv(t *testing.T) {
	notADir := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(notADir, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	shells := []struct{ name, shell, root string }{
		{"zsh", "/bin/zsh", t.TempDir()},
		{"bash", "/usr/bin/bash", t.TempDir()},
		{"unsupported", "/bin/sh", t.TempDir()},
		{"no cache root", "/bin/zsh", ""},
		{"setup failure", "/bin/zsh", notADir},
	}
	parents := []struct{ name, term, colorterm string }{
		{"parent unset", "", ""},
		{"parent differs", "screen", "24bit"},
	}
	for _, p := range parents {
		for _, s := range shells {
			t.Run(s.name+"/"+p.name, func(t *testing.T) {
				t.Setenv("FIRN_TEST_SENTINEL", "kept")
				if p.term == "" {
					unsetenv(t, "TERM", "COLORTERM")
				} else {
					t.Setenv("TERM", p.term)
					t.Setenv("COLORTERM", p.colorterm)
				}

				cmd := integratedCommand(s.shell, s.root)

				if got, ok := envValue(cmd.Env, "TERM"); got != "xterm-256color" {
					t.Errorf("TERM = %q (set=%v), want xterm-256color", got, ok)
				}
				if got, ok := envValue(cmd.Env, "COLORTERM"); got != "truecolor" {
					t.Errorf("COLORTERM = %q (set=%v), want truecolor", got, ok)
				}
				// The rest of the parent environment (PATH, HOME, ...) must survive.
				if got, _ := envValue(cmd.Env, "FIRN_TEST_SENTINEL"); got != "kept" {
					t.Errorf("FIRN_TEST_SENTINEL = %q, want parent env inherited", got)
				}
			})
		}
	}
}

func TestIntegratedCommandFailsOpen(t *testing.T) {
	// A root that cannot be created (a file, not a dir) forces ensureWrapperFiles
	// to fail; integratedCommand must still return a usable plain zsh command.
	unsetenv(t, "ZDOTDIR", "USER_ZDOTDIR") // tests may run inside a Firn terminal
	f := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(f, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := integratedCommand("/bin/zsh", f)
	if cmd == nil || cmd.Path == "" {
		t.Fatal("expected plain command on setup failure")
	}
	if _, ok := envValue(cmd.Env, "ZDOTDIR"); ok {
		t.Fatalf("fail-open should return a plain command without ZDOTDIR, got %v", cmd.Env)
	}
}

func TestBashPromptCommandSeesOriginalStatus(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash not installed")
	}

	root := t.TempDir()
	dir, err := ensureWrapperFiles(root)
	if err != nil {
		t.Fatal(err)
	}

	home := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(home, ".bashrc"),
		[]byte(`PROMPT_COMMAND='printf "%s\n" "$?" > "$HOME/status"'`),
		0o600,
	); err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command(
		bash,
		"--noprofile",
		"--norc",
		"-c",
		`source "$1"; false; __firn_precmd >/dev/null || true`,
		"bash",
		filepath.Join(dir, "firn.bashrc"),
	)
	cmd.Env = append(os.Environ(), "HOME="+home)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("bash prompt command probe failed: %v\n%s", err, out)
	}
	gotBytes, err := os.ReadFile(filepath.Join(home, "status"))
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(gotBytes)); got != "1" {
		t.Fatalf("PROMPT_COMMAND saw status %q, want 1", got)
	}
}

// TestIntegratedShellEmitsOSC133 spawns the integrated shell in a real PTY and
// asserts the embedded scripts emit the OSC 133 "command finished" marker with a
// non-zero exit code. PTY-gated (skipped on headless CI) and shell-gated via
// LookPath. Reads until the marker appears or a timeout fires — no fixed sleeps.
func TestIntegratedShellEmitsOSC133(t *testing.T) {
	requirePTY(t)

	for _, shell := range []string{"bash", "zsh"} {
		t.Run(shell, func(t *testing.T) {
			path, err := exec.LookPath(shell)
			if err != nil {
				t.Skipf("%s not installed", shell)
			}

			cmd := integratedCommand(path, t.TempDir())

			// Make the spawned shell hermetic: point HOME / USER_ZDOTDIR at an
			// empty dir so it does not source the developer's real rc files
			// (p10k, nvm, input-blocking prompts) or the host's global zshrc,
			// either of which would make this flaky.
			hermetic := hermeticHome(t)
			base := cmd.Env
			if base == nil {
				base = os.Environ()
			}
			cmd.Env = append(base, "HOME="+hermetic, "USER_ZDOTDIR="+hermetic)

			ptmx, err := pty.Start(cmd)
			if err != nil {
				t.Fatalf("pty.Start(%s) error: %v", shell, err)
			}
			defer func() {
				_ = ptmx.Close()
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
			}()

			// `false` exits 1; precmd emits "\e]133;D;1\a" on the next prompt.
			if _, err := ptmx.Write([]byte("false\nexit\n")); err != nil {
				t.Fatalf("write: %v", err)
			}

			want := []byte("\033]133;D;1\007")
			result := make(chan bool, 1)
			go func() {
				var seen []byte
				buf := make([]byte, 4096)
				for {
					n, err := ptmx.Read(buf)
					if n > 0 {
						seen = append(seen, buf[:n]...)
						if bytes.Contains(seen, want) {
							result <- true
							return
						}
					}
					if err != nil {
						result <- false
						return
					}
				}
			}()

			select {
			case ok := <-result:
				if !ok {
					t.Fatalf("%s: shell exited before emitting OSC 133 D;1 marker", shell)
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("%s: timed out waiting for OSC 133 D;1 marker", shell)
			}
		})
	}
}

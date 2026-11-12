package terminal

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
)

// printHistfile is the zsh command the tests below end on.
const printHistfile = `print -r -- "HISTFILE=${HISTFILE-<unset>}"`

// zshEnv is the whole environment of a shell under test. Nothing from the
// developer's own session (ZDOTDIR, an exported HISTFILE, TERM_PROGRAM, which
// makes macOS load /etc/zshrc_Apple_Terminal) leaks in.
func zshEnv(home string, extra ...string) []string {
	return append([]string{"PATH=" + os.Getenv("PATH"), "HOME=" + home}, extra...)
}

// reportedHistfile runs cmd and returns the value printHistfile printed.
func reportedHistfile(t *testing.T, cmd *exec.Cmd) string {
	t.Helper()
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("%v: %v\n%s", cmd.Args, err, out)
	}
	for line := range strings.SplitSeq(string(out), "\n") {
		if v, ok := strings.CutPrefix(line, "HISTFILE="); ok {
			return v
		}
	}
	t.Fatalf("%v printed no HISTFILE line:\n%s", cmd.Args, out)
	return ""
}

func writeRC(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

// TestIntegratedZshUsesSameHistfileAsPlainZsh: Firn starts zsh with ZDOTDIR on
// its wrapper directory, and the system-wide zshrc runs before the wrapper
// .zshrc can point ZDOTDIR back at the user's. Stock macOS and the grml config
// set HISTFILE from ZDOTDIR there, which put the history of every Firn terminal
// in Firn's cache directory (#560). Whatever this host's system-wide zshrc
// does, a Firn shell must end up with the HISTFILE a plain zsh gets.
func TestIntegratedZshUsesSameHistfileAsPlainZsh(t *testing.T) {
	zsh, err := exec.LookPath("zsh")
	if err != nil {
		t.Skip("zsh not installed")
	}

	cases := []struct {
		name       string
		envZdotdir bool   // the user exports ZDOTDIR before starting Firn
		zshenv     string // the user's .zshenv
		zshrc      string // the user's .zshrc
	}{
		{name: "user sets nothing"},
		{name: "ZDOTDIR in the environment", envZdotdir: true},
		// Whether a .zshenv value survives is the system zshrc's call, not
		// Firn's: stock macOS replaces it in a plain zsh too, Ubuntu and
		// Alpine keep it. Either way Firn must agree with the plain shell.
		// TestZshWrapperMovesHistfileOutOfWrapperDir pins the "kept" half.
		{name: "HISTFILE in the user's .zshenv", zshenv: `HISTFILE="$HOME/from_zshenv"`},
		{name: "HISTFILE in the user's .zshrc", zshrc: `HISTFILE="$HOME/from_zshrc"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			home := t.TempDir()
			userDir, userEnv := home, []string(nil)
			t.Setenv("HOME", home)
			t.Setenv("ZDOTDIR", "") // integratedCommand reads both
			if c.envZdotdir {
				userDir = filepath.Join(home, "zdot")
				userEnv = []string{"ZDOTDIR=" + userDir}
				t.Setenv("ZDOTDIR", userDir)
			}
			// Always a .zshrc: zsh runs its new-user setup function for a
			// directory with no startup files, which only the plain shell
			// would see (the wrapper directory always has some).
			writeRC(t, userDir, ".zshrc", c.zshrc+"\n")
			if c.zshenv != "" {
				writeRC(t, userDir, ".zshenv", c.zshenv+"\n")
			}

			plain := exec.Command(zsh, "-ic", printHistfile)
			plain.Env = zshEnv(home, userEnv...)
			want := reportedHistfile(t, plain)

			firn := integratedCommand(zsh, t.TempDir())
			wrapper, _ := envValue(firn.Env, "ZDOTDIR")
			userZdotdir, _ := envValue(firn.Env, "USER_ZDOTDIR")
			if wrapper == "" || wrapper == userDir {
				t.Fatalf("integratedCommand did not point ZDOTDIR at a wrapper directory: %q", wrapper)
			}
			firn.Args = append(firn.Args, "-ic", printHistfile)
			firn.Env = zshEnv(home, "ZDOTDIR="+wrapper, "USER_ZDOTDIR="+userZdotdir)

			if got := reportedHistfile(t, firn); got != want {
				t.Errorf("HISTFILE in a Firn zsh = %q, want %q as in a plain zsh", got, want)
			}
		})
	}
}

// TestZshWrapperMovesHistfileOutOfWrapperDir drives the wrapper .zshrc on its
// own, with the test standing in for the system-wide zshrc. That exercises the
// repair on hosts whose own zshrc leaves HISTFILE alone (Ubuntu, Alpine), where
// the test above cannot fail.
func TestZshWrapperMovesHistfileOutOfWrapperDir(t *testing.T) {
	zsh, err := exec.LookPath("zsh")
	if err != nil {
		t.Skip("zsh not installed")
	}
	wrapper, err := ensureWrapperFiles(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name     string
		systemRC string // what the system-wide zshrc did, ZDOTDIR being the wrapper
		zshrc    string // the user's .zshrc
		want     string // {home} and {wrapper} stand for the two directories
	}{
		{
			name:     "derived from ZDOTDIR as on macOS",
			systemRC: `HISTFILE="$ZDOTDIR/.zsh_history"`,
			want:     "{home}/.zsh_history",
		},
		{
			name:     "a nested path under ZDOTDIR",
			systemRC: `HISTFILE="$ZDOTDIR/.cache/history"`,
			want:     "{home}/.cache/history",
		},
		{
			name:     "user's .zshrc overrides the system default",
			systemRC: `HISTFILE="$ZDOTDIR/.zsh_history"`,
			zshrc:    `HISTFILE="$HOME/from_zshrc"`,
			want:     "{home}/from_zshrc",
		},
		{
			name:     "user's .zshrc already sees the moved default",
			systemRC: `HISTFILE="$ZDOTDIR/.zsh_history"`,
			zshrc:    `[[ "$HISTFILE" == "$HOME/.zsh_history" ]] && HISTFILE="$HOME/saw_default"`,
			want:     "{home}/saw_default",
		},
		{
			name:     "set by the user's .zshenv and left alone by the system zshrc",
			systemRC: `HISTFILE="$HOME/elsewhere/.zsh_history"`,
			want:     "{home}/elsewhere/.zsh_history",
		},
		{
			name:     "sibling directory sharing the wrapper's prefix",
			systemRC: `HISTFILE="$ZDOTDIR-old/.zsh_history"`,
			want:     "{wrapper}-old/.zsh_history",
		},
		{
			name:     "left unset as on Ubuntu and Alpine",
			systemRC: `unset HISTFILE`,
			want:     "<unset>",
		},
		{
			// NO_UNSET makes a bare $HISTFILE an error that would end the
			// wrapper before it reaches the user's .zshrc. That .zshrc turns
			// the option off again because the hook block further down still
			// trips over it, which is older than this test.
			name:     "unset, with NO_UNSET from the user's .zshenv",
			systemRC: `setopt NO_UNSET; unset HISTFILE`,
			zshrc:    `unsetopt NO_UNSET; HISTFILE="$HOME/from_zshrc"`,
			want:     "{home}/from_zshrc",
		},
		{
			name:     "wrapper sourced by hand, without ZDOTDIR",
			systemRC: `unset ZDOTDIR; HISTFILE="$HOME/.zsh_history"`,
			want:     "{home}/.zsh_history",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			home := t.TempDir()
			writeRC(t, home, ".zshrc", c.zshrc+"\n")
			want := strings.NewReplacer("{home}", home, "{wrapper}", wrapper).Replace(c.want)

			// -f: of the startup files only the system zshenv is read; the
			// script is the rest of the startup sequence.
			cmd := exec.Command(zsh, "-f", "-c",
				c.systemRC+`; source "$WRAPPER/.zshrc"; `+printHistfile)
			cmd.Env = zshEnv(home, "ZDOTDIR="+wrapper, "USER_ZDOTDIR="+home, "WRAPPER="+wrapper)

			if got := reportedHistfile(t, cmd); got != want {
				t.Errorf("HISTFILE = %q, want %q", got, want)
			}
		})
	}
}

// TestIntegratedZshLeavesAppleTerminalSessionsOff: a Firn started from a shell
// inside Apple's Terminal hands its own shells TERM_PROGRAM and TERM_SESSION_ID.
// /etc/zshrc then loads Terminal's per-tab session support, which copies
// HISTFILE and builds its .zsh_sessions paths while ZDOTDIR is still the
// wrapper directory, and switches HISTFILE to them at the first prompt, after
// the wrapper .zshrc has repaired it (#560). The shell has to reach a prompt
// for that to show, so this one needs a terminal. On other systems the two
// variables mean nothing and the test passes on the default alone.
func TestIntegratedZshLeavesAppleTerminalSessionsOff(t *testing.T) {
	requirePTY(t)
	zsh, err := exec.LookPath("zsh")
	if err != nil {
		t.Skip("zsh not installed")
	}
	home := t.TempDir()
	writeRC(t, home, ".zshrc", "\n")
	t.Setenv("HOME", home)
	t.Setenv("ZDOTDIR", "")

	// What a terminal that is not Apple's gives a plain zsh.
	plain := exec.Command(zsh, "-ic", printHistfile)
	plain.Env = zshEnv(home)
	want := reportedHistfile(t, plain)

	cmd := integratedCommand(zsh, t.TempDir())
	wrapper, _ := envValue(cmd.Env, "ZDOTDIR")
	if wrapper == "" || wrapper == home {
		t.Fatalf("integratedCommand did not point ZDOTDIR at a wrapper directory: %q", wrapper)
	}
	cmd.Env = zshEnv(home, "ZDOTDIR="+wrapper, "USER_ZDOTDIR="+home, "TERM=xterm-256color",
		"TERM_PROGRAM=Apple_Terminal", "TERM_SESSION_ID=firn-560-test")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		t.Fatalf("pty.Start: %v", err)
	}
	// One waiter, and a cleanup registered before anything can fail, so every
	// way out of the test ends the shell and reaps it.
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	t.Cleanup(func() {
		_ = cmd.Process.Kill() // already gone on the normal path
		<-exited
		_ = ptmx.Close()
	})
	go func() { _, _ = io.Copy(io.Discard, ptmx) }() // or the shell blocks on a full terminal

	// Typed at the first prompt, so every first-prompt hook has run by then.
	if _, err := ptmx.Write([]byte(printHistfile + ` > "$HOME/seen"` + "\nexit\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	select {
	case <-exited:
	case <-time.After(10 * time.Second):
		t.Fatal("zsh did not exit")
	}

	seen, err := os.ReadFile(filepath.Join(home, "seen"))
	if err != nil {
		t.Fatalf("the shell never ran the typed command: %v", err)
	}
	if got := strings.TrimSpace(strings.TrimPrefix(string(seen), "HISTFILE=")); got != want {
		t.Errorf("HISTFILE after the first prompt = %q, want %q", got, want)
	}
	// Nothing of the session may be left behind in Firn's cache either.
	for _, name := range []string{".zsh_history", ".zsh_sessions"} {
		if _, err := os.Lstat(filepath.Join(wrapper, name)); err == nil {
			t.Errorf("%s was written to the wrapper directory", name)
		}
	}
}

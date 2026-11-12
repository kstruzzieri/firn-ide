package terminal

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
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
			name:     "set outside the wrapper directory",
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

			// -f: no startup files at all; the script is the startup sequence.
			cmd := exec.Command(zsh, "-f", "-c",
				c.systemRC+`; source "$WRAPPER/.zshrc"; `+printHistfile)
			cmd.Env = zshEnv(home, "ZDOTDIR="+wrapper, "USER_ZDOTDIR="+home, "WRAPPER="+wrapper)

			if got := reportedHistfile(t, cmd); got != want {
				t.Errorf("HISTFILE = %q, want %q", got, want)
			}
		})
	}
}

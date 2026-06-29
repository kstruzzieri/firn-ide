package terminal

import "testing"

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

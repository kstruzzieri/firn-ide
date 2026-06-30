package provision

import "testing"

func TestResolveStateConstants(t *testing.T) {
	// Guards against accidental value drift — manager maps on these strings.
	cases := map[ResolveState]string{
		StateMissing:        "missing",
		StateAvailable:      "managed-available",
		StateInstalling:     "installing",
		StateOffline:        "offline",
		StateChecksumFailed: "checksum-failed",
		StateUnsupported:    "unsupported",
	}
	for got, want := range cases {
		if string(got) != want {
			t.Errorf("state = %q, want %q", got, want)
		}
	}
}

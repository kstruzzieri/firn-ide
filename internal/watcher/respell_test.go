package watcher

import (
	"path/filepath"
	"testing"
)

func TestRespell(t *testing.T) {
	p := filepath.FromSlash
	tests := []struct {
		name, resolved, path, want string
	}{
		{"root itself", "/real/app", "/real/app", "/link/app"},
		{"nested path", "/real/app", "/real/app/src/a.go", "/link/app/src/a.go"},
		{"sibling sharing a prefix", "/real/app", "/real/app2/a.go", "/real/app2/a.go"},
		{"path outside the root", "/real/app", "/elsewhere/a.go", "/elsewhere/a.go"},
		{"filesystem root target", "/", "/a.go", "/link/app/a.go"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got FileEvent
			respell(p(tt.resolved), p("/link/app"), func(e FileEvent) { got = e })(
				FileEvent{Path: p(tt.path), OldPath: p(tt.path)})
			if got.Path != p(tt.want) || got.OldPath != p(tt.want) {
				t.Errorf("got Path %q, OldPath %q; want both %q", got.Path, got.OldPath, p(tt.want))
			}
		})
	}
}

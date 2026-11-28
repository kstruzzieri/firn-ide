//go:build !windows

package runprofile

import (
	"io"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

// slowByteReader returns one byte per read with a pause between reads, so the
// batcher flushes between the bytes of one character.
type slowByteReader struct{ r io.Reader }

func (s slowByteReader) Read(p []byte) (int, error) {
	time.Sleep(2 * time.Millisecond)
	return s.r.Read(p[:1])
}

// Run output reaches the frontend as JSON, which turns each half of a split
// UTF-8 character into U+FFFD (#562 C1): no flushed chunk may end or start
// mid-character, even when a flush falls between two reads.
func TestDrainPipe_NeverSplitsACharacterAcrossFlushes(t *testing.T) {
	spy := &batchSpy{}
	batcher := newOutputBatcher(spy.receive, time.Microsecond)
	input := "─│日本😀"

	var wg sync.WaitGroup
	wg.Add(1)
	e := NewExecutor(nil, nil)
	e.drainPipe(&wg, RunIdentity{RunInstanceID: "run-1"}, "stdout",
		io.NopCloser(slowByteReader{strings.NewReader(input)}), batcher)
	batcher.Close()

	var got strings.Builder
	for i, c := range spy.snapshot() {
		if !utf8.ValidString(c.data) {
			t.Fatalf("flush %d %q is not valid UTF-8", i, c.data)
		}
		got.WriteString(c.data)
	}
	if got.String() != input {
		t.Fatalf("output = %q, want %q", got.String(), input)
	}
}

package textstream

import (
	"strings"
	"testing"
	"testing/iotest"
	"unicode/utf8"
)

// collectReads runs ReadLoop over input, one byte per read, so every
// multi-byte character arrives split across reads.
func collectReads(t *testing.T, input string) []string {
	t.Helper()
	var chunks []string
	ReadLoop(iotest.OneByteReader(strings.NewReader(input)), func(data string) {
		chunks = append(chunks, data)
	})
	return chunks
}

// Wails sends terminal output as JSON, which turns each half of a split
// UTF-8 character into U+FFFD (#562 C1): every chunk must be whole.
func TestNeverSplitsACharacter(t *testing.T) {
	input := "│ Task │ 日本 café 😀 ─────"
	chunks := collectReads(t, input)

	for i, c := range chunks {
		if !utf8.ValidString(c) {
			t.Fatalf("chunk %d %q is not valid UTF-8", i, c)
		}
	}
	if got := strings.Join(chunks, ""); got != input {
		t.Fatalf("output = %q, want %q", got, input)
	}
}

// A byte that can never start a valid character is passed on at once, not
// held waiting for bytes that will not make it whole.
func TestPassesInvalidBytesThrough(t *testing.T) {
	input := "a\xffb\x80c"
	chunks := collectReads(t, input)

	if got := strings.Join(chunks, ""); got != input {
		t.Fatalf("output = %q, want %q", got, input)
	}
	if len(chunks) != len(input) {
		t.Fatalf("got %d chunks %q, want one per byte", len(chunks), chunks)
	}
}

// An incomplete character at the end of the stream is still delivered, so no
// output is lost when the shell exits mid-character.
func TestFlushesIncompleteTailAtEOF(t *testing.T) {
	input := "ab\xe2\x94"
	chunks := collectReads(t, input)

	if got := strings.Join(chunks, ""); got != input {
		t.Fatalf("output = %q, want %q", got, input)
	}
}

// A read may return bytes together with its error; those bytes, and any
// held partial character, are delivered before the loop ends.
func TestDeliversDataReturnedWithError(t *testing.T) {
	input := "x─y\xe2\x94"
	var got strings.Builder
	ReadLoop(iotest.DataErrReader(strings.NewReader(input)), func(data string) {
		got.WriteString(data)
	})

	if got.String() != input {
		t.Fatalf("output = %q, want %q", got.String(), input)
	}
}

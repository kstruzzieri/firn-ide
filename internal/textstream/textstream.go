// Package textstream turns a child process's output into strings for the
// frontend without splitting a UTF-8 character across two of them.
package textstream

import (
	"io"
	"unicode/utf8"
)

// ReadLoop reads r until it fails and passes each read to callback, never
// splitting a UTF-8 character across two calls. Wails sends output as JSON,
// which turns each half of a split character into U+FFFD, and the extra
// columns throw off full-screen programs' redraws (#562 C1).
//
// An incomplete trailing character (at most 3 bytes) is held until the next
// read completes it, and delivered as is when r ends. Output in a non-UTF-8
// encoding can have a byte held until the next read for the same reason.
func ReadLoop(r io.Reader, callback func(data string)) {
	// One buffer for the loop's lifetime: string(buf[:cut]) copies before reuse.
	buf := make([]byte, 4096)
	held := 0
	for {
		n, err := r.Read(buf[held:])
		end := held + n
		cut := end
		if err == nil {
			cut = completeUpTo(buf[:end])
		}
		if cut > 0 {
			callback(string(buf[:cut]))
		}
		if err != nil {
			return
		}
		held = copy(buf, buf[cut:end])
	}
}

// completeUpTo returns the length of p's longest prefix that does not end
// inside a UTF-8 character. Bytes that can never become valid count as
// complete, so they are passed on instead of held.
func completeUpTo(p []byte) int {
	for i := len(p) - 1; i >= 0 && i > len(p)-utf8.UTFMax; i-- {
		if utf8.RuneStart(p[i]) {
			if utf8.FullRune(p[i:]) {
				return len(p)
			}
			return i
		}
	}
	return len(p)
}

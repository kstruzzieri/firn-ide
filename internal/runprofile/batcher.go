package runprofile

import (
	"strings"
	"sync"
	"time"
)

// pendingWrite is a coalesced segment of output for one stream,
// preserving insertion order across interleaved stdout/stderr.
type pendingWrite struct {
	id        RunIdentity
	stream    string
	data      strings.Builder
	timestamp int64 // timestamp of the first write in this segment
}

// writeMsg is sent over writeCh to the timer goroutine.
type writeMsg struct {
	id        RunIdentity
	stream    string
	data      string
	timestamp int64
}

// outputBatcher accumulates output chunks and flushes them at a fixed interval.
// Writes are coalesced in insertion order: contiguous same-stream writes are
// merged, but interleaving between stdout and stderr is preserved. This reduces
// IPC events while maintaining correct chronological ordering for the frontend.
type outputBatcher struct {
	outputFn OutputFunc
	interval time.Duration

	writeCh chan writeMsg
	done    chan struct{}
	closed  chan struct{}

	closeOnce sync.Once
}

// newOutputBatcher creates an outputBatcher and starts its timer goroutine.
// interval is the flush period (typically 16 ms).
func newOutputBatcher(outputFn OutputFunc, interval time.Duration) *outputBatcher {
	b := &outputBatcher{
		outputFn: outputFn,
		interval: interval,
		writeCh:  make(chan writeMsg, 256),
		done:     make(chan struct{}),
		closed:   make(chan struct{}),
	}
	go b.run()
	return b
}

// Write enqueues a chunk for batching. Safe to call from multiple goroutines.
// Silently drops the write if the batcher has been closed.
func (b *outputBatcher) Write(id RunIdentity, stream, data string, timestamp int64) {
	select {
	case b.writeCh <- writeMsg{id, stream, data, timestamp}:
	case <-b.closed:
		// batcher is closed; discard
	}
}

// Close stops the goroutine and performs a synchronous final flush.
// Idempotent — safe to call multiple times.
func (b *outputBatcher) Close() {
	b.closeOnce.Do(func() {
		close(b.done)
		// Wait for the goroutine to finish (and perform final flush).
		<-b.closed
	})
}

// run is the timer goroutine. It owns the pending list and is the only
// place that reads from writeCh or flushes.
func (b *outputBatcher) run() {
	defer close(b.closed)

	ticker := time.NewTicker(b.interval)
	defer ticker.Stop()

	// Ordered list of coalesced segments. Contiguous same-stream writes
	// are merged; stream transitions create a new segment.
	var pending []*pendingWrite

	accumulate := func(msg writeMsg) {
		// Coalesce with the last segment if same run instance + stream
		if n := len(pending); n > 0 {
			last := pending[n-1]
			if last.id.RunInstanceID == msg.id.RunInstanceID && last.stream == msg.stream {
				last.data.WriteString(msg.data)
				return
			}
		}
		pw := &pendingWrite{
			id:        msg.id,
			stream:    msg.stream,
			timestamp: msg.timestamp,
		}
		pw.data.WriteString(msg.data)
		pending = append(pending, pw)
	}

	flush := func() {
		if b.outputFn != nil {
			for _, pw := range pending {
				b.outputFn(pw.id, pw.stream, pw.data.String(), pw.timestamp)
			}
		}
		pending = pending[:0]
	}

	for {
		select {
		case msg := <-b.writeCh:
			accumulate(msg)

		case <-ticker.C:
			flush()

		case <-b.done:
			// Drain any writes that arrived before done was closed.
			for {
				select {
				case msg := <-b.writeCh:
					accumulate(msg)
				default:
					flush()
					return
				}
			}
		}
	}
}

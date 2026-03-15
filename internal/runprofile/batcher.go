package runprofile

import (
	"sync"
	"time"
)

// batchEntry holds the accumulated data for one stream within a tick window.
type batchEntry struct {
	profileID string
	stream    string
	data      string
	timestamp int64 // timestamp of the first write in this batch
}

// writeMsg is sent over writeCh to the timer goroutine.
type writeMsg struct {
	profileID string
	stream    string
	data      string
	timestamp int64
}

// outputBatcher accumulates output chunks and flushes them at a fixed interval.
// This reduces the number of IPC events sent to the frontend while keeping
// latency bounded to ~16 ms (one animation frame).
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
func (b *outputBatcher) Write(profileID, stream, data string, timestamp int64) {
	select {
	case b.writeCh <- writeMsg{profileID, stream, data, timestamp}:
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

// run is the timer goroutine. It owns the accumulator map and is the only
// place that reads from writeCh or flushes.
func (b *outputBatcher) run() {
	defer close(b.closed)

	ticker := time.NewTicker(b.interval)
	defer ticker.Stop()

	// accumulator: key = profileID + "\x00" + stream
	accum := make(map[string]*batchEntry)

	flush := func() {
		if b.outputFn == nil {
			// Clear the accumulator even when no outputFn — avoids memory growth.
			for k := range accum {
				delete(accum, k)
			}
			return
		}
		for k, entry := range accum {
			b.outputFn(entry.profileID, entry.stream, entry.data, entry.timestamp)
			delete(accum, k)
		}
	}

	for {
		select {
		case msg := <-b.writeCh:
			key := msg.profileID + "\x00" + msg.stream
			if entry, ok := accum[key]; ok {
				entry.data += msg.data
			} else {
				accum[key] = &batchEntry{
					profileID: msg.profileID,
					stream:    msg.stream,
					data:      msg.data,
					timestamp: msg.timestamp,
				}
			}

		case <-ticker.C:
			flush()

		case <-b.done:
			// Drain any writes that arrived before done was closed.
			for {
				select {
				case msg := <-b.writeCh:
					key := msg.profileID + "\x00" + msg.stream
					if entry, ok := accum[key]; ok {
						entry.data += msg.data
					} else {
						accum[key] = &batchEntry{
							profileID: msg.profileID,
							stream:    msg.stream,
							data:      msg.data,
							timestamp: msg.timestamp,
						}
					}
				default:
					flush()
					return
				}
			}
		}
	}
}

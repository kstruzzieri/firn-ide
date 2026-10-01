package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/kstruzzieri/go-llm/conversation"
)

func mustSave(t *testing.T, s *MemorySessionStore, conv conversation.Conversation) {
	t.Helper()
	if err := s.Save(context.Background(), conv); err != nil {
		t.Fatalf("Save(%q): %v", conv.ID, err)
	}
}

func convOfSize(id string, contentBytes int) conversation.Conversation {
	return conversation.Conversation{
		ID:       id,
		Messages: []conversation.Message{{Role: "user", Content: strings.Repeat("x", contentBytes)}},
	}
}

func TestMemorySessionStoreLoadMissingIsNotFound(t *testing.T) {
	s := NewMemorySessionStore()
	if _, err := s.Load(context.Background(), "absent"); !errors.Is(err, conversation.ErrNotFound) {
		t.Fatalf("Load(absent) = %v, want conversation.ErrNotFound", err)
	}
}

func TestMemorySessionStoreRequiresConversationID(t *testing.T) {
	s := NewMemorySessionStore()
	if err := s.Save(context.Background(), conversation.Conversation{}); err == nil {
		t.Fatal("Save with empty ID succeeded, want error")
	}
}

// TestMemorySessionStoreRoundTripIsAliasFree proves the JSON boundary: neither
// the caller's snapshot nor a loaded copy can alias store state, across
// messages, tool-call raw bytes, and the durable summary.
func TestMemorySessionStoreRoundTripIsAliasFree(t *testing.T) {
	s := NewMemorySessionStore()
	toolCalls := json.RawMessage(`[{"id":"call-1"}]`)
	conv := conversation.Conversation{
		ID:    "t1",
		Title: "original title",
		Messages: []conversation.Message{
			{Role: "user", Content: "original user"},
			{Role: "assistant", Content: "original assistant", ToolCalls: toolCalls},
		},
		DurableSummary: &conversation.DurableSummary{Content: "original summary", MessageCount: 2},
	}
	mustSave(t, s, conv)

	// Mutate everything the caller still holds.
	conv.Messages[0].Content = "caller mutated"
	conv.DurableSummary.Content = "caller mutated"
	for i := range toolCalls {
		toolCalls[i] = '!'
	}

	assertOriginal := func(got *conversation.Conversation) {
		t.Helper()
		if got.Title != "original title" ||
			got.Messages[0].Content != "original user" ||
			got.Messages[1].Content != "original assistant" ||
			!bytes.Equal(got.Messages[1].ToolCalls, []byte(`[{"id":"call-1"}]`)) ||
			got.DurableSummary == nil || got.DurableSummary.Content != "original summary" ||
			got.DurableSummary.MessageCount != 2 {
			t.Fatalf("stored snapshot corrupted: %+v", got)
		}
	}

	loaded, err := s.Load(context.Background(), "t1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	assertOriginal(loaded)

	// Mutate the loaded copy deeply; the store must not see it.
	loaded.Messages[0].Content = "load mutated"
	loaded.DurableSummary.Content = "load mutated"
	for i := range loaded.Messages[1].ToolCalls {
		loaded.Messages[1].ToolCalls[i] = '?'
	}
	again, err := s.Load(context.Background(), "t1")
	if err != nil {
		t.Fatalf("Load again: %v", err)
	}
	assertOriginal(again)
}

func TestMemorySessionStoreReplacementByteAccounting(t *testing.T) {
	s := NewMemorySessionStore()
	mustSave(t, s, convOfSize("a", 1000))
	first := len(s.snaps["a"])
	if s.total != first {
		t.Fatalf("total = %d, want %d", s.total, first)
	}
	grown := convOfSize("a", 5000)
	grown.Revision = 1
	mustSave(t, s, grown)
	second := len(s.snaps["a"])
	if second <= first || s.total != second {
		t.Fatalf("replacement accounting: total = %d, snapshot = %d (was %d)", s.total, second, first)
	}
	shrunk := convOfSize("a", 10)
	shrunk.Revision = 2
	mustSave(t, s, shrunk)
	if s.total != len(s.snaps["a"]) {
		t.Fatalf("shrink accounting: total = %d, snapshot = %d", s.total, len(s.snaps["a"]))
	}
	mustSave(t, s, convOfSize("b", 1000))
	if s.total != len(s.snaps["a"])+len(s.snaps["b"]) {
		t.Fatalf("multi-ID accounting: total = %d", s.total)
	}
}

func TestMemorySessionStoreRefusesOversizedSnapshot(t *testing.T) {
	s := NewMemorySessionStore()
	mustSave(t, s, convOfSize("a", 100))
	prior := append([]byte(nil), s.snaps["a"]...)
	priorTotal := s.total

	if err := s.Save(context.Background(), convOfSize("a", SessionSnapshotLimit)); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("oversized Save = %v, want ErrSessionLimit", err)
	}
	if s.total != priorTotal || !bytes.Equal(s.snaps["a"], prior) {
		t.Fatal("rejected oversized replacement disturbed prior snapshot or accounting")
	}
	if err := s.Save(context.Background(), convOfSize("fresh", SessionSnapshotLimit)); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("oversized fresh Save = %v, want ErrSessionLimit", err)
	}
	if _, ok := s.snaps["fresh"]; ok {
		t.Fatal("rejected snapshot was stored")
	}
}

func TestMemorySessionStoreRefusesWhenTotalWouldExceed(t *testing.T) {
	s := NewMemorySessionStore()
	// Fill close to the store limit with snapshots each below the per-snapshot cap.
	pad := SessionSnapshotLimit - (4 << 10)
	for i := 0; s.total+SessionSnapshotLimit <= SessionStoreLimit; i++ {
		mustSave(t, s, convOfSize(fmt.Sprintf("pad-%d", i), pad))
	}
	mustSave(t, s, convOfSize("small", 16))
	priorSmall := append([]byte(nil), s.snaps["small"]...)
	priorTotal := s.total

	overflow := SessionStoreLimit - s.total + (4 << 10) // content guaranteeing next > limit

	// Total refusal for a new ID: nothing stored, nothing evicted.
	if err := s.Save(context.Background(), convOfSize("new", overflow)); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("overflowing Save(new) = %v, want ErrSessionLimit", err)
	}
	if _, ok := s.snaps["new"]; ok || s.total != priorTotal {
		t.Fatal("refused save mutated the store")
	}
	if _, ok := s.revs["new"]; ok {
		t.Fatal("refused save wrote a revision for a never-stored ID")
	}
	if _, err := s.Load(context.Background(), "pad-0"); err != nil {
		t.Fatalf("existing snapshot evicted: %v", err)
	}

	// Total refusal for a replacement: prior bytes and total stay intact. The
	// replacement carries the correct current revision so the refusal below is
	// attributable to the store cap, not a CAS conflict.
	overflowSmall := convOfSize("small", overflow)
	overflowSmall.Revision = 1
	if err := s.Save(context.Background(), overflowSmall); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("overflowing Save(small) = %v, want ErrSessionLimit", err)
	}
	if s.total != priorTotal || !bytes.Equal(s.snaps["small"], priorSmall) {
		t.Fatal("refused replacement disturbed prior snapshot or accounting")
	}
	if got := s.revs["small"]; got != 1 {
		t.Fatalf("refused replacement corrupted the revision ledger: revs[small] = %d, want 1", got)
	}
	loaded, err := s.Load(context.Background(), "small")
	if err != nil || loaded.Messages[0].Content != strings.Repeat("x", 16) {
		t.Fatalf("prior snapshot unusable after refusal: %+v, %v", loaded, err)
	}
	// Prove the conversation is not locked out: a normal-sized save at the
	// revision Load just returned must still succeed. If a refused
	// total-cap Save had advanced the ledger past what was actually
	// committed, every future Save at the true current revision would wrongly
	// conflict forever.
	if err := s.Save(context.Background(), conversation.Conversation{
		ID: "small", Revision: loaded.Revision,
		Messages: []conversation.Message{{Role: "user", Content: "still writable"}},
	}); err != nil {
		t.Fatalf("Save after refused replacement = %v, want success (ledger must match what was actually stored)", err)
	}
}

// TestMemorySessionStoreExactLimitBoundaries pins the strict `>` semantics of
// both bounds: exactly at a limit is accepted, one byte over refuses.
func TestMemorySessionStoreExactLimitBoundaries(t *testing.T) {
	overhead := func(id string) int {
		raw, err := json.Marshal(convOfSize(id, 0))
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		return len(raw)
	}

	// Exactly SessionSnapshotLimit bytes is accepted; one byte over refuses.
	s := NewMemorySessionStore()
	exact := SessionSnapshotLimit - overhead("solo")
	mustSave(t, s, convOfSize("solo", exact))
	if got := len(s.snaps["solo"]); got != SessionSnapshotLimit {
		t.Fatalf("snapshot bytes = %d, want exactly %d", got, SessionSnapshotLimit)
	}
	if err := s.Save(context.Background(), convOfSize("solo", exact+1)); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("Save(snapshot limit+1) = %v, want ErrSessionLimit", err)
	}
	if len(s.snaps["solo"]) != SessionSnapshotLimit {
		t.Fatal("refused +1 replacement disturbed the exact-limit snapshot")
	}

	// A total of exactly SessionStoreLimit is accepted: sixteen snapshots of
	// exactly 1 MiB each, all below the per-snapshot cap.
	s = NewMemorySessionStore()
	for i := 0; i < 16; i++ {
		id := fmt.Sprintf("m-%02d", i)
		mustSave(t, s, convOfSize(id, (1<<20)-overhead(id)))
	}
	if s.total != SessionStoreLimit {
		t.Fatalf("total = %d, want exactly %d", s.total, SessionStoreLimit)
	}
	// One byte over the total refuses: a replacement one byte larger stays
	// under the per-snapshot cap but would make the total limit+1. It carries
	// the correct current revision so the refusal is attributable to the
	// store cap, not a CAS conflict.
	overflowM00 := convOfSize("m-00", (1<<20)-overhead("m-00")+1)
	overflowM00.Revision = 1
	if err := s.Save(context.Background(), overflowM00); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("Save(total limit+1) = %v, want ErrSessionLimit", err)
	}
	if s.total != SessionStoreLimit || len(s.snaps["m-00"]) != 1<<20 {
		t.Fatal("refused +1 replacement disturbed accounting or the prior snapshot")
	}
	if got := s.revs["m-00"]; got != 1 {
		t.Fatalf("refused +1 replacement corrupted the revision ledger: revs[m-00] = %d, want 1", got)
	}
	// Prove the conversation is not locked out: a same-size replacement at the
	// revision Load just returned must still succeed.
	loaded, err := s.Load(context.Background(), "m-00")
	if err != nil {
		t.Fatalf("Load(m-00): %v", err)
	}
	if loaded.Revision != 1 {
		t.Fatalf("m-00 revision after refusal = %d, want 1", loaded.Revision)
	}
	if err := s.Save(context.Background(), *loaded); err != nil {
		t.Fatalf("Save after refused +1 replacement = %v, want success (ledger must match what was actually stored)", err)
	}
}

func TestMemorySessionStoreHonorsCancellation(t *testing.T) {
	s := NewMemorySessionStore()
	mustSave(t, s, convOfSize("a", 10))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.Save(ctx, convOfSize("b", 10)); !errors.Is(err, context.Canceled) {
		t.Fatalf("Save(canceled) = %v, want context.Canceled", err)
	}
	if _, ok := s.snaps["b"]; ok {
		t.Fatal("canceled Save stored a snapshot")
	}
	if _, err := s.Load(ctx, "a"); !errors.Is(err, context.Canceled) {
		t.Fatalf("Load(canceled) = %v, want context.Canceled", err)
	}
}

// TestMemorySessionStoreConcurrentLoadSave races several goroutines per ID
// through a real load-then-save cycle: each attempt loads the current
// revision (or starts at 0 if absent) and submits it, tolerating the
// ConflictError a losing racer gets under CAS. The final stored revision for
// each ID must equal exactly the number of saves that actually won.
func TestMemorySessionStoreConcurrentLoadSave(t *testing.T) {
	s := NewMemorySessionStore()
	const ids = 4
	var wins [ids]int64
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			idx := g % ids
			id := fmt.Sprintf("c%d", idx)
			for i := 0; i < 100; i++ {
				var revision int64
				if loaded, err := s.Load(context.Background(), id); err == nil {
					revision = loaded.Revision
				} else if !errors.Is(err, conversation.ErrNotFound) {
					t.Errorf("Load(%s): %v", id, err)
					return
				}
				conv := convOfSize(id, 64)
				conv.Revision = revision
				err := s.Save(context.Background(), conv)
				if err == nil {
					atomic.AddInt64(&wins[idx], 1)
					continue
				}
				if !errors.Is(err, conversation.ErrConflict) {
					t.Errorf("Save(%s): %v", id, err)
					return
				}
			}
		}(g)
	}
	wg.Wait()

	var total int
	for i := 0; i < ids; i++ {
		id := fmt.Sprintf("c%d", i)
		want := atomic.LoadInt64(&wins[i])
		loaded, err := s.Load(context.Background(), id)
		if want == 0 {
			if !errors.Is(err, conversation.ErrNotFound) {
				t.Fatalf("id %s: no save won, Load = %v, want ErrNotFound", id, err)
			}
			continue
		}
		if err != nil {
			t.Fatalf("Load(%s): %v", id, err)
		}
		if loaded.Revision != want {
			t.Fatalf("id %s: stored revision = %d, want %d successful saves", id, loaded.Revision, want)
		}
		total += len(s.snaps[id])
	}
	if s.total != total {
		t.Fatalf("accounting drifted under concurrency: total = %d, want %d", s.total, total)
	}
}

// TestMemorySessionStoreCASCreateAndUpdateRevisions mirrors go-llm's
// store_cas_test.go:63: a revision-0 create commits revision 1, each
// subsequent submit-the-loaded-value update advances by exactly one, and the
// caller's value (and any loaded value it later resubmits) is never mutated
// by Save.
func TestMemorySessionStoreCASCreateAndUpdateRevisions(t *testing.T) {
	s := NewMemorySessionStore()
	ctx := context.Background()
	initial := conversation.Conversation{
		ID:       "cas",
		Title:    "original",
		Messages: []conversation.Message{{Role: "user", Content: "hello"}},
	}
	before, _ := json.Marshal(initial)
	mustSave(t, s, initial)
	after, _ := json.Marshal(initial)
	if string(after) != string(before) {
		t.Fatalf("Save mutated caller's value: %s, want %s", after, before)
	}
	loaded, err := s.Load(ctx, "cas")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.Revision != 1 {
		t.Fatalf("create revision = %d, want 1", loaded.Revision)
	}

	for _, wantRevision := range []int64{2, 3} {
		loaded, err = s.Load(ctx, "cas")
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		before, _ = json.Marshal(loaded)
		if err := s.Save(ctx, *loaded); err != nil {
			t.Fatalf("Save(revision %d): %v", loaded.Revision, err)
		}
		after, _ = json.Marshal(loaded)
		if string(after) != string(before) {
			t.Fatalf("Save mutated loaded value: %s, want %s", after, before)
		}
		got, err := s.Load(ctx, "cas")
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if got.Revision != wantRevision {
			t.Fatalf("revision after update = %d, want %d", got.Revision, wantRevision)
		}
	}
}

// TestMemorySessionStoreDelete pins the store's one reclamation path (#361):
// Delete drops the snapshot and its revision together and returns its bytes to
// the store budget, an absent ID changes no stored state but still advances its
// generation, and a deleted ID is recreated by a revision-0 save exactly as if
// it had never been stored.
func TestMemorySessionStoreDelete(t *testing.T) {
	s := NewMemorySessionStore()
	ctx := context.Background()
	mustSave(t, s, convOfSize("a", 1000))
	mustSave(t, s, convOfSize("b", 500))
	kept := len(s.snaps["b"])

	s.Delete("a")
	if _, err := s.Load(ctx, "a"); !errors.Is(err, conversation.ErrNotFound) {
		t.Fatalf("Load(deleted) = %v, want conversation.ErrNotFound", err)
	}
	if _, ok := s.revs["a"]; ok {
		t.Fatal("Delete left the deleted ID in the revision ledger")
	}
	if s.total != kept {
		t.Fatalf("total after Delete = %d, want %d (only b's bytes)", s.total, kept)
	}

	// Absent IDs, including the one just deleted, change no stored state. They
	// still advance the generation: a New chat after an opencode turn that
	// failed before saving must still start a new opencode session.
	s.Delete("a")
	s.Delete("never-stored")
	if s.total != kept || len(s.snaps) != 1 || len(s.revs) != 1 {
		t.Fatalf("absent Delete changed the store: total = %d, snaps = %d, revs = %d", s.total, len(s.snaps), len(s.revs))
	}
	if got := s.Generation("never-stored"); got != 1 {
		t.Fatalf("Generation(never-stored) after Delete = %d, want 1", got)
	}
	if got := s.Generation("a"); got != 2 {
		t.Fatalf("Generation(a) after two Deletes = %d, want 2", got)
	}

	mustSave(t, s, convOfSize("a", 10))
	loaded, err := s.Load(ctx, "a")
	if err != nil || loaded.Revision != 1 {
		t.Fatalf("recreated Load = %+v, %v; want revision 1", loaded, err)
	}
	if s.total != kept+len(s.snaps["a"]) {
		t.Fatalf("total after recreate = %d, want %d", s.total, kept+len(s.snaps["a"]))
	}
}

// TestMemorySessionStoreCASConflictsPreserveState mirrors go-llm's
// store_cas_test.go:125: a duplicate create, a stale positive revision, an
// update against an absent ID, and an update of a loaded snapshot that was
// deleted since all fail as a typed *conversation.ConflictError carrying the
// submitted revision, and none of them touch stored bytes, the byte total, or
// the revision ledger.
func TestMemorySessionStoreCASConflictsPreserveState(t *testing.T) {
	const id = "cas"
	for _, tc := range []struct {
		name     string
		revision int64
		setup    func(t *testing.T, s *MemorySessionStore)
	}{
		{"duplicate create", 0, func(t *testing.T, s *MemorySessionStore) {
			mustSave(t, s, conversation.Conversation{ID: id, Title: "winner"})
		}},
		{"stale update", 1, func(t *testing.T, s *MemorySessionStore) {
			mustSave(t, s, conversation.Conversation{ID: id, Title: "winner"})
			mustSave(t, s, conversation.Conversation{ID: id, Revision: 1, Title: "winner again"})
		}},
		{"absent update", 1, func(t *testing.T, s *MemorySessionStore) {}},
		{"deleted loaded snapshot", 1, func(t *testing.T, s *MemorySessionStore) {
			mustSave(t, s, conversation.Conversation{ID: id, Title: "cleared"})
			s.Delete(id)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := NewMemorySessionStore()
			tc.setup(t, s)
			priorSnap := append([]byte(nil), s.snaps[id]...)
			priorTotal := s.total
			priorRev, hadRev := s.revs[id]

			candidate := conversation.Conversation{
				ID:       id,
				Revision: tc.revision,
				Title:    "loser",
				Messages: []conversation.Message{{Role: "user", Content: "losertoken"}},
			}
			err := s.Save(context.Background(), candidate)
			var conflict *conversation.ConflictError
			if !errors.Is(err, conversation.ErrConflict) || !errors.As(err, &conflict) {
				t.Fatalf("Save error = %v, want wrapped typed conflict", err)
			}
			if conflict.ID != id || conflict.ExpectedRevision != tc.revision {
				t.Fatalf("ConflictError = %+v, want ID %q and ExpectedRevision %d", conflict, id, tc.revision)
			}
			if s.total != priorTotal || !bytes.Equal(s.snaps[id], priorSnap) {
				t.Fatal("conflicting Save changed storage or byte accounting")
			}
			if got, ok := s.revs[id]; ok != hadRev || got != priorRev {
				t.Fatalf("conflicting Save changed the revision ledger: revs[%s] = (%d, present=%v), want (%d, present=%v)",
					id, got, ok, priorRev, hadRev)
			}
		})
	}
}

// TestMemorySessionStoreCASRevisionLimits mirrors go-llm's
// store_cas_test.go:175: negative and math.MaxInt64 revisions are refused as
// plain validation errors (never a conflict) for both an existing and an
// absent ID, storage stays untouched, math.MaxInt64-1 still saves and becomes
// exactly math.MaxInt64, and the next save past that is refused.
func TestMemorySessionStoreCASRevisionLimits(t *testing.T) {
	s := NewMemorySessionStore()
	ctx := context.Background()
	mustSave(t, s, conversation.Conversation{ID: "cas", Title: "original"})

	for _, id := range []string{"cas", "absent"} {
		for _, revision := range []int64{-1, math.MaxInt64} {
			priorSnap := append([]byte(nil), s.snaps[id]...)
			priorTotal := s.total
			priorRev, hadRev := s.revs[id]
			err := s.Save(ctx, conversation.Conversation{ID: id, Revision: revision, Title: "invalid"})
			if err == nil || errors.Is(err, conversation.ErrConflict) {
				t.Fatalf("Save(%q, %d) = %v, want non-conflict validation error", id, revision, err)
			}
			if s.total != priorTotal || !bytes.Equal(s.snaps[id], priorSnap) {
				t.Fatalf("invalid Save(%q, %d) changed storage or byte accounting", id, revision)
			}
			if got, ok := s.revs[id]; ok != hadRev || got != priorRev {
				t.Fatalf("invalid Save(%q, %d) changed the revision ledger: revs[%s] = (%d, present=%v), want (%d, present=%v)",
					id, revision, id, got, ok, priorRev, hadRev)
			}
		}
	}

	// Force the stored revision to math.MaxInt64-1 directly (white-box),
	// mirroring the reference test's raw SQL UPDATE: both the revision ledger
	// and the JSON snapshot's embedded revision must agree, since Load reads
	// the revision back out of the snapshot.
	forced, err := json.Marshal(conversation.Conversation{ID: "cas", Title: "original", Revision: math.MaxInt64 - 1})
	if err != nil {
		t.Fatalf("marshal forced snapshot: %v", err)
	}
	s.mu.Lock()
	s.total = s.total - len(s.snaps["cas"]) + len(forced)
	s.snaps["cas"] = forced
	s.revs["cas"] = math.MaxInt64 - 1
	s.mu.Unlock()

	loaded, err := s.Load(ctx, "cas")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.Revision != math.MaxInt64-1 {
		t.Fatalf("forced revision = %d, want %d", loaded.Revision, int64(math.MaxInt64-1))
	}
	if err := s.Save(ctx, *loaded); err != nil {
		t.Fatalf("Save(max-minus-one) = %v", err)
	}
	loaded, err = s.Load(ctx, "cas")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.Revision != math.MaxInt64 {
		t.Fatalf("revision after saving max-minus-one = %d, want max int64", loaded.Revision)
	}

	priorSnap := append([]byte(nil), s.snaps["cas"]...)
	priorTotal := s.total
	priorRev := s.revs["cas"]
	if err := s.Save(ctx, *loaded); err == nil || errors.Is(err, conversation.ErrConflict) {
		t.Fatalf("Save(max) = %v, want non-conflict validation error", err)
	}
	if s.total != priorTotal || !bytes.Equal(s.snaps["cas"], priorSnap) {
		t.Fatal("Save(max) changed storage or byte accounting")
	}
	if got := s.revs["cas"]; got != priorRev {
		t.Fatalf("Save(max) changed the revision ledger: revs[cas] = %d, want %d", got, priorRev)
	}
}

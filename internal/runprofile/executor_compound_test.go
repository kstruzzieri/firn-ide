//go:build !windows

package runprofile

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// compoundSnapshots extracts all run:compound payloads emitted to the spy.
func compoundSnapshots(s *emitSpy) []compoundStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []compoundStatus
	for _, e := range s.events {
		if e.event == "run:compound" && len(e.data) > 0 {
			if cs, ok := e.data[0].(compoundStatus); ok {
				out = append(out, cs)
			}
		}
	}
	return out
}

// outputByProfileID returns concatenated output data recorded for a profileID.
func outputByProfileID(o *outputSpy, profileID string) string {
	o.mu.Lock()
	defer o.mu.Unlock()
	var combined string
	for _, e := range o.entries {
		if e.profileID == profileID {
			combined += e.data
		}
	}
	return combined
}

// hasCompoundState reports whether any snapshot reached the given aggregate state.
func hasCompoundState(snaps []compoundStatus, state RunState) bool {
	for _, s := range snaps {
		if s.State == state {
			return true
		}
	}
	return false
}

// hasStepState reports whether any snapshot contained a step in the given state.
func hasStepState(snaps []compoundStatus, state CompoundStepState) bool {
	for _, s := range snaps {
		for _, step := range s.Steps {
			if step.State == state {
				return true
			}
		}
	}
	return false
}

func TestExecutor_StartCompoundAllSuccess(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()
	orderFile := filepath.Join(dir, "order.txt")

	step1 := newTestProfile("first", "printf first >> "+orderFile)
	step2 := newTestProfile("second", "printf second >> "+orderFile)
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"first", "second"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{step1, step2}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	if _, ok := spy.waitForState(RunStateRunning, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate running state")
	}
	if _, ok := spy.waitForState(RunStateSuccess, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate success state")
	}

	snaps := compoundSnapshots(spy)
	if !hasStepState(snaps, CompoundStepPending) {
		t.Error("expected a snapshot with a pending step")
	}
	if !hasStepState(snaps, CompoundStepRunning) {
		t.Error("expected a snapshot with a running step")
	}
	if !hasCompoundState(snaps, RunStateSuccess) {
		t.Error("expected a final success snapshot")
	}

	if st := exec.GetStatus("ci"); st.State != RunStateSuccess {
		t.Errorf("GetStatus state = %q, want %q", st.State, RunStateSuccess)
	}

	content, err := os.ReadFile(orderFile)
	if err != nil {
		t.Fatalf("reading order file: %v", err)
	}
	if string(content) != "firstsecond" {
		t.Errorf("order.txt = %q, want %q", string(content), "firstsecond")
	}
}

func TestExecutor_StartCompoundSequentialOrder(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()
	orderFile := filepath.Join(dir, "order.txt")

	step1 := newTestProfile("a", "printf A >> "+orderFile)
	step2 := newTestProfile("b", "printf B >> "+orderFile)
	step3 := newTestProfile("c", "printf C >> "+orderFile)
	step4 := newTestProfile("d", "printf D >> "+orderFile)
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"a", "b", "c", "d"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{step1, step2, step3, step4}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	if _, ok := spy.waitForState(RunStateSuccess, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate success state")
	}

	content, err := os.ReadFile(orderFile)
	if err != nil {
		t.Fatalf("reading order file: %v", err)
	}
	if string(content) != "ABCD" {
		t.Errorf("order.txt = %q, want %q (steps did not run in strict sequence)", string(content), "ABCD")
	}
}

func TestExecutor_GetStatusCompoundRunning(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()
	orderFile := filepath.Join(dir, "order.txt")

	step1 := newTestProfile("slow", "sleep 0.3; printf done >> "+orderFile)
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"slow"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{step1}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	if _, ok := spy.waitForState(RunStateRunning, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate running state")
	}

	if st := exec.GetStatus("ci"); st.State != RunStateRunning {
		t.Errorf("GetStatus while running = %q, want %q", st.State, RunStateRunning)
	}

	if _, ok := spy.waitForState(RunStateSuccess, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate success state")
	}

	if st := exec.GetStatus("ci"); st.State != RunStateSuccess {
		t.Errorf("GetStatus after completion = %q, want %q", st.State, RunStateSuccess)
	}
}

func TestExecutor_CompoundDuplicateStepOutputIsolation(t *testing.T) {
	spy := &emitSpy{}
	out := &outputSpy{}
	exec := NewExecutor(spy.emit, out.receive)
	dir := t.TempDir()

	echoer := newTestProfile("echoer", "printf hi")
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"echoer", "echoer"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{echoer, echoer}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	if _, ok := spy.waitForState(RunStateSuccess, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate success state")
	}

	key0 := compoundStepKey("ci", 0)
	key1 := compoundStepKey("ci", 1)

	if got := outputByProfileID(out, key0); got != "hi" {
		t.Errorf("output for key %q = %q, want %q", key0, got, "hi")
	}
	if got := outputByProfileID(out, key1); got != "hi" {
		t.Errorf("output for key %q = %q, want %q", key1, got, "hi")
	}
	if got := outputByProfileID(out, "echoer"); got != "" {
		t.Errorf("output should not be tagged with source profile ID %q, got %q", "echoer", got)
	}
}

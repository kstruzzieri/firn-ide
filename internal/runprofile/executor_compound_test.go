//go:build !windows

package runprofile

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// finalStepStates returns the step states from the most recent snapshot.
func finalStepStates(snaps []compoundStatus) []CompoundStepState {
	if len(snaps) == 0 {
		return nil
	}
	last := snaps[len(snaps)-1]
	out := make([]CompoundStepState, len(last.Steps))
	for i, step := range last.Steps {
		out[i] = step.State
	}
	return out
}

// finalStep returns the step at idx from the most recent snapshot.
func finalStep(snaps []compoundStatus, idx int) (compoundStepStatus, bool) {
	if len(snaps) == 0 {
		return compoundStepStatus{}, false
	}
	last := snaps[len(snaps)-1]
	if idx < 0 || idx >= len(last.Steps) {
		return compoundStepStatus{}, false
	}
	return last.Steps[idx], true
}

// waitForCompoundState polls GetStatus until the compound reaches the wanted
// aggregate state or the deadline elapses.
func waitForCompoundState(exec *Executor, id string, want RunState, timeout time.Duration) bool {
	deadline := time.After(timeout)
	for {
		if exec.GetStatus(id).State == want {
			return true
		}
		select {
		case <-deadline:
			return false
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// waitForLeafProcess polls the executor's internal process map until the
// compound step leaf for the given key is registered. This makes stop tests
// deterministic: we only stop once the leaf process is guaranteed to exist.
func waitForLeafProcess(exec *Executor, key string, timeout time.Duration) bool {
	deadline := time.After(timeout)
	for {
		exec.mu.Lock()
		_, ok := exec.processes[key]
		exec.mu.Unlock()
		if ok {
			return true
		}
		select {
		case <-deadline:
			return false
		case <-time.After(5 * time.Millisecond):
		}
	}
}

func TestExecutor_StartCompoundStopOnFailure(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()
	orderFile := filepath.Join(dir, "order.txt")

	ok1 := newTestProfile("ok1", "printf a >> "+orderFile)
	boom := newTestProfile("boom", "exit 3")
	ok2 := newTestProfile("ok2", "printf c >> "+orderFile)
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"ok1", "boom", "ok2"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{ok1, boom, ok2}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	if _, ok := spy.waitForState(RunStateFailed, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate failed state")
	}

	snaps := compoundSnapshots(spy)
	if !hasCompoundState(snaps, RunStateFailed) {
		t.Error("expected a snapshot with aggregate failed state")
	}

	boomStep, ok := finalStep(snaps, 1)
	if !ok {
		t.Fatal("expected step index 1 in final snapshot")
	}
	if boomStep.State != CompoundStepFailed {
		t.Errorf("boom step state = %q, want %q", boomStep.State, CompoundStepFailed)
	}
	if boomStep.ExitCode != 3 {
		t.Errorf("boom step exit code = %d, want 3", boomStep.ExitCode)
	}

	ok2Step, ok := finalStep(snaps, 2)
	if !ok {
		t.Fatal("expected step index 2 in final snapshot")
	}
	if ok2Step.State != CompoundStepSkipped {
		t.Errorf("ok2 step state = %q, want %q", ok2Step.State, CompoundStepSkipped)
	}

	st := exec.GetStatus("ci")
	if st.State != RunStateFailed {
		t.Errorf("GetStatus state = %q, want %q", st.State, RunStateFailed)
	}
	if st.ExitCode != 3 {
		t.Errorf("GetStatus exit code = %d, want 3", st.ExitCode)
	}

	content, err := os.ReadFile(orderFile)
	if err != nil {
		t.Fatalf("reading order file: %v", err)
	}
	if string(content) != "a" {
		t.Errorf("order.txt = %q, want %q (ok2 should never run)", string(content), "a")
	}
}

func TestExecutor_StartCompoundRunningStepPopulatesWorkingDir(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()
	subDir := filepath.Join(dir, "sub")
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatalf("mkdir sub: %v", err)
	}

	step := newTestProfile("worker", "printf done")
	step.WorkingDir = "sub"
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"worker"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{step}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}
	if _, ok := spy.waitForState(RunStateSuccess, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate success state")
	}

	// A running snapshot for step 0 must already carry the resolved working dir,
	// so clickable paths in live output resolve against the step's cwd rather
	// than the workspace root before the step terminates.
	foundRunningWithDir := false
	for _, snap := range compoundSnapshots(spy) {
		for _, s := range snap.Steps {
			if s.Idx == 0 && s.State == CompoundStepRunning && s.WorkingDir == subDir {
				foundRunningWithDir = true
			}
		}
	}
	if !foundRunningWithDir {
		t.Errorf("expected a running snapshot for step 0 with WorkingDir = %q", subDir)
	}
}

func TestExecutor_StartCompoundSetupFailureEmitsStepError(t *testing.T) {
	spy := &emitSpy{}
	out := &outputSpy{}
	exec := NewExecutor(spy.emit, out.receive)
	dir := t.TempDir()

	first := newTestProfile("first", "echo ok")
	// Non-first step has a non-existent working dir → startProcess fails the cwd check.
	bad := newTestProfile("bad", "echo nope")
	bad.WorkingDir = "does-not-exist"
	third := newTestProfile("third", "echo never")
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"first", "bad", "third"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{first, bad, third}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	if _, ok := spy.waitForState(RunStateFailed, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate failed state")
	}

	snaps := compoundSnapshots(spy)
	badStep, ok := finalStep(snaps, 1)
	if !ok {
		t.Fatal("expected step index 1 in final snapshot")
	}
	if badStep.State != CompoundStepFailed {
		t.Errorf("bad step state = %q, want %q", badStep.State, CompoundStepFailed)
	}
	if badStep.ExitCode != 1 {
		t.Errorf("bad step exit code = %d, want 1", badStep.ExitCode)
	}
	if badStep.ErrorMessage == "" {
		t.Error("bad step ErrorMessage should be non-empty")
	}

	thirdStep, ok := finalStep(snaps, 2)
	if !ok {
		t.Fatal("expected step index 2 in final snapshot")
	}
	if thirdStep.State != CompoundStepSkipped {
		t.Errorf("third step state = %q, want %q", thirdStep.State, CompoundStepSkipped)
	}

	stepKey := compoundStepKey("ci", 1)
	stderr := outputByProfileID(out, stepKey)
	if stderr == "" {
		t.Errorf("expected stderr output for step key %q describing the setup error", stepKey)
	}
	if !strings.Contains(stderr, "working directory does not exist") {
		t.Errorf("step stderr = %q, want it to contain the cwd error text", stderr)
	}

	if st := exec.GetStatus("ci"); st.State != RunStateFailed {
		t.Errorf("GetStatus state = %q, want %q", st.State, RunStateFailed)
	}
}

func TestExecutor_StopCompoundMidStep(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()
	orderFile := filepath.Join(dir, "order.txt")

	// Long-running first step. It only appends to order.txt AFTER the sleep, so a
	// successful mid-step stop guarantees order.txt never gets "a".
	slow := newTestProfile("slow", "sleep 5; printf a >> "+orderFile)
	after := newTestProfile("after", "printf b >> "+orderFile)
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"slow", "after"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{slow, after}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	stopErr := make(chan error, 1)
	go func() {
		// Determinism: wait until the aggregate is running AND the leaf process for
		// step 0 is registered in the executor's process map, then stop. This
		// closes the start/stop race window for the test.
		if !waitForCompoundState(exec, "ci", RunStateRunning, 5*time.Second) {
			stopErr <- fmt.Errorf("timed out waiting for running")
			return
		}
		if !waitForLeafProcess(exec, compoundStepKey("ci", 0), 5*time.Second) {
			stopErr <- fmt.Errorf("timed out waiting for leaf process")
			return
		}
		stopErr <- exec.Stop("ci")
	}()

	if err := <-stopErr; err != nil {
		t.Fatalf("Stop returned error: %v", err)
	}

	if !waitForCompoundState(exec, "ci", RunStateStopped, 5*time.Second) {
		t.Fatal("timed out waiting for aggregate stopped state")
	}

	snaps := compoundSnapshots(spy)
	slowStep, ok := finalStep(snaps, 0)
	if !ok {
		t.Fatal("expected step index 0 in final snapshot")
	}
	if slowStep.State != CompoundStepStopped {
		t.Errorf("slow step state = %q, want %q", slowStep.State, CompoundStepStopped)
	}
	afterStep, ok := finalStep(snaps, 1)
	if !ok {
		t.Fatal("expected step index 1 in final snapshot")
	}
	if afterStep.State != CompoundStepSkipped {
		t.Errorf("after step state = %q, want %q", afterStep.State, CompoundStepSkipped)
	}

	if st := exec.GetStatus("ci"); st.State != RunStateStopped {
		t.Errorf("GetStatus state = %q, want %q", st.State, RunStateStopped)
	}

	if content, err := os.ReadFile(orderFile); err == nil {
		if strings.Contains(string(content), "a") {
			t.Errorf("order.txt = %q, want it to NOT contain \"a\" (slow step was stopped before its append)", string(content))
		}
	}
}

func TestExecutor_StartSingleRejectedWhileCompoundStepRunning(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()
	defer exec.StopAll(2 * time.Second) //nolint:errcheck

	slow := newTestProfile("slow", "sleep 5")
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"slow"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{slow}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}
	if !waitForLeafProcess(exec, compoundStepKey("ci", 0), 5*time.Second) {
		t.Fatal("timed out waiting for compound leaf process")
	}

	err := exec.Start(dir, slow)
	if err == nil {
		t.Fatal("Start returned nil; want already-running error for leaf profile")
	}
	if !strings.Contains(err.Error(), "profile already running: slow") {
		t.Fatalf("Start error = %q, want already-running error for slow", err.Error())
	}
}

func TestExecutor_StopSingleIDStopsCompoundStep(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()

	slow := newTestProfile("slow", "sleep 5")
	after := newTestProfile("after", "printf never")
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"slow", "after"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{slow, after}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}
	if !waitForLeafProcess(exec, compoundStepKey("ci", 0), 5*time.Second) {
		t.Fatal("timed out waiting for compound leaf process")
	}

	if err := exec.Stop("slow"); err != nil {
		t.Fatalf("Stop by step profile ID returned error: %v", err)
	}
	if !waitForCompoundState(exec, "ci", RunStateStopped, 5*time.Second) {
		t.Fatal("timed out waiting for aggregate stopped state")
	}

	states := finalStepStates(compoundSnapshots(spy))
	if len(states) != 2 {
		t.Fatalf("expected 2 step states, got %d", len(states))
	}
	if states[0] != CompoundStepStopped {
		t.Errorf("step0 state = %q, want %q", states[0], CompoundStepStopped)
	}
	if states[1] != CompoundStepSkipped {
		t.Errorf("step1 state = %q, want %q", states[1], CompoundStepSkipped)
	}
}

// TestExecutor_StopCompoundBetweenSteps is hard to hit deterministically in the
// true between-steps gap, so per the plan it is implemented as: step0 sleeps
// briefly, we stop shortly after it starts running, and we assert step0 is
// stopped and step1 is skipped with a stopped aggregate. This still exercises
// the "no step beyond the stopped one runs" invariant that the between-steps
// cancellation guards.
func TestExecutor_StopCompoundBetweenSteps(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()
	orderFile := filepath.Join(dir, "order.txt")

	step0 := newTestProfile("s0", "sleep 0.4")
	step1 := newTestProfile("s1", "printf b >> "+orderFile)
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"s0", "s1"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{step0, step1}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	stopErr := make(chan error, 1)
	go func() {
		if !waitForCompoundState(exec, "ci", RunStateRunning, 5*time.Second) {
			stopErr <- fmt.Errorf("timed out waiting for running")
			return
		}
		if !waitForLeafProcess(exec, compoundStepKey("ci", 0), 5*time.Second) {
			stopErr <- fmt.Errorf("timed out waiting for leaf process")
			return
		}
		stopErr <- exec.Stop("ci")
	}()

	if err := <-stopErr; err != nil {
		t.Fatalf("Stop returned error: %v", err)
	}

	if !waitForCompoundState(exec, "ci", RunStateStopped, 5*time.Second) {
		t.Fatal("timed out waiting for aggregate stopped state")
	}

	states := finalStepStates(compoundSnapshots(spy))
	if len(states) != 2 {
		t.Fatalf("expected 2 step states, got %d", len(states))
	}
	if states[0] != CompoundStepStopped {
		t.Errorf("step0 state = %q, want %q", states[0], CompoundStepStopped)
	}
	if states[1] != CompoundStepSkipped {
		t.Errorf("step1 state = %q, want %q", states[1], CompoundStepSkipped)
	}

	if st := exec.GetStatus("ci"); st.State != RunStateStopped {
		t.Errorf("GetStatus state = %q, want %q", st.State, RunStateStopped)
	}
	if _, err := os.Stat(orderFile); err == nil {
		t.Error("order.txt should not exist; step1 must not have run")
	}
}

func TestExecutor_StopAllCancelsCompoundBetweenSteps(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()

	slow := newTestProfile("slow", "sleep 5")
	after := newTestProfile("after", "echo never")
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"slow", "after"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{slow, after}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	if !waitForCompoundState(exec, "ci", RunStateRunning, 5*time.Second) {
		t.Fatal("timed out waiting for running")
	}
	if !waitForLeafProcess(exec, compoundStepKey("ci", 0), 5*time.Second) {
		t.Fatal("timed out waiting for leaf process")
	}

	if !exec.StopAll(2 * time.Second) {
		t.Fatal("StopAll returned false — compound not cleaned up in time")
	}

	st := exec.GetStatus("ci")
	if st.State == RunStateRunning {
		t.Errorf("GetStatus state = %q, want a terminal state (not running)", st.State)
	}
	if st.State != RunStateStopped {
		t.Errorf("GetStatus state = %q, want %q", st.State, RunStateStopped)
	}
}

func TestExecutor_ClearTerminalStatusesClearsCompoundAggregate(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()

	step1 := newTestProfile("first", "echo a")
	step2 := newTestProfile("second", "echo b")
	compound := RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"first", "second"}}

	if err := exec.StartCompound(dir, compound, []RunProfile{step1, step2}); err != nil {
		t.Fatalf("StartCompound returned error: %v", err)
	}

	if _, ok := spy.waitForState(RunStateSuccess, 5*time.Second); !ok {
		t.Fatal("timed out waiting for aggregate success state")
	}
	if st := exec.GetStatus("ci"); st.State != RunStateSuccess {
		t.Fatalf("GetStatus state = %q, want %q", st.State, RunStateSuccess)
	}

	exec.ClearTerminalStatuses()

	if st := exec.GetStatus("ci"); st.State != RunStateIdle {
		t.Errorf("GetStatus state = %q, want %q after ClearTerminalStatuses", st.State, RunStateIdle)
	}
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

func TestExecutor_StartCompoundRejectsReservedCompoundProfileID(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	dir := t.TempDir()

	step := newTestProfile("build", "echo should-not-run")
	compound := RunProfile{
		ID:    "compound:Y2k:0",
		Name:  "CI",
		Type:  ProfileTypeCompound,
		Steps: []string{"build"},
	}

	err := exec.StartCompound(dir, compound, []RunProfile{step})
	if err == nil {
		t.Fatal("StartCompound returned nil; want reserved profile id error")
	}
	if !strings.Contains(err.Error(), `profile id uses reserved namespace "compound:"`) {
		t.Fatalf("StartCompound error = %q, want reserved namespace error", err.Error())
	}
	if statuses := spy.statuses(); len(statuses) != 0 {
		t.Fatalf("expected no status events for rejected compound, got %d", len(statuses))
	}
	if snaps := compoundSnapshots(spy); len(snaps) != 0 {
		t.Fatalf("expected no compound snapshots for rejected compound, got %d", len(snaps))
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

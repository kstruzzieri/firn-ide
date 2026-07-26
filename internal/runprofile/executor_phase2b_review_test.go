//go:build !windows

package runprofile

import (
	"errors"
	"os/exec"
	"testing"
	"time"
)

// A profile-level restart resolves the target run instance with GetStatus and
// then reserves a replacement for it. Those are two separate lock acquisitions,
// so a short-lived run can reach a terminal state in between. The reservation
// must report that with a sentinel the app binding can branch on, otherwise the
// binding cannot tell "nothing to replace" apart from a real failure and the
// user sees an error instead of a fresh run.
func TestExecutorPhase2B_RestartOfVanishedInstanceReportsNotRunningSentinel(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	profile := newTestProfile("target", "sleep 30")
	root := t.TempDir()
	t.Cleanup(func() { exec.StopAll(2 * time.Second) }) //nolint:errcheck

	if err := exec.Start(root, profile); err != nil {
		t.Fatalf("Start: %v", err)
	}
	running := phase2BRunningIDs(t, spy, profile.ID, 1)[0]

	if err := exec.StopRunInstance(running); err != nil {
		t.Fatalf("StopRunInstance: %v", err)
	}
	phase2BStatusFor(t, spy, running, RunStateStopped)

	err := exec.RestartAtEpoch(exec.CurrentEpoch(), root, profile, running)
	if !errors.Is(err, ErrRunInstanceNotRunning) {
		t.Fatalf("restart of terminal instance err = %v, want wrapped %v", err, ErrRunInstanceNotRunning)
	}

	// An unknown id must report the same sentinel, so the binding's fallback is
	// not keyed on the instance having once existed.
	err = exec.RestartAtEpoch(exec.CurrentEpoch(), root, profile, "never-existed")
	if !errors.Is(err, ErrRunInstanceNotRunning) {
		t.Fatalf("restart of unknown instance err = %v, want wrapped %v", err, ErrRunInstanceNotRunning)
	}
}

// Compound steps are ordered against ordinary runs by the same monotonic launch
// counter. Emitting a constant zero would make every step tie with every other
// step and lose to any ordinary run in refreshActiveProfileLocked.
func TestExecutorPhase2B_CompoundStepsCarryDistinctLaunchSequences(t *testing.T) {
	spy := &emitSpy{}
	exec := NewExecutor(spy.emit, nil)
	root := t.TempDir()
	t.Cleanup(func() { exec.StopAll(2 * time.Second) }) //nolint:errcheck

	compound := newTestProfile("suite", "")
	compound.Type = ProfileTypeCompound
	steps := []RunProfile{
		newTestProfile("first", "true"),
		newTestProfile("second", "true"),
	}

	if err := exec.StartCompound(root, compound, steps); err != nil {
		t.Fatalf("StartCompound: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	var final compoundStatus
	for time.Now().Before(deadline) {
		for _, snap := range compoundSnapshots(spy) {
			if snap.State == RunStateSuccess {
				final = snap
			}
		}
		if final.State == RunStateSuccess {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if final.State != RunStateSuccess {
		t.Fatal("compound never reported success")
	}

	if final.LaunchSeq == 0 {
		t.Fatal("compound aggregate LaunchSeq = 0, want a real launch sequence")
	}
	seen := map[uint64]bool{}
	for _, step := range final.Steps {
		if step.LaunchSeq == 0 {
			t.Fatalf("step %d (%s) LaunchSeq = 0, want a real launch sequence", step.Idx, step.ProfileID)
		}
		if step.LaunchSeq <= final.LaunchSeq {
			t.Fatalf(
				"step %d LaunchSeq = %d, want greater than aggregate %d",
				step.Idx, step.LaunchSeq, final.LaunchSeq,
			)
		}
		if seen[step.LaunchSeq] {
			t.Fatalf("step %d reused LaunchSeq %d", step.Idx, step.LaunchSeq)
		}
		seen[step.LaunchSeq] = true
	}
}

// A spawn invalidated mid-start must release its reservation so StopAll settles.
// The reap that runs on this path also carries a stopGracePeriod bound so a kill
// that fails to land cannot wedge the workspace switch; that bound is defensive
// and is not exercised here, since SIGKILL to the child's own process group
// always lands on unix. This asserts the reservation-release contract itself,
// which is what StopAll depends on.
func TestExecutorPhase2B_InvalidatedSpawnReleasesReservation(t *testing.T) {
	spy := &emitSpy{}
	executor := NewExecutor(spy.emit, nil)
	root := t.TempDir()
	profile := newTestProfile("target", "sleep 30")

	release := make(chan struct{})
	executor.setCommandStartHook(func(cmd *exec.Cmd) error {
		if err := cmd.Start(); err != nil {
			return err
		}
		<-release
		return nil
	})

	started := make(chan error, 1)
	go func() { started <- executor.StartAtEpoch(executor.CurrentEpoch(), root, profile) }()

	// Let the reservation register, then invalidate it mid-spawn.
	time.Sleep(50 * time.Millisecond)
	executor.BeginDrain()
	close(release)

	select {
	case err := <-started:
		if err == nil {
			t.Fatal("invalidated spawn returned success")
		}
	case <-time.After(stopGracePeriod + 3*time.Second):
		t.Fatal("invalidated spawn did not return; reap is unbounded")
	}

	if ok := executor.StopAll(2 * time.Second); !ok {
		t.Fatal("StopAll did not settle after an invalidated spawn")
	}
}

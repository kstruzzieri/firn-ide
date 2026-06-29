package runprofile

import (
	"context"
	"fmt"
	"time"
)

// CompoundStepState represents the lifecycle state of a single step within a
// compound run. It is distinct from RunState so the frontend can render per-step
// progress (including pending/skipped) independent of the aggregate state.
type CompoundStepState string

const (
	CompoundStepPending CompoundStepState = "pending"
	CompoundStepRunning CompoundStepState = "running"
	CompoundStepSuccess CompoundStepState = "success"
	CompoundStepFailed  CompoundStepState = "failed"
	CompoundStepSkipped CompoundStepState = "skipped"
	CompoundStepStopped CompoundStepState = "stopped"
)

// compoundStepStatus is the per-step payload carried inside a compoundStatus.
type compoundStepStatus struct {
	Idx                 int               `json:"idx"`
	RunInstanceID       string            `json:"runInstanceId"`
	ParentRunInstanceID string            `json:"parentRunInstanceId"`
	ProfileID           string            `json:"profileId"`
	Name                string            `json:"name"`
	State               CompoundStepState `json:"state"`
	ExitCode            int               `json:"exitCode"`
	WorkingDir          string            `json:"workingDir"`
	DurationMs          int64             `json:"durationMs"`
	StartedAt           int64             `json:"startedAt,omitempty"`
	EndedAt             int64             `json:"endedAt,omitempty"`
	ErrorMessage        string            `json:"errorMessage,omitempty"`
}

// compoundStatus is the run:compound event payload describing the full state of
// a compound run.
type compoundStatus struct {
	RunInstanceID string               `json:"runInstanceId"`
	CompoundID    string               `json:"compoundId"`
	Name          string               `json:"name"`
	State         RunState             `json:"state"`
	CurrentStep   int                  `json:"currentStep"`
	Steps         []compoundStepStatus `json:"steps"`
}

// compoundRun tracks an in-flight compound execution. All fields are guarded by
// Executor.mu.
type compoundRun struct {
	cancel  context.CancelFunc
	status  RunStatus
	steps   []compoundStepStatus
	current int
	name    string
	done    chan struct{}
}

// snapshot builds an immutable compoundStatus from the current compoundRun.
// The caller MUST hold Executor.mu. The steps slice is deep-copied so the
// emitted payload is never mutated by subsequent step transitions.
func (cr *compoundRun) snapshot() compoundStatus {
	steps := make([]compoundStepStatus, len(cr.steps))
	copy(steps, cr.steps)
	return compoundStatus{
		RunInstanceID: cr.status.RunInstanceID,
		CompoundID:    cr.status.ProfileID,
		Name:          cr.name,
		State:         cr.status.State,
		CurrentStep:   cr.current,
		Steps:         steps,
	}
}

// emitCompound emits a run:compound event with the given snapshot.
func (e *Executor) emitCompound(snap compoundStatus) {
	if e.emitFn != nil {
		e.emitFn("run:compound", snap)
	}
}

// StartCompound executes a compound profile's resolved steps sequentially.
// Steps are pre-resolved (compound ID → []RunProfile) at the binding level.
// The coordinator runs asynchronously, mirroring single-profile Start.
//
// This implements the all-success path. Failure and stop semantics are layered
// on in a later task; the loop is structured so non-success leaf results break
// out cleanly without panicking.
func (e *Executor) StartCompound(workspaceRoot string, compound RunProfile, steps []RunProfile) error {
	if workspaceRoot == "" {
		return fmt.Errorf("no workspace loaded")
	}

	ctx, cancel := context.WithCancel(context.Background())

	e.mu.Lock()
	if active, exists := e.activeByProfile[compound.ID]; exists {
		if _, running := e.compounds[active]; running {
			e.mu.Unlock()
			cancel()
			return fmt.Errorf("compound already running: %s", compound.ID)
		}
		if _, running := e.processes[active]; running {
			e.mu.Unlock()
			cancel()
			return fmt.Errorf("compound already running: %s", compound.ID)
		}
		delete(e.activeByProfile, compound.ID)
	}
	delete(e.lastStatus, compound.ID)

	aggregateID := e.nextRunInstanceIDLocked()
	stepStatuses := make([]compoundStepStatus, len(steps))
	for i, step := range steps {
		stepStatuses[i] = compoundStepStatus{
			Idx:                 i,
			RunInstanceID:       e.nextRunInstanceIDLocked(),
			ParentRunInstanceID: aggregateID,
			ProfileID:           step.ID,
			Name:                step.Name,
			State:               CompoundStepPending,
		}
	}

	cr := &compoundRun{
		cancel: cancel,
		status: RunStatus{
			RunIdentity: RunIdentity{RunInstanceID: aggregateID, ProfileID: compound.ID},
			State:       RunStateRunning,
		},
		steps:   stepStatuses,
		current: 0,
		name:    compound.Name,
		done:    make(chan struct{}),
	}
	e.compounds[aggregateID] = cr
	e.activeByProfile[compound.ID] = aggregateID

	running := cr.status
	initialSnap := cr.snapshot()
	e.mu.Unlock()

	e.emit(running)
	e.emitCompound(initialSnap)

	go e.runCompound(ctx, workspaceRoot, compound, steps, cr)
	return nil
}

// runCompound is the coordinator goroutine. It runs each step sequentially,
// emitting a run:compound snapshot on every transition. It computes a final
// aggregate (state, exitCode) and hands it to finishCompound, which marks any
// still-pending steps skipped.
//
// Aggregate exit code conventions:
//   - success → 0
//   - failed  → the failing step's exit code; 1 for setup/spawn errors
//   - stopped → the stopped leaf's exit code if available, otherwise sentinel
//     -1 (between-steps cancel with no leaf → -1)
func (e *Executor) runCompound(ctx context.Context, workspaceRoot string, compound RunProfile, steps []RunProfile, cr *compoundRun) {
	state := RunStateSuccess
	exitCode := 0

	for i := range steps {
		// Cancellation observed before this step starts. The step at index i is
		// still pending, so it and all later steps are marked skipped by
		// finishCompound. No leaf exists yet → sentinel exit code -1.
		if ctx.Err() != nil {
			state = RunStateStopped
			exitCode = -1
			break
		}

		// Transition: step → running, and capture this step's execution identity
		// from the preassigned status (both reads are guarded fields) in the same
		// locked section.
		e.mu.Lock()
		cr.current = i
		cr.steps[i].State = CompoundStepRunning
		cr.steps[i].StartedAt = time.Now().UnixMilli()
		stepIdentity := RunIdentity{
			RunInstanceID:       cr.steps[i].RunInstanceID,
			ProfileID:           steps[i].ID,
			ParentRunInstanceID: cr.status.RunInstanceID,
			StepIdx:             i,
		}
		runningSnap := cr.snapshot()
		e.mu.Unlock()
		e.emitCompound(runningSnap)

		rp, err := e.startProcess(stepIdentity, steps[i], workspaceRoot)
		if err != nil {
			// Setup/spawn failure: record the error on the step, surface it as a
			// stderr chunk for this step's output lane, and fail the aggregate.
			e.mu.Lock()
			cr.steps[i].State = CompoundStepFailed
			cr.steps[i].ExitCode = 1
			cr.steps[i].EndedAt = time.Now().UnixMilli()
			cr.steps[i].DurationMs = cr.steps[i].EndedAt - cr.steps[i].StartedAt
			cr.steps[i].ErrorMessage = err.Error()
			failSnap := cr.snapshot()
			e.mu.Unlock()

			if e.outputFn != nil {
				e.outputFn(stepIdentity, "stderr", err.Error()+"\n", time.Now().UnixMilli())
			}
			e.emitCompound(failSnap)

			state = RunStateFailed
			exitCode = 1
			break
		}

		// Publish the resolved working directory while the step is still running so
		// clickable file paths in live output resolve against the step's own cwd
		// (not the workspace root). startProcess has resolved it; emit an updated
		// running snapshot before waitProcess begins draining output.
		e.mu.Lock()
		cr.steps[i].WorkingDir = rp.workingDir
		runningDirSnap := cr.snapshot()
		e.mu.Unlock()
		e.emitCompound(runningDirSnap)

		// Close the start/stop race: a cancel that arrived in the window between
		// the running-transition unlock and the process registration inside
		// startProcess could be missed by an external Stop. signalStop marks the
		// leaf stopped, sends SIGTERM, and escalates to SIGKILL after the grace
		// period (via a watchdog) so a TERM-ignoring child cannot leave the
		// following waitProcess — and thus Stop/restart/StopAll — blocked.
		if ctx.Err() != nil {
			e.signalStop(rp)
		}

		res := e.waitProcess(rp, false, false)

		if res.state != RunStateSuccess {
			// Non-success leaf result (failed or stopped). Record the terminal
			// step state, emit, and break with the matching aggregate.
			e.mu.Lock()
			now := time.Now().UnixMilli()
			cr.steps[i].State = leafStepState(res.state)
			cr.steps[i].ExitCode = res.exitCode
			cr.steps[i].WorkingDir = res.workingDir
			cr.steps[i].EndedAt = now
			cr.steps[i].DurationMs = now - cr.steps[i].StartedAt
			brokeSnap := cr.snapshot()
			e.mu.Unlock()
			e.emitCompound(brokeSnap)

			if res.state == RunStateStopped {
				// res.exitCode is typically -1 for a signalled process, which
				// satisfies the stopped sentinel.
				state = RunStateStopped
				exitCode = res.exitCode
			} else {
				state = RunStateFailed
				exitCode = res.exitCode
			}
			break
		}

		// Transition: step → success.
		e.mu.Lock()
		now := time.Now().UnixMilli()
		cr.steps[i].State = CompoundStepSuccess
		cr.steps[i].ExitCode = res.exitCode
		cr.steps[i].WorkingDir = res.workingDir
		cr.steps[i].EndedAt = now
		cr.steps[i].DurationMs = now - cr.steps[i].StartedAt
		successSnap := cr.snapshot()
		e.mu.Unlock()
		e.emitCompound(successSnap)
	}

	e.finishCompound(cr, state, exitCode)
}

// finishCompound finalizes a compound run. Any still-pending steps are marked
// skipped, the aggregate status is set to the computed (state, exitCode), it is
// retained as the terminal status, the in-flight entry is removed, and the
// terminal aggregate + final compound snapshot are emitted.
func (e *Executor) finishCompound(cr *compoundRun, state RunState, exitCode int) {
	e.mu.Lock()
	for i := range cr.steps {
		if cr.steps[i].State == CompoundStepPending {
			cr.steps[i].State = CompoundStepSkipped
		}
	}
	cr.status.State = state
	cr.status.ExitCode = exitCode
	terminal := cr.status
	e.lastStatus[cr.status.ProfileID] = terminal
	finalSnap := cr.snapshot()
	delete(e.compounds, cr.status.RunInstanceID)
	if e.activeByProfile[cr.status.ProfileID] == cr.status.RunInstanceID {
		delete(e.activeByProfile, cr.status.ProfileID)
	}
	e.mu.Unlock()

	e.emit(terminal)
	e.emitCompound(finalSnap)
	close(cr.done)
}

// leafStepState maps a leaf process RunState onto a CompoundStepState.
func leafStepState(state RunState) CompoundStepState {
	switch state {
	case RunStateSuccess:
		return CompoundStepSuccess
	case RunStateStopped:
		return CompoundStepStopped
	default:
		return CompoundStepFailed
	}
}

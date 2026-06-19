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
	Idx          int               `json:"idx"`
	ProfileID    string            `json:"profileId"`
	Name         string            `json:"name"`
	State        CompoundStepState `json:"state"`
	ExitCode     int               `json:"exitCode"`
	WorkingDir   string            `json:"workingDir"`
	DurationMs   int64             `json:"durationMs"`
	StartedAt    int64             `json:"startedAt,omitempty"`
	EndedAt      int64             `json:"endedAt,omitempty"`
	ErrorMessage string            `json:"errorMessage,omitempty"`
}

// compoundStatus is the run:compound event payload describing the full state of
// a compound run.
type compoundStatus struct {
	CompoundID  string               `json:"compoundId"`
	Name        string               `json:"name"`
	State       RunState             `json:"state"`
	CurrentStep int                  `json:"currentStep"`
	Steps       []compoundStepStatus `json:"steps"`
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
		CompoundID:  cr.status.ProfileID,
		Name:        cr.name,
		State:       cr.status.State,
		CurrentStep: cr.current,
		Steps:       steps,
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
	if _, exists := e.compounds[compound.ID]; exists {
		e.mu.Unlock()
		cancel()
		return fmt.Errorf("compound already running: %s", compound.ID)
	}
	delete(e.lastStatus, compound.ID)

	stepStatuses := make([]compoundStepStatus, len(steps))
	for i, step := range steps {
		stepStatuses[i] = compoundStepStatus{
			Idx:       i,
			ProfileID: step.ID,
			Name:      step.Name,
			State:     CompoundStepPending,
		}
	}

	cr := &compoundRun{
		cancel: cancel,
		status: RunStatus{
			ProfileID: compound.ID,
			State:     RunStateRunning,
		},
		steps:   stepStatuses,
		current: 0,
		name:    compound.Name,
		done:    make(chan struct{}),
	}
	e.compounds[compound.ID] = cr

	running := cr.status
	initialSnap := cr.snapshot()
	e.mu.Unlock()

	e.emit(running)
	e.emitCompound(initialSnap)

	go e.runCompound(ctx, workspaceRoot, compound, steps, cr)
	return nil
}

// runCompound is the coordinator goroutine. It runs each step sequentially,
// emitting a run:compound snapshot on every transition.
func (e *Executor) runCompound(ctx context.Context, workspaceRoot string, compound RunProfile, steps []RunProfile, cr *compoundRun) {
	for i := range steps {
		// Transition: step → running.
		e.mu.Lock()
		cr.current = i
		cr.steps[i].State = CompoundStepRunning
		cr.steps[i].StartedAt = time.Now().UnixMilli()
		runningSnap := cr.snapshot()
		e.mu.Unlock()
		e.emitCompound(runningSnap)

		stepKey := compoundStepKey(compound.ID, i)
		rp, err := e.startProcess(stepKey, steps[i], workspaceRoot)
		if err != nil {
			// Setup-failure handling is a later task. Record the error on the
			// step and break out without marking the aggregate; the success-path
			// tests never reach this branch.
			e.mu.Lock()
			cr.steps[i].State = CompoundStepFailed
			cr.steps[i].EndedAt = time.Now().UnixMilli()
			cr.steps[i].ErrorMessage = err.Error()
			failSnap := cr.snapshot()
			e.mu.Unlock()
			e.emitCompound(failSnap)
			break
		}

		res := e.waitProcess(stepKey, rp, false, false)

		if res.state != RunStateSuccess {
			// Non-success leaf result. Full failure/stop semantics are a later
			// task; record the terminal step state and break out.
			e.mu.Lock()
			cr.steps[i].State = leafStepState(res.state)
			cr.steps[i].ExitCode = res.exitCode
			cr.steps[i].WorkingDir = res.workingDir
			cr.steps[i].EndedAt = time.Now().UnixMilli()
			cr.steps[i].DurationMs = cr.steps[i].EndedAt - cr.steps[i].StartedAt
			brokeSnap := cr.snapshot()
			e.mu.Unlock()
			e.emitCompound(brokeSnap)
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

	e.finishCompound(compound.ID, cr)
}

// finishCompound finalizes an all-success compound run: marks the aggregate
// status success, retains it as the terminal status, removes the in-flight
// entry, and emits the terminal aggregate + final compound snapshot.
func (e *Executor) finishCompound(compoundID string, cr *compoundRun) {
	e.mu.Lock()
	cr.status.State = RunStateSuccess
	cr.status.ExitCode = 0
	terminal := cr.status
	e.lastStatus[compoundID] = terminal
	finalSnap := cr.snapshot()
	delete(e.compounds, compoundID)
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

package runprofile

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// RunState represents the lifecycle state of a profile execution.
type RunState string

const (
	RunStateIdle    RunState = "idle"
	RunStateRunning RunState = "running"
	RunStateStopped RunState = "stopped" // user-initiated stop
	RunStateFailed  RunState = "failed"  // non-zero exit code
	RunStateSuccess RunState = "success" // exit code 0
)

const stopGracePeriod = 3 * time.Second

// RunStatus is emitted to the frontend on every state transition.
type RunStatus struct {
	ProfileID string   `json:"profileId"`
	State     RunState `json:"state"`
	ExitCode  int      `json:"exitCode"`
	Pid       int      `json:"pid,omitempty"`
}

// OutputFunc receives streaming process output.
// stream is "stdout" or "stderr". data is the raw chunk.
// The caller is responsible for buffering or backpressure.
type OutputFunc func(profileID, stream, data string)

// StatusFunc emits run status events (wraps runtime.EventsEmit in production).
type StatusFunc func(event string, data ...any)

// Executor manages the lifecycle of running profiles.
type Executor struct {
	mu         sync.Mutex
	processes  map[string]*runningProcess
	lastStatus map[string]RunStatus // terminal status retained after exit
	emitFn     StatusFunc
	outputFn   OutputFunc
}

// runningProcess tracks a single running profile execution.
type runningProcess struct {
	cmd      *exec.Cmd
	status   RunStatus
	stopped  bool         // set by Stop — tells Wait goroutine to use RunStateStopped
	done     chan struct{} // closed when process exits and cleanup is complete
	stopOnce sync.Once
}

// NewExecutor creates an Executor.
// emitFn emits Wails events (or a test spy).
// outputFn receives stdout/stderr chunks (nil = drain silently).
func NewExecutor(emitFn StatusFunc, outputFn OutputFunc) *Executor {
	return &Executor{
		processes:  make(map[string]*runningProcess),
		lastStatus: make(map[string]RunStatus),
		emitFn:     emitFn,
		outputFn:   outputFn,
	}
}

// Start begins executing a run profile. Profile resolution (ID → RunProfile)
// happens at the app.go binding level. The executor receives the resolved profile.
func (e *Executor) Start(workspaceRoot string, profile RunProfile) error {
	if workspaceRoot == "" {
		return fmt.Errorf("no workspace loaded")
	}

	if profile.Type == ProfileTypeCompound {
		return fmt.Errorf("compound profiles are not supported yet")
	}

	if strings.TrimSpace(profile.Command) == "" {
		return fmt.Errorf("profile has no command: %s", profile.ID)
	}

	// Resolve effective working directory
	effectiveDir, err := resolveWorkingDir(workspaceRoot, profile.WorkingDir)
	if err != nil {
		return err
	}

	// Hold the lock for the entire setup-through-insert sequence. This prevents
	// concurrent starts for the same profile ID (TOCTOU) and ensures Stop/StopAll
	// never see a partially-initialized entry. The locked work is fast: env merging
	// (small .env file read), pipe setup, and fork.
	e.mu.Lock()
	if _, exists := e.processes[profile.ID]; exists {
		e.mu.Unlock()
		return fmt.Errorf("profile already running: %s", profile.ID)
	}
	delete(e.lastStatus, profile.ID)

	// Build environment
	env, err := buildEnv(profile.Env, profile.EnvFile, effectiveDir)
	if err != nil {
		e.mu.Unlock()
		return err
	}

	// Create command via platform helper
	cmd := shellCommand(profile.Command)
	cmd.Dir = effectiveDir
	cmd.Env = env
	setSysProcAttr(cmd)

	// Set up pipes
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		e.mu.Unlock()
		return fmt.Errorf("creating stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		e.mu.Unlock()
		return fmt.Errorf("creating stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		e.mu.Unlock()
		return fmt.Errorf("starting process: %w", err)
	}

	rp := &runningProcess{
		cmd: cmd,
		status: RunStatus{
			ProfileID: profile.ID,
			State:     RunStateRunning,
			Pid:       cmd.Process.Pid,
		},
		done: make(chan struct{}),
	}
	e.processes[profile.ID] = rp
	e.mu.Unlock()

	// Emit running status
	e.emit(rp.status)

	// Drain stdout/stderr
	var pipesWg sync.WaitGroup
	pipesWg.Add(2)
	go e.drainPipe(&pipesWg, profile.ID, "stdout", stdout)
	go e.drainPipe(&pipesWg, profile.ID, "stderr", stderr)

	// Wait for process exit
	go func() {
		pipesWg.Wait()
		exitCode := waitExitCode(cmd)

		e.mu.Lock()
		stopped := rp.stopped
		if stopped {
			rp.status.State = RunStateStopped
		} else if exitCode == 0 {
			rp.status.State = RunStateSuccess
		} else {
			rp.status.State = RunStateFailed
		}
		rp.status.ExitCode = exitCode
		rp.status.Pid = 0
		status := rp.status
		e.lastStatus[profile.ID] = status
		delete(e.processes, profile.ID)
		e.mu.Unlock()

		e.emit(status)
		close(rp.done)
	}()

	return nil
}

// Stop terminates a running profile. Sends SIGTERM, waits up to 3 seconds,
// then escalates to SIGKILL. Blocks until the process is fully cleaned up.
func (e *Executor) Stop(profileID string) error {
	e.mu.Lock()
	rp, exists := e.processes[profileID]
	if !exists {
		e.mu.Unlock()
		return fmt.Errorf("profile not running: %s", profileID)
	}
	e.mu.Unlock()

	rp.stopOnce.Do(func() {
		e.mu.Lock()
		rp.stopped = true
		e.mu.Unlock()

		pid := rp.cmd.Process.Pid
		_ = killProcessGroup(pid)

		select {
		case <-rp.done:
			return
		case <-time.After(stopGracePeriod):
			_ = forceKillProcessGroup(pid)
		}
	})

	// Block until fully cleaned up
	<-rp.done
	return nil
}

// StopAll terminates all running profiles within the given timeout.
// Returns true if all processes were cleaned up before the deadline.
func (e *Executor) StopAll(timeout time.Duration) bool {
	e.mu.Lock()
	if len(e.processes) == 0 {
		e.mu.Unlock()
		return true
	}

	// Copy entries for concurrent stop
	type entry struct {
		id string
		rp *runningProcess
	}
	entries := make([]entry, 0, len(e.processes))
	for id, rp := range e.processes {
		entries = append(entries, entry{id, rp})
	}

	// Mark all as stopped
	for _, ent := range entries {
		ent.rp.stopped = true
	}
	e.mu.Unlock()

	// Send SIGTERM to all
	for _, ent := range entries {
		pid := ent.rp.cmd.Process.Pid
		_ = killProcessGroup(pid)
	}

	halfway := timeout / 2
	deadline := time.After(timeout)
	halfwayTimer := time.After(halfway)

	// Collect done channels
	allDone := make(chan struct{})
	go func() {
		for _, ent := range entries {
			<-ent.rp.done
		}
		close(allDone)
	}()

	// Wait for halfway point — escalate survivors to SIGKILL
	select {
	case <-allDone:
		return true
	case <-halfwayTimer:
		// Force-kill any survivors
		e.mu.Lock()
		for _, ent := range entries {
			if _, stillRunning := e.processes[ent.id]; stillRunning {
				pid := ent.rp.cmd.Process.Pid
				_ = forceKillProcessGroup(pid)
			}
		}
		e.mu.Unlock()
	}

	// Wait for full deadline
	select {
	case <-allDone:
		return true
	case <-deadline:
		return false
	}
}

// GetStatus returns the current run status of a profile.
// Returns the terminal status (success/failed/stopped) if the profile has
// completed but has not been restarted, or RunStateIdle if never started.
func (e *Executor) GetStatus(profileID string) RunStatus {
	e.mu.Lock()
	defer e.mu.Unlock()

	if rp, exists := e.processes[profileID]; exists {
		return rp.status
	}
	if last, exists := e.lastStatus[profileID]; exists {
		return last
	}
	return RunStatus{ProfileID: profileID, State: RunStateIdle}
}

// ClearTerminalStatuses removes all retained terminal statuses.
// Called on workspace switch so stale results from the previous workspace
// cannot leak into a new workspace that reuses the same profile IDs.
func (e *Executor) ClearTerminalStatuses() {
	e.mu.Lock()
	defer e.mu.Unlock()
	clear(e.lastStatus)
}

// emit sends a status event via the configured StatusFunc.
func (e *Executor) emit(status RunStatus) {
	if e.emitFn != nil {
		e.emitFn("run:status", status)
	}
}

// drainPipe reads from a pipe and either forwards to outputFn or discards.
func (e *Executor) drainPipe(wg *sync.WaitGroup, profileID, stream string, pipe io.ReadCloser) {
	defer wg.Done()
	buf := make([]byte, 4096)
	for {
		n, err := pipe.Read(buf)
		if n > 0 && e.outputFn != nil {
			e.outputFn(profileID, stream, string(buf[:n]))
		}
		if err != nil {
			return
		}
	}
}

// resolveWorkingDir converts a profile workingDir into an absolute path.
// Empty workingDir defaults to workspaceRoot. Relative paths are resolved
// against workspaceRoot. Validates the directory exists.
func resolveWorkingDir(workspaceRoot, workingDir string) (string, error) {
	var resolved string
	switch {
	case workingDir == "":
		resolved = workspaceRoot
	case filepath.IsAbs(workingDir):
		resolved = workingDir
	default:
		resolved = filepath.Join(workspaceRoot, workingDir)
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("working directory does not exist: %s", resolved)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("working directory is not a directory: %s", resolved)
	}
	return resolved, nil
}

// buildEnv merges environment sources in precedence order:
// os.Environ() (base) → EnvFile values → profile.Env map (inline wins).
// Relative envFilePath values are resolved against effectiveWorkingDir.
func buildEnv(profileEnv map[string]string, envFilePath string, effectiveWorkingDir string) ([]string, error) {
	// Start with current environment
	envMap := make(map[string]string)
	for _, entry := range os.Environ() {
		if idx := strings.IndexByte(entry, '='); idx >= 0 {
			envMap[entry[:idx]] = entry[idx+1:]
		}
	}

	// Layer 2: env file (if specified)
	if envFilePath != "" {
		resolved := envFilePath
		if !filepath.IsAbs(resolved) {
			resolved = filepath.Join(effectiveWorkingDir, resolved)
		}
		fileEnv, err := ParseEnvFile(resolved)
		if err != nil {
			return nil, err
		}
		for k, v := range fileEnv {
			envMap[k] = v
		}
	}

	// Layer 3: inline env vars (highest precedence)
	for k, v := range profileEnv {
		envMap[k] = v
	}

	// Convert back to slice
	result := make([]string, 0, len(envMap))
	for k, v := range envMap {
		result = append(result, k+"="+v)
	}
	return result, nil
}

// waitExitCode waits for the command to finish and extracts the exit code.
func waitExitCode(cmd *exec.Cmd) int {
	err := cmd.Wait()
	if err == nil {
		return 0
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode()
	}
	return 1
}

package runprofile

import (
	"context"
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
	RunIdentity
	State     RunState `json:"state"`
	ExitCode  int      `json:"exitCode"`
	Pid       int      `json:"pid,omitempty"`
	Timestamp int64    `json:"timestamp"`
}

// OutputChunk is the run:output event payload. It embeds RunIdentity so output
// routes by explicit fields rather than a parsed synthetic profile id.
type OutputChunk struct {
	RunIdentity
	Stream    string `json:"stream"`
	Data      string `json:"data"`
	Timestamp int64  `json:"timestamp"`
}

// OutputFunc receives streaming process output for one execution instance.
// stream is "stdout" or "stderr". data is the raw chunk. timestamp is the Unix
// millisecond time when the data was read.
// The caller is responsible for buffering or backpressure.
type OutputFunc func(id RunIdentity, stream, data string, timestamp int64)

// StatusFunc emits run status events (wraps runtime.EventsEmit in production).
type StatusFunc func(event string, data ...any)

// Executor manages the lifecycle of running profiles.
type Executor struct {
	mu             sync.Mutex
	nextRunSeq     uint64
	processes      map[string]*runningProcess
	processAliases map[string]string       // real profile ID -> process key for compound leaves
	compounds      map[string]*compoundRun // in-flight compound runs keyed by compound ID
	lastStatus     map[string]RunStatus    // terminal status retained after exit
	emitFn         StatusFunc
	outputFn       OutputFunc
}

type processResult struct {
	state      RunState
	exitCode   int
	workingDir string
}

// runningProcess tracks a single running profile execution.
type runningProcess struct {
	cmd        *exec.Cmd
	identity   RunIdentity
	status     RunStatus
	stopped    bool          // set by Stop — tells Wait goroutine to use RunStateStopped
	done       chan struct{} // closed when process exits and cleanup is complete
	stopOnce   sync.Once
	stdout     io.ReadCloser
	stderr     io.ReadCloser
	workingDir string
}

// NewExecutor creates an Executor.
// emitFn emits Wails events (or a test spy).
// outputFn receives stdout/stderr chunks (nil = drain silently).
func NewExecutor(emitFn StatusFunc, outputFn OutputFunc) *Executor {
	return &Executor{
		processes:      make(map[string]*runningProcess),
		processAliases: make(map[string]string),
		compounds:      make(map[string]*compoundRun),
		lastStatus:     make(map[string]RunStatus),
		emitFn:         emitFn,
		outputFn:       outputFn,
	}
}

// Start begins executing a run profile. Profile resolution (ID → RunProfile)
// happens at the app.go binding level. The executor receives the resolved profile.
func (e *Executor) Start(workspaceRoot string, profile RunProfile) error {
	if err := rejectReservedProfileID(profile.ID); err != nil {
		return err
	}
	if profile.Type == ProfileTypeCompound {
		return fmt.Errorf("compound profiles require resolved steps: %s", profile.ID)
	}

	rp, err := e.startProcess(profile.ID, profile, workspaceRoot)
	if err != nil {
		return err
	}

	e.emit(rp.status)
	go e.waitProcess(profile.ID, rp, true, true)
	return nil
}

func (e *Executor) startProcess(key string, profile RunProfile, workspaceRoot string) (*runningProcess, error) {
	if err := rejectReservedProfileID(profile.ID); err != nil {
		return nil, err
	}
	if workspaceRoot == "" {
		return nil, fmt.Errorf("no workspace loaded")
	}

	if strings.TrimSpace(profile.Command) == "" {
		return nil, fmt.Errorf("profile has no command: %s", profile.ID)
	}

	effectiveDir, err := resolveWorkingDir(workspaceRoot, profile.WorkingDir)
	if err != nil {
		return nil, err
	}

	// Hold the lock for the entire setup-through-insert sequence. This prevents
	// concurrent starts for the same profile ID (TOCTOU) and ensures Stop/StopAll
	// never see a partially-initialized entry. The locked work is fast: env merging
	// (small .env file read), pipe setup, and fork.
	e.mu.Lock()
	if _, exists := e.processes[key]; exists {
		e.mu.Unlock()
		return nil, fmt.Errorf("profile already running: %s", key)
	}
	if existingKey, exists := e.processAliases[key]; exists {
		if _, running := e.processes[existingKey]; running {
			e.mu.Unlock()
			return nil, fmt.Errorf("profile already running: %s", key)
		}
		delete(e.processAliases, key)
	}
	if key != profile.ID {
		if _, exists := e.processes[profile.ID]; exists {
			e.mu.Unlock()
			return nil, fmt.Errorf("profile already running: %s", profile.ID)
		}
		if existingKey, exists := e.processAliases[profile.ID]; exists {
			if _, running := e.processes[existingKey]; running {
				e.mu.Unlock()
				return nil, fmt.Errorf("profile already running: %s", profile.ID)
			}
			delete(e.processAliases, profile.ID)
		}
	}
	delete(e.lastStatus, key)

	// Build environment
	env, err := buildEnv(profile, effectiveDir)
	if err != nil {
		e.mu.Unlock()
		return nil, err
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
		return nil, fmt.Errorf("creating stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		e.mu.Unlock()
		return nil, fmt.Errorf("creating stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		e.mu.Unlock()
		return nil, fmt.Errorf("starting process: %w", err)
	}

	rp := &runningProcess{
		cmd:      cmd,
		identity: RunIdentity{RunInstanceID: key, ProfileID: profile.ID},
		status: RunStatus{
			RunIdentity: RunIdentity{RunInstanceID: key, ProfileID: profile.ID},
			State:       RunStateRunning,
			Pid:         cmd.Process.Pid,
		},
		done:       make(chan struct{}),
		stdout:     stdout,
		stderr:     stderr,
		workingDir: effectiveDir,
	}
	e.processes[key] = rp
	if key != profile.ID {
		e.processAliases[profile.ID] = key
	}
	e.mu.Unlock()

	return rp, nil
}

func (e *Executor) waitProcess(key string, rp *runningProcess, emitStatus bool, retainStatus bool) processResult {
	batcher := newOutputBatcher(e.outputFn, 16*time.Millisecond)
	var pipesWg sync.WaitGroup
	pipesWg.Add(2)
	go e.drainPipe(&pipesWg, rp.identity, "stdout", rp.stdout, batcher)
	go e.drainPipe(&pipesWg, rp.identity, "stderr", rp.stderr, batcher)

	pipesWg.Wait()
	batcher.Close()
	exitCode := waitExitCode(rp.cmd)

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
	if retainStatus {
		e.lastStatus[key] = status
	}
	delete(e.processes, key)
	for alias, target := range e.processAliases {
		if target == key {
			delete(e.processAliases, alias)
		}
	}
	e.mu.Unlock()

	if emitStatus {
		e.emit(status)
	}
	close(rp.done)

	return processResult{
		state:      status.State,
		exitCode:   exitCode,
		workingDir: rp.workingDir,
	}
}

// Stop terminates a running profile. Sends SIGTERM, waits up to 3 seconds,
// then escalates to SIGKILL. Blocks until the process is fully cleaned up.
//
// If profileID refers to an in-flight compound run, the compound is cancelled
// (preventing the next step from starting), the currently-running leaf (if any)
// is stopped via the leaf path, and Stop blocks until the coordinator finishes.
func (e *Executor) Stop(profileID string) error {
	e.mu.Lock()
	if cr, ok := e.compounds[profileID]; ok {
		cancel := cr.cancel
		stepKey := compoundStepKey(profileID, cr.current)
		_, leafRunning := e.processes[stepKey]
		done := cr.done
		e.mu.Unlock()

		cancel()
		if leafRunning {
			// Leaf path runs in this (caller) goroutine, distinct from the
			// coordinator goroutine that closes cr.done, so there is no
			// self-deadlock. The error is intentionally ignored: the leaf may
			// already be exiting on its own.
			_ = e.Stop(stepKey)
		}
		<-done
		return nil
	}

	processKey := profileID
	if aliasTarget, ok := e.processAliases[profileID]; ok {
		processKey = aliasTarget
	}
	rp, exists := e.processes[processKey]
	if !exists {
		e.mu.Unlock()
		return fmt.Errorf("profile not running: %s", profileID)
	}
	e.mu.Unlock()

	e.signalStop(rp)

	// Block until fully cleaned up
	<-rp.done
	return nil
}

// signalStop sends SIGTERM to a leaf's process group exactly once and escalates
// to SIGKILL after stopGracePeriod if it has not exited. The escalation runs in
// a watchdog goroutine, so this is non-blocking: callers that own rp.done (the
// compound coordinator, which closes it via waitProcess) can call this and keep
// going, while callers that need full cleanup wait on rp.done afterward. Using
// rp.stopOnce ensures a single SIGTERM + single escalation even when both an
// external Stop and the coordinator's start/stop-race fallback target the leaf.
func (e *Executor) signalStop(rp *runningProcess) {
	rp.stopOnce.Do(func() {
		e.mu.Lock()
		rp.stopped = true
		e.mu.Unlock()

		pid := rp.cmd.Process.Pid
		_ = killProcessGroup(pid)

		go func() {
			select {
			case <-rp.done:
			case <-time.After(stopGracePeriod):
				_ = forceKillProcessGroup(pid)
			}
		}()
	})
}

// StopAll terminates all running profiles within the given timeout.
// Returns true if all processes (and compound coordinators) were cleaned up
// before the deadline.
//
// Compound current-step leaves are already in e.processes, so they are included
// in the process copy and receive SIGTERM. Each compound coordinator is also
// cancelled so the next step cannot start, and StopAll waits on every compound
// done channel in addition to every process done channel.
func (e *Executor) StopAll(timeout time.Duration) bool {
	e.mu.Lock()
	if len(e.processes) == 0 && len(e.compounds) == 0 {
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

	// Copy compound coordinators (cancel + done) for concurrent cancellation.
	type compoundEntry struct {
		cancel context.CancelFunc
		done   chan struct{}
	}
	compoundEntries := make([]compoundEntry, 0, len(e.compounds))
	for _, cr := range e.compounds {
		compoundEntries = append(compoundEntries, compoundEntry{cancel: cr.cancel, done: cr.done})
	}

	// Mark all processes as stopped
	for _, ent := range entries {
		ent.rp.stopped = true
	}
	e.mu.Unlock()

	// Cancel every compound coordinator (prevents the next step starting).
	for _, ce := range compoundEntries {
		ce.cancel()
	}

	// Send SIGTERM to all
	for _, ent := range entries {
		pid := ent.rp.cmd.Process.Pid
		_ = killProcessGroup(pid)
	}

	halfway := timeout / 2
	deadline := time.After(timeout)
	halfwayTimer := time.After(halfway)

	// Collect done channels (processes + compound coordinators). The collector
	// also selects on stopWaiting so it cannot leak if a survivor never exits:
	// on a deadline miss we close stopWaiting and the goroutine returns instead
	// of blocking forever on a wedged done channel.
	allDone := make(chan struct{})
	stopWaiting := make(chan struct{})
	go func() {
		waitDone := func(ch <-chan struct{}) bool {
			select {
			case <-ch:
				return true
			case <-stopWaiting:
				return false
			}
		}
		for _, ent := range entries {
			if !waitDone(ent.rp.done) {
				return
			}
		}
		for _, ce := range compoundEntries {
			if !waitDone(ce.done) {
				return
			}
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
		close(stopWaiting)
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
	if aliasTarget, exists := e.processAliases[profileID]; exists {
		if rp, running := e.processes[aliasTarget]; running {
			status := rp.status
			status.ProfileID = profileID
			return status
		}
	}
	if cr, exists := e.compounds[profileID]; exists {
		return cr.status
	}
	if last, exists := e.lastStatus[profileID]; exists {
		return last
	}
	return RunStatus{RunIdentity: RunIdentity{ProfileID: profileID}, State: RunStateIdle}
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
	status.Timestamp = time.Now().UnixMilli()
	if e.emitFn != nil {
		e.emitFn("run:status", status)
	}
}

// drainPipe reads from a pipe and forwards chunks to the output batcher.
func (e *Executor) drainPipe(wg *sync.WaitGroup, id RunIdentity, stream string, pipe io.ReadCloser, batcher *outputBatcher) {
	defer wg.Done()
	buf := make([]byte, 4096)
	for {
		n, err := pipe.Read(buf)
		if n > 0 {
			batcher.Write(id, stream, string(buf[:n]), time.Now().UnixMilli())
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
// os.Environ() → profile.Env → profile.EnvFile → active variant env file.
// Relative env file paths are resolved against effectiveWorkingDir.
func buildEnv(profile RunProfile, effectiveWorkingDir string) ([]string, error) {
	// Start with current environment
	envMap := make(map[string]string)
	for _, entry := range os.Environ() {
		if idx := strings.IndexByte(entry, '='); idx >= 0 {
			envMap[entry[:idx]] = entry[idx+1:]
		}
	}

	// Layer 2: inline profile env
	for k, v := range profile.Env {
		envMap[k] = v
	}

	// Layer 3: base env file
	if err := mergeEnvFile(envMap, profile.EnvFile, effectiveWorkingDir); err != nil {
		return nil, err
	}

	// Layer 4: active variant env file
	variantEnvFile, err := activeVariantEnvFile(profile)
	if err != nil {
		return nil, err
	}
	if err := mergeEnvFile(envMap, variantEnvFile, effectiveWorkingDir); err != nil {
		return nil, err
	}

	// Convert back to slice
	result := make([]string, 0, len(envMap))
	for k, v := range envMap {
		result = append(result, k+"="+v)
	}
	return result, nil
}

func mergeEnvFile(envMap map[string]string, envFilePath string, effectiveWorkingDir string) error {
	if strings.TrimSpace(envFilePath) == "" {
		return nil
	}
	resolved := envFilePath
	if !filepath.IsAbs(resolved) {
		resolved = filepath.Join(effectiveWorkingDir, resolved)
	}
	fileEnv, err := ParseEnvFile(resolved)
	if err != nil {
		return err
	}
	for k, v := range fileEnv {
		envMap[k] = v
	}
	return nil
}

func activeVariantEnvFile(profile RunProfile) (string, error) {
	if strings.TrimSpace(profile.ActiveVariant) == "" {
		return "", nil
	}
	variant, ok := findEnvVariant(profile.EnvVariants, profile.ActiveVariant)
	if !ok {
		return "", fmt.Errorf("env variant %q not found for profile %s", profile.ActiveVariant, profile.ID)
	}
	return variant.EnvFile, nil
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

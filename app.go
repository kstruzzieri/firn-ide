package main

import (
	"context"
	"firn/internal/filesystem"
	"firn/internal/lsp"
	"firn/internal/lsp/provision"
	"firn/internal/runprofile"
	"firn/internal/search"
	"firn/internal/terminal"
	"firn/internal/watcher"
	"firn/internal/workspace"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App represents the main application structure for Firn IDE.
// It holds the application context for Wails runtime interactions.
type App struct {
	ctx                  context.Context
	dirReader            *filesystem.DirectoryReader
	fileReader           *filesystem.FileReader
	fileWriter           *filesystem.FileWriter
	fileWatcher          watcher.Watcher
	termManager          *terminal.Manager
	profileMu            sync.RWMutex
	profileManager       *runprofile.ProjectRunProfileManager
	profileWorkspaceRoot string
	// emitFn lets tests observe emitted events. nil in production → runtime.EventsEmit.
	emitFn         func(event string, data ...any)
	executor       *runprofile.Executor
	osFS           filesystem.FileSystem
	workspaceStore *workspace.Store
	lspManager     *lsp.Manager
	searchManager  *search.Manager
	closeMu        sync.Mutex
	isClosing      bool
	closeReady     chan struct{}
}

// NewApp creates and returns a new App instance.
func NewApp() *App {
	osFS := filesystem.NewOS()

	// Create file watcher with default config
	watcherConfig := watcher.WatcherConfig{
		DebounceMs: 100,
	}
	fw, _ := watcher.NewFSNotifyWatcher(watcherConfig)

	homeDir, _ := os.UserHomeDir()
	workspaceBaseDir := filepath.Join(homeDir, ".firn", "workspaces")

	return &App{
		dirReader:      filesystem.NewDirectoryReader(osFS),
		fileReader:     filesystem.NewFileReader(osFS),
		fileWriter:     filesystem.NewFileWriter(osFS),
		fileWatcher:    fw,
		termManager:    terminal.NewManager(),
		osFS:           osFS,
		workspaceStore: workspace.NewStore(osFS, workspaceBaseDir),
		searchManager:  search.NewManager(),
	}
}

// startup is called by Wails when the application starts.
// It stores the context for later use with runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.executor = runprofile.NewExecutor(
		func(event string, data ...any) {
			runtime.EventsEmit(a.ctx, event, data...)
		},
		func(id runprofile.RunIdentity, stream, data string, timestamp int64) {
			runtime.EventsEmit(a.ctx, "run:output", runprofile.OutputChunk{
				RunIdentity: id,
				Stream:      stream,
				Data:        data,
				Timestamp:   timestamp,
			})
		},
	)
	a.lspManager = lsp.NewManager(func(event string, data ...any) {
		runtime.EventsEmit(a.ctx, event, data...)
	})
	a.wireLSPProvisioners()
}

// wireLSPProvisioners builds and registers the managed-server provisioners on
// the LSP manager. Currently only the Python (basedpyright) provisioner is
// managed. When the home directory is unavailable the provisioner is skipped
// gracefully — managed installs simply won't be offered, while interpreter/env
// wiring still works.
func (a *App) wireLSPProvisioners() {
	if a.lspManager == nil {
		return
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return
	}
	cacheRoot := filepath.Join(home, ".firn", "servers")
	pyProv := provision.NewPythonProvisioner(cacheRoot, stdruntime.GOOS, stdruntime.GOARCH, provision.PythonDeps{
		LookPath: exec.LookPath,
		RunUV: func(ctx context.Context, uv string, args, env []string) error {
			cmd := exec.CommandContext(ctx, uv, args...)
			cmd.Env = env
			return cmd.Run()
		},
		// Fetch nil -> defaultFetch (real download+verify+unzip).
	})
	a.lspManager.SetProvisioners(map[string]provision.Provisioner{"python": pyProv})
}

// beforeClose is called by Wails before the application window closes.
// On the first call it prevents close, emits an event so the frontend can
// perform a final state save, and concurrently stops any running profiles.
// Both must complete (or a 2-second deadline expires) before the app quits.
// When the forced quit triggers OnBeforeClose again, the isClosing flag
// is already set so it returns false immediately, allowing the close.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	a.closeMu.Lock()
	if a.isClosing {
		a.closeMu.Unlock()
		return false
	}
	a.isClosing = true
	a.closeReady = make(chan struct{})
	closeReady := a.closeReady
	a.closeMu.Unlock()

	runtime.EventsEmit(a.ctx, "app:beforeclose")

	// Cancel any in-flight workspace searches before the runner/LSP shutdown
	// goroutines run. CancelAll is synchronous (it only signals contexts; the
	// rg processes wind down via exec.CommandContext), so it does not need its
	// own deadline like the runner/LSP paths do.
	if a.searchManager != nil {
		a.searchManager.CancelAll()
	}

	go func() {
		// Wait for frontend state flush, runner cleanup, and LSP shutdown, bounded by 2s.
		runnerDone := make(chan struct{})
		go func() {
			if a.executor != nil {
				_ = a.executor.StopAll(1500 * time.Millisecond)
			}
			close(runnerDone)
		}()

		lspDone := make(chan struct{})
		go func() {
			if a.lspManager != nil {
				a.lspManager.ShutdownAll(1500 * time.Millisecond)
			}
			close(lspDone)
		}()

		deadline := time.After(2 * time.Second)
		closeReadyCh := closeReady
		runnerDoneCh := runnerDone
		lspDoneCh := lspDone

		for closeReadyCh != nil || runnerDoneCh != nil || lspDoneCh != nil {
			select {
			case <-closeReadyCh:
				closeReadyCh = nil
			case <-runnerDoneCh:
				runnerDoneCh = nil
			case <-lspDoneCh:
				lspDoneCh = nil
			case <-deadline:
				runtime.Quit(a.ctx)
				return
			}
		}

		runtime.Quit(a.ctx)
	}()

	return true
}

// GetWorkspaceInfo returns information about the current workspace.
// Returns empty values when no workspace is loaded.
func (a *App) GetWorkspaceInfo() WorkspaceInfo {
	// TODO: Implement actual workspace detection
	return WorkspaceInfo{
		Name: "",
		Path: "",
	}
}

// WorkspaceInfo contains information about the current workspace.
type WorkspaceInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// ReadDirectory reads a directory and returns its contents as a tree structure.
// This is exposed to the frontend via Wails bindings.
func (a *App) ReadDirectory(path string) ([]filesystem.FileEntry, error) {
	return a.dirReader.ReadDirectory(path)
}

// ReadDirectoryShallow reads a single directory level (immediate children only).
// Used for lazy tree loading — child directories are returned without their
// own children populated.
func (a *App) ReadDirectoryShallow(path string, rootPath string) ([]filesystem.FileEntry, error) {
	return a.dirReader.ReadDirectoryShallow(path, rootPath)
}

// ReadFile reads a file and returns its contents with metadata.
// Detects encoding (UTF-8, UTF-16, Latin-1) and line endings.
// This is exposed to the frontend via Wails bindings.
func (a *App) ReadFile(path string) (*filesystem.FileContent, error) {
	return a.fileReader.ReadFileWithMetadata(path)
}

// WriteFile writes content to a file with optional encoding and line ending settings.
// This is exposed to the frontend via Wails bindings.
func (a *App) WriteFile(path string, content string, encoding string, lineEndings string, createBackup bool) error {
	opts := &filesystem.WriteOptions{
		Encoding:     encoding,
		LineEndings:  lineEndings,
		CreateBackup: createBackup,
		CreateDirs:   true,
	}
	return a.fileWriter.WriteFileWithOptions(path, content, opts)
}

// StartWatching starts watching the given path for file changes.
// Events are emitted to the frontend via "file:changed" event.
// This is exposed to the frontend via Wails bindings.
func (a *App) StartWatching(path string) error {
	return a.fileWatcher.Watch(a.ctx, path, func(event watcher.FileEvent) {
		runtime.EventsEmit(a.ctx, "file:changed", event)

		// Reactive run profile re-detection on config file changes
		a.profileMu.RLock()
		if a.profileManager == nil {
			a.profileMu.RUnlock()
			return
		}

		changed := a.profileManager.HandleFileChange(event.Path)
		var snap runprofile.RunProfilesSnapshot
		if changed {
			snap = a.profileManager.Snapshot()
		}
		a.profileMu.RUnlock()

		if changed {
			runtime.EventsEmit(a.ctx, "runprofiles:changed", snap)
		}
	})
}

// StopWatching stops watching for file changes.
// This is exposed to the frontend via Wails bindings.
func (a *App) StopWatching() error {
	return a.fileWatcher.Stop()
}

// IsWatching returns true if currently watching a path.
// This is exposed to the frontend via Wails bindings.
func (a *App) IsWatching() bool {
	return a.fileWatcher.IsWatching()
}

// GetWatchedPath returns the currently watched path.
// This is exposed to the frontend via Wails bindings.
func (a *App) GetWatchedPath() string {
	return a.fileWatcher.WatchedPath()
}

// OpenFolderDialog opens a native folder picker dialog.
// Returns the selected folder path, or empty string if cancelled.
// This is exposed to the frontend via Wails bindings.
func (a *App) OpenFolderDialog() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Folder",
	})
}

// ToggleMaximize toggles the window between maximized and restored states.
// This is exposed to the frontend via Wails bindings.
func (a *App) ToggleMaximize() {
	runtime.WindowToggleMaximise(a.ctx)
}

// CreateTerminal creates a new terminal
// This is exposed to the frontend via Wails bindings.
func (a *App) CreateTerminal() (string, error) {
	id, err := a.termManager.Create()
	if err != nil {
		runtime.LogErrorf(a.ctx, "CreateTerminal failed: %v", err)
		return "", err
	}

	session, _ := a.termManager.Get(id)
	go session.ReadLoop(func(data string) {
		runtime.EventsEmit(a.ctx, "terminal:output", id, data)
	})

	return id, nil
}

// WriteTerminal passes strings from JS
// This is exposed to the frontend via Wails bindings.
func (a *App) WriteTerminal(id string, data string) error {
	return a.termManager.Write(id, []byte(data))
}

// ResizeTerminal passes the new dimensions of the terminal window
// This is exposed to the frontend via Wails bindings.
func (a *App) ResizeTerminal(id string, rows uint16, cols uint16) error {
	return a.termManager.Resize(id, rows, cols)
}

// CloseTerminal terminates the terminal session and removes it from the manager.
// This is exposed to the frontend via Wails bindings.
func (a *App) CloseTerminal(id string) error {
	return a.termManager.Close(id)
}

// LoadRunProfiles initializes or reinitializes the run profile manager for the given workspace path.
// If switching workspaces while profiles are running, stops all running profiles first.
// This is exposed to the frontend via Wails bindings.
func (a *App) LoadRunProfiles(workspacePath string) error {
	// Always sync LSP workspace root, even if profile loading fails.
	// The user has switched workspaces — LSP must follow regardless.
	if a.lspManager != nil {
		a.SetLSPWorkspaceRoot(workspacePath)
	}

	return a.loadRunProfilesLocked(workspacePath)
}

// loadRunProfilesLocked performs the profile loading under profileMu.
func (a *App) loadRunProfilesLocked(workspacePath string) error {
	a.profileMu.Lock()
	defer a.profileMu.Unlock()

	// Stop running profiles and clear stale terminal statuses when switching workspaces
	if a.profileWorkspaceRoot != "" && a.profileWorkspaceRoot != workspacePath && a.executor != nil {
		if ok := a.executor.StopAll(4 * time.Second); !ok {
			return fmt.Errorf("failed to stop running profiles before switching workspace")
		}
		a.executor.ClearTerminalStatuses()
	}

	if a.profileManager == nil || a.profileWorkspaceRoot != workspacePath {
		a.profileManager = runprofile.NewProjectManager(a.osFS, workspacePath)
	}
	a.profileWorkspaceRoot = workspacePath

	if err := a.profileManager.Load(); err != nil {
		return err
	}
	// Surface non-fatal load issues (unreadable workspace store, migration that
	// could not be written back) instead of swallowing them. A degraded load
	// still yields a usable profile list.
	for _, w := range a.profileManager.Warnings() {
		runtime.LogWarningf(a.ctx, "run profiles: %s", w)
	}
	return nil
}

// GetAllRunProfiles returns all run profiles (saved + detected, deduplicated).
// This is exposed to the frontend via Wails bindings.
func (a *App) GetAllRunProfiles() []runprofile.RunProfile {
	a.profileMu.RLock()
	defer a.profileMu.RUnlock()

	if a.profileManager == nil {
		return []runprofile.RunProfile{}
	}
	return a.profileManager.GetAllProfiles()
}

// GetRunProfilesSnapshot returns the combined profile list plus per-profile UI
// state (adoption + run recency). This is the P2 hydration contract.
// This is exposed to the frontend via Wails bindings.
func (a *App) GetRunProfilesSnapshot() runprofile.RunProfilesSnapshot {
	a.profileMu.RLock()
	defer a.profileMu.RUnlock()
	if a.profileManager == nil {
		return runprofile.RunProfilesSnapshot{Profiles: []runprofile.RunProfile{}, ProfileState: map[string]runprofile.ProfileUIState{}}
	}
	return a.profileManager.Snapshot()
}

// AdoptRunProfile adds a profile to its workspace working set and emits an update.
// This is exposed to the frontend via Wails bindings.
func (a *App) AdoptRunProfile(id string) error {
	return a.mutateAndEmitProfiles(func(m *runprofile.ProjectRunProfileManager) error { return m.AdoptProfile(id) })
}

// UnadoptRunProfile removes a profile from its workspace working set and emits an update.
// This is exposed to the frontend via Wails bindings.
func (a *App) UnadoptRunProfile(id string) error {
	return a.mutateAndEmitProfiles(func(m *runprofile.ProjectRunProfileManager) error { return m.UnadoptProfile(id) })
}

// emit sends a Wails event, or routes to emitFn when set (tests).
func (a *App) emit(event string, data ...any) {
	if a.emitFn != nil {
		a.emitFn(event, data...)
		return
	}
	runtime.EventsEmit(a.ctx, event, data...)
}

// mutateAndEmitProfiles runs a manager mutation under the app read lock, then emits the full snapshot on success. Centralizes the lock/emit dance shared by pin/unpin/variant/adopt/unadopt.
func (a *App) mutateAndEmitProfiles(fn func(*runprofile.ProjectRunProfileManager) error) error {
	a.profileMu.RLock()
	if a.profileManager == nil {
		a.profileMu.RUnlock()
		return fmt.Errorf("no workspace loaded")
	}
	if err := fn(a.profileManager); err != nil {
		a.profileMu.RUnlock()
		return err
	}
	snap := a.profileManager.Snapshot()
	a.profileMu.RUnlock()
	a.emit("runprofiles:changed", snap)
	return nil
}

// SaveRunProfile validates and saves a run profile, emitting runprofiles:changed
// on a successful, valid save. This is exposed to the frontend via Wails bindings.
func (a *App) SaveRunProfile(profile runprofile.RunProfile) (runprofile.ValidationResult, error) {
	a.profileMu.RLock()
	if a.profileManager == nil {
		a.profileMu.RUnlock()
		return runprofile.ValidationResult{Valid: false, Errors: []runprofile.ValidationError{
			{Field: "workspace", Message: "no workspace loaded"},
		}}, nil
	}
	result, err := a.profileManager.SaveProfile(profile)
	var snap runprofile.RunProfilesSnapshot
	shouldEmit := err == nil && result.Valid
	if shouldEmit {
		snap = a.profileManager.Snapshot()
	}
	a.profileMu.RUnlock()
	if shouldEmit {
		a.emit("runprofiles:changed", snap)
	}
	return result, err
}

// DeleteRunProfile removes a saved run profile by ID, emitting runprofiles:changed
// on success. This is exposed to the frontend via Wails bindings.
func (a *App) DeleteRunProfile(id string) error {
	a.profileMu.RLock()
	if a.profileManager == nil {
		a.profileMu.RUnlock()
		return fmt.Errorf("no workspace loaded")
	}
	err := a.profileManager.DeleteProfile(id)
	var snap runprofile.RunProfilesSnapshot
	if err == nil {
		snap = a.profileManager.Snapshot()
	}
	a.profileMu.RUnlock()
	if err == nil {
		a.emit("runprofiles:changed", snap)
	}
	return err
}

// PinRunProfile converts a detected profile to a saved profile and emits an update event.
// This is exposed to the frontend via Wails bindings.
func (a *App) PinRunProfile(id string) error {
	return a.mutateAndEmitProfiles(func(m *runprofile.ProjectRunProfileManager) error { return m.PinProfile(id) })
}

// UnpinRunProfile reverts a saved (pinned) profile back to detected status.
// This is exposed to the frontend via Wails bindings.
func (a *App) UnpinRunProfile(id string) error {
	return a.mutateAndEmitProfiles(func(m *runprofile.ProjectRunProfileManager) error { return m.UnpinProfile(id) })
}

// SetActiveVariant selects the env variant for a run profile and emits the updated profile list.
// This is exposed to the frontend via Wails bindings.
func (a *App) SetActiveVariant(profileID string, variant string) error {
	return a.mutateAndEmitProfiles(func(m *runprofile.ProjectRunProfileManager) error {
		return m.SetActiveVariant(profileID, variant)
	})
}

// ValidateRunProfile validates a run profile without saving it.
// This is exposed to the frontend via Wails bindings.
func (a *App) ValidateRunProfile(profile runprofile.RunProfile) runprofile.ValidationResult {
	a.profileMu.RLock()
	defer a.profileMu.RUnlock()

	// Use the coordinator so the workspace-membership check matches what
	// SaveRunProfile will accept; fall back to the pure validator when no
	// workspace is loaded.
	if a.profileManager == nil {
		return runprofile.Validate(profile)
	}
	return a.profileManager.ValidateProfile(profile)
}

// DetectRunProfiles re-runs auto-detection and returns detected profiles.
// This is exposed to the frontend via Wails bindings.
func (a *App) DetectRunProfiles() []runprofile.RunProfile {
	a.profileMu.RLock()
	defer a.profileMu.RUnlock()

	if a.profileManager == nil {
		return []runprofile.RunProfile{}
	}
	return a.profileManager.ReDetect()
}

// SaveWorkspaceState saves workspace state for session restore.
// This is exposed to the frontend via Wails bindings.
func (a *App) SaveWorkspaceState(state workspace.State) error {
	return a.workspaceStore.Save(state)
}

// LoadWorkspaceState loads saved state for a workspace path.
// Returns nil if no saved state exists (first time opening).
// This is exposed to the frontend via Wails bindings.
func (a *App) LoadWorkspaceState(workspacePath string) (*workspace.State, error) {
	return a.workspaceStore.Load(workspacePath)
}

// ListRecentWorkspaces returns summaries of recently opened workspaces.
// This is exposed to the frontend via Wails bindings.
func (a *App) ListRecentWorkspaces() ([]workspace.Summary, error) {
	return a.workspaceStore.ListRecent(0)
}

// DetectWorkspaces scans the repo at repoPath for focused workspaces.
// Returns the synthetic "Project" entry followed by detected workspaces.
func (a *App) DetectWorkspaces(repoPath string) ([]workspace.WorkspaceDef, error) {
	return workspace.DetectWorkspaces(a.osFS, repoPath)
}

// StartRunProfile starts executing a run profile by ID.
// This is exposed to the frontend via Wails bindings.
func (a *App) StartRunProfile(profileID string) error {
	if a.executor == nil {
		return fmt.Errorf("application not initialized")
	}
	a.profileMu.RLock()
	if a.profileManager == nil {
		a.profileMu.RUnlock()
		return fmt.Errorf("no workspace loaded")
	}
	workspaceRoot := a.profileWorkspaceRoot
	profiles := a.profileManager.GetAllProfiles()
	a.profileMu.RUnlock()

	var profile *runprofile.RunProfile
	for i := range profiles {
		if profiles[i].ID == profileID {
			profile = &profiles[i]
			break
		}
	}
	if profile == nil {
		return fmt.Errorf("profile not found: %s", profileID)
	}

	var startErr error
	if profile.Type == runprofile.ProfileTypeCompound {
		steps, err := runprofile.ResolveSteps(*profile, profiles)
		if err != nil {
			return err
		}
		startErr = a.executor.StartCompound(workspaceRoot, *profile, steps)
	} else {
		startErr = a.executor.Start(workspaceRoot, *profile)
	}

	if startErr == nil {
		// Stamp run recency (best-effort; must not fail the run).
		a.profileMu.RLock()
		mgr := a.profileManager
		var snap runprofile.RunProfilesSnapshot
		emit := false
		if mgr != nil {
			if err := mgr.RecordRun(profileID, nowMillis()); err == nil {
				snap = mgr.Snapshot()
				emit = true
			} else {
				runtime.LogWarningf(a.ctx, "could not record run recency for %s: %v", profileID, err)
			}
		}
		a.profileMu.RUnlock()
		if emit {
			runtime.EventsEmit(a.ctx, "runprofiles:changed", snap)
		}
	}

	return startErr
}

// StopRunProfile stops a running profile (SIGTERM → 3s → SIGKILL).
// The id resolves via the executor's active-run table: a single profile's id
// stops that run; a compound profile's id cancels the coordinator and stops the
// current step's leaf; a step profile's own id stops just that leaf (which halts
// the surrounding compound). An idle/unknown id is a no-op (returns nil).
// This is exposed to the frontend via Wails bindings.
func (a *App) StopRunProfile(profileID string) error {
	if a.executor == nil {
		return fmt.Errorf("application not initialized")
	}
	return a.executor.Stop(profileID)
}

// RestartRunProfile stops then starts a profile.
// If the profile is not currently running, it just starts it.
// Stop errors are ignored because the only failure mode is "not running",
// which means we can safely proceed to Start.
// This is exposed to the frontend via Wails bindings.
func (a *App) RestartRunProfile(profileID string) error {
	_ = a.StopRunProfile(profileID)
	return a.StartRunProfile(profileID)
}

// GetRunStatus returns the current run status of a profile. A compound
// profile's id returns its aggregate status. Returns the retained terminal
// status if the profile finished but has not been restarted, or RunStateIdle
// if it is not running and has no retained status.
// This is exposed to the frontend via Wails bindings.
func (a *App) GetRunStatus(profileID string) runprofile.RunStatus {
	if a.executor == nil {
		return runprofile.RunStatus{RunIdentity: runprofile.RunIdentity{ProfileID: profileID}, State: runprofile.RunStateIdle}
	}
	return a.executor.GetStatus(profileID)
}

// ConfirmBeforeCloseReady signals that the frontend finished its final flush
// and the app can proceed with shutdown immediately.
// This is exposed to the frontend via Wails bindings.
func (a *App) ConfirmBeforeCloseReady() {
	a.closeMu.Lock()
	defer a.closeMu.Unlock()

	if a.closeReady == nil {
		return
	}

	select {
	case <-a.closeReady:
	default:
		close(a.closeReady)
	}
}

// --- LSP bindings ---

// LSPDidOpen notifies the LSP manager that a document was opened.
// The frontend is the source of truth for version numbers.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPDidOpen(path, languageID string, version int, content string) error {
	if a.lspManager == nil {
		return fmt.Errorf("LSP not initialized")
	}
	return a.lspManager.DidOpen(a.ctx, path, languageID, version, content)
}

// LSPDidChange notifies the LSP manager that a document changed.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPDidChange(path string, version int, contentChanges []lsp.TextDocumentContentChangeEvent) error {
	if a.lspManager == nil {
		return fmt.Errorf("LSP not initialized")
	}
	return a.lspManager.DidChange(path, version, contentChanges)
}

// LSPDidSave notifies the LSP manager that a document was saved.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPDidSave(path string) error {
	if a.lspManager == nil {
		return fmt.Errorf("LSP not initialized")
	}
	return a.lspManager.DidSave(path)
}

// LSPDidClose notifies the LSP manager that a document was closed.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPDidClose(path string) error {
	if a.lspManager == nil {
		return fmt.Errorf("LSP not initialized")
	}
	return a.lspManager.DidClose(a.ctx, path)
}

// LSPHover requests hover information for a position in a document.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPHover(path string, line, character int) (*lsp.Hover, error) {
	if a.lspManager == nil {
		return nil, fmt.Errorf("LSP not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, lsp.DefaultRequestTimeout)
	defer cancel()
	return a.lspManager.Hover(ctx, path, line, character)
}

// LSPDefinition requests go-to-definition for a position in a document.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPDefinition(path string, line, character int) ([]lsp.Location, error) {
	if a.lspManager == nil {
		return nil, fmt.Errorf("LSP not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, lsp.DefaultRequestTimeout)
	defer cancel()
	return a.lspManager.Definition(ctx, path, line, character)
}

// LSPComplete requests completion items for a position in a document.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPComplete(path string, line, character int, triggerCharacter string) (*lsp.CompletionList, error) {
	if a.lspManager == nil {
		return nil, fmt.Errorf("LSP not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, lsp.DefaultRequestTimeout)
	defer cancel()
	return a.lspManager.Complete(ctx, path, line, character, triggerCharacter)
}

// LSPResolveCompletionItem requests additional detail for a completion item.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPResolveCompletionItem(path string, item lsp.CompletionItem) (*lsp.CompletionItem, error) {
	if a.lspManager == nil {
		return nil, fmt.Errorf("LSP not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, lsp.DefaultRequestTimeout)
	defer cancel()
	return a.lspManager.ResolveCompletionItem(ctx, path, item)
}

// GetLSPStatus returns the status of all running language servers.
// This is exposed to the frontend via Wails bindings.
func (a *App) GetLSPStatus() []lsp.ServerStatus {
	if a.lspManager == nil {
		return []lsp.ServerStatus{}
	}
	return a.lspManager.GetStatus()
}

// lspWorkspaceSwitchTimeout is the time allowed for LSP servers to shut down during a workspace switch.
const lspWorkspaceSwitchTimeout = 3 * time.Second

// SetLSPWorkspaceRoot updates the LSP manager's workspace root.
// Called when the workspace changes — shuts down old servers first.
// This is exposed to the frontend via Wails bindings.
func (a *App) SetLSPWorkspaceRoot(workspacePath string) {
	if a.lspManager == nil {
		return
	}
	a.lspManager.ShutdownAll(lspWorkspaceSwitchTimeout)
	a.lspManager.SetWorkspaceRoot(workspacePath)

	// Seed any persisted interpreter override so it applies before the first
	// file opens. Best-effort: a load error or absent state just means no
	// override to seed.
	if st, err := a.workspaceStore.Load(workspacePath); err == nil && st != nil && st.LSP.InterpreterOverride != "" {
		a.lspManager.SeedInterpreterOverride(workspacePath, st.LSP.InterpreterOverride)
	}
}

// --- LSP Phase 2 bindings (managed provisioning + interpreter override) ---

// LSPDoctor returns interpreter candidates + current override for a workspace.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPDoctor(workspacePath string) (lsp.DoctorReport, error) {
	if a.lspManager == nil {
		return lsp.DoctorReport{}, fmt.Errorf("LSP not initialized")
	}
	return a.lspManager.Doctor(workspacePath), nil
}

// LSPSetInterpreter validates + persists a manual interpreter override for the
// workspace and re-wires/restarts the affected server.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPSetInterpreter(workspacePath, interpreterPath string) error {
	if a.lspManager == nil {
		return fmt.Errorf("LSP not initialized")
	}
	// Validate + apply in the manager first (it stat-checks the path and restarts).
	if err := a.lspManager.SetInterpreterOverride(workspacePath, interpreterPath); err != nil {
		return err
	}
	// Persist only after a successful apply.
	return a.persistLSPInterpreter(workspacePath, interpreterPath)
}

// LSPClearInterpreter removes the override and re-detects.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPClearInterpreter(workspacePath string) error {
	if a.lspManager == nil {
		return fmt.Errorf("LSP not initialized")
	}
	if err := a.lspManager.ClearInterpreterOverride(workspacePath); err != nil {
		return err
	}
	return a.persistLSPInterpreter(workspacePath, "") // empty clears it
}

// LSPRetryProvision re-attempts a managed server install for a family.
// This is exposed to the frontend via Wails bindings.
func (a *App) LSPRetryProvision(family string) error {
	if a.lspManager == nil {
		return fmt.Errorf("LSP not initialized")
	}
	return a.lspManager.RetryProvision(family)
}

// persistLSPInterpreter writes the interpreter override into the workspace's
// persisted state (~/.firn/workspaces). interpreterPath=="" clears it.
func (a *App) persistLSPInterpreter(workspacePath, interpreterPath string) error {
	st, err := a.workspaceStore.Load(workspacePath)
	if err != nil {
		return err
	}
	if st == nil {
		st = &workspace.State{WorkspacePath: workspacePath}
	}
	st.LSP.InterpreterOverride = interpreterPath
	return a.workspaceStore.Save(*st)
}

// --- Search bindings ---

// SearchWorkspace runs a workspace text search via ripgrep and returns a
// typed response. Status discriminates between success, no-matches,
// missing-tool, invalid-regex, canceled, and failed states; the frontend
// renders distinct UI for each. The Wails context is passed through so the
// search aborts when the application context is canceled (window close).
// This is exposed to the frontend via Wails bindings.
func (a *App) SearchWorkspace(request search.SearchRequest) search.SearchResponse {
	if a.searchManager == nil {
		return search.SearchResponse{
			RequestID: request.RequestID,
			Status:    search.StatusFailed,
			Message:   "search service not initialized",
			Files:     []search.FileResult{},
		}
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.searchManager.Search(ctx, request)
}

// CancelSearch aborts an in-flight search by RequestID. It is a no-op when
// no search with that id is active, which is the expected state after a
// successful response was already delivered.
// This is exposed to the frontend via Wails bindings.
func (a *App) CancelSearch(requestID string) {
	if a.searchManager == nil {
		return
	}
	a.searchManager.Cancel(requestID)
}

// nowMillis returns the current time as Unix milliseconds.
func nowMillis() int64 { return time.Now().UnixMilli() }

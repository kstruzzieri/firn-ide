package main

import (
	"context"
	"firn/internal/filesystem"
	"firn/internal/lsp"
	"firn/internal/runprofile"
	"firn/internal/search"
	"firn/internal/terminal"
	"firn/internal/watcher"
	"firn/internal/workspace"
	"fmt"
	"os"
	"path/filepath"
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
	executor             *runprofile.Executor
	osFS                 filesystem.FileSystem
	workspaceStore       *workspace.Store
	lspManager           *lsp.Manager
	searchManager        *search.Manager
	closeMu              sync.Mutex
	isClosing            bool
	closeReady           chan struct{}
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
		func(profileID, stream, data string, timestamp int64) {
			runtime.EventsEmit(a.ctx, "run:output", map[string]any{
				"profileId": profileID,
				"stream":    stream,
				"data":      data,
				"timestamp": timestamp,
			})
		},
	)
	a.lspManager = lsp.NewManager(func(event string, data ...any) {
		runtime.EventsEmit(a.ctx, event, data...)
	})
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
		var profiles []runprofile.RunProfile
		if changed {
			profiles = a.profileManager.GetAllProfiles()
		}
		a.profileMu.RUnlock()

		if changed {
			runtime.EventsEmit(a.ctx, "runprofiles:changed", profiles)
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

	return a.profileManager.Load()
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

// SaveRunProfile validates and saves a run profile.
// This is exposed to the frontend via Wails bindings.
func (a *App) SaveRunProfile(profile runprofile.RunProfile) (runprofile.ValidationResult, error) {
	a.profileMu.RLock()
	defer a.profileMu.RUnlock()

	if a.profileManager == nil {
		return runprofile.ValidationResult{Valid: false, Errors: []runprofile.ValidationError{
			{Field: "workspace", Message: "no workspace loaded"},
		}}, nil
	}
	return a.profileManager.SaveProfile(profile)
}

// DeleteRunProfile removes a saved run profile by ID.
// This is exposed to the frontend via Wails bindings.
func (a *App) DeleteRunProfile(id string) error {
	a.profileMu.RLock()
	defer a.profileMu.RUnlock()

	if a.profileManager == nil {
		return fmt.Errorf("no workspace loaded")
	}
	return a.profileManager.DeleteProfile(id)
}

// PinRunProfile converts a detected profile to a saved profile and emits an update event.
// This is exposed to the frontend via Wails bindings.
func (a *App) PinRunProfile(id string) error {
	a.profileMu.RLock()
	if a.profileManager == nil {
		a.profileMu.RUnlock()
		return fmt.Errorf("no workspace loaded")
	}

	if err := a.profileManager.PinProfile(id); err != nil {
		a.profileMu.RUnlock()
		return err
	}

	// Emit updated profiles so frontend reflects the pin immediately
	profiles := a.profileManager.GetAllProfiles()
	a.profileMu.RUnlock()
	runtime.EventsEmit(a.ctx, "runprofiles:changed", profiles)
	return nil
}

// UnpinRunProfile reverts a saved (pinned) profile back to detected status.
// This is exposed to the frontend via Wails bindings.
func (a *App) UnpinRunProfile(id string) error {
	a.profileMu.RLock()
	if a.profileManager == nil {
		a.profileMu.RUnlock()
		return fmt.Errorf("no workspace loaded")
	}

	if err := a.profileManager.UnpinProfile(id); err != nil {
		a.profileMu.RUnlock()
		return err
	}

	profiles := a.profileManager.GetAllProfiles()
	a.profileMu.RUnlock()
	runtime.EventsEmit(a.ctx, "runprofiles:changed", profiles)
	return nil
}

// SetActiveVariant selects the env variant for a run profile and emits the updated profile list.
// This is exposed to the frontend via Wails bindings.
func (a *App) SetActiveVariant(profileID string, variant string) error {
	a.profileMu.RLock()
	if a.profileManager == nil {
		a.profileMu.RUnlock()
		return fmt.Errorf("no workspace loaded")
	}

	if err := a.profileManager.SetActiveVariant(profileID, variant); err != nil {
		a.profileMu.RUnlock()
		return err
	}

	profiles := a.profileManager.GetAllProfiles()
	a.profileMu.RUnlock()
	runtime.EventsEmit(a.ctx, "runprofiles:changed", profiles)
	return nil
}

// ValidateRunProfile validates a run profile without saving it.
// This is exposed to the frontend via Wails bindings.
func (a *App) ValidateRunProfile(profile runprofile.RunProfile) runprofile.ValidationResult {
	return runprofile.Validate(profile)
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

	if profile.Type == runprofile.ProfileTypeCompound {
		steps, err := runprofile.ResolveSteps(*profile, profiles)
		if err != nil {
			return err
		}
		return a.executor.StartCompound(workspaceRoot, *profile, steps)
	}

	return a.executor.Start(workspaceRoot, *profile)
}

// StopRunProfile stops a running profile (SIGTERM → 3s → SIGKILL).
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

// GetRunStatus returns the current run status of a profile.
// Returns RunStateIdle for profiles that are not running.
// This is exposed to the frontend via Wails bindings.
func (a *App) GetRunStatus(profileID string) runprofile.RunStatus {
	if a.executor == nil {
		return runprofile.RunStatus{ProfileID: profileID, State: runprofile.RunStateIdle}
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

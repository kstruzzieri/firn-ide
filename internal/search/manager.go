package search

import (
	"context"
	"errors"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Manager owns active search request lifecycles. The Wails App layer holds
// one Manager instance and delegates SearchWorkspace / CancelSearch to it.
//
// The manager is safe for concurrent use; each request gets its own context
// and goroutine, but only one record per RequestID is tracked at a time. A
// new request with the same RequestID supersedes the previous one and
// cancels it.
type Manager struct {
	cfg runnerConfig

	mu     sync.Mutex
	active map[string]*activeRun

	// statRoot is overridable for tests so we can simulate missing/non-dir
	// roots without touching the real filesystem.
	statRoot func(string) (bool, error)

	// nextToken is incremented for each registration so we can distinguish
	// older registrations from newer ones with the same RequestID without
	// relying on undefined func equality.
	nextToken atomic.Uint64
}

// activeRun is the bookkeeping entry for a single in-flight rg invocation.
type activeRun struct {
	cancel context.CancelFunc
	token  uint64
}

// NewManager constructs a Manager with production defaults.
func NewManager() *Manager {
	return &Manager{
		cfg:      defaultRunnerConfig(),
		active:   make(map[string]*activeRun),
		statRoot: defaultStatRoot,
	}
}

// defaultStatRoot reports whether p exists and is a directory using os.Stat.
// Errors are returned verbatim so the caller can surface a precise reason.
func defaultStatRoot(p string) (bool, error) {
	info, err := os.Stat(p)
	if err != nil {
		return false, err
	}
	return info.IsDir(), nil
}

// Search runs a synchronous search and returns the response when ripgrep
// completes (or is canceled, or fails). The supplied ctx is composed with
// the manager's per-request cancel function so CancelSearch(req.RequestID)
// will abort an in-flight call.
func (m *Manager) Search(ctx context.Context, req SearchRequest) SearchResponse {
	start := time.Now()
	resp := SearchResponse{
		RequestID: req.RequestID,
		Files:     []FileResult{},
		MatchCap:  m.cfg.MatchCap,
	}

	if status, msg := validateRequest(req, m.statRoot); status != StatusSuccess {
		resp.Status = status
		resp.Message = msg
		resp.DurationMs = time.Since(start).Milliseconds()
		return resp
	}

	runCtx, cancel := context.WithCancel(ctx)
	token := m.register(req.RequestID, cancel)
	defer m.unregister(req.RequestID, token)

	// Group matches by file path as we receive them. We preserve ripgrep's
	// emission order for both files and lines so the UI shows results in the
	// natural directory-walk order.
	type fileBucket struct {
		index   int
		path    string
		matches []LineMatch
	}
	buckets := make(map[string]*fileBucket)
	order := make([]*fileBucket, 0, 64)

	totalLines := 0
	collector := func(filePath string, m LineMatch) bool {
		bucket, ok := buckets[filePath]
		if !ok {
			bucket = &fileBucket{index: len(order), path: filePath}
			buckets[filePath] = bucket
			order = append(order, bucket)
		}
		bucket.matches = append(bucket.matches, m)
		totalLines++
		return true
	}

	outcome := runRipgrep(runCtx, m.cfg, req, collector)

	switch {
	case errors.Is(outcome.Err, errCanceled):
		resp.Status = StatusCanceled
		resp.Message = "search canceled"
	case errors.Is(outcome.Err, errInvalidRegex):
		resp.Status = StatusInvalidRegex
		resp.Message = outcome.Err.Error()
	case outcome.Err != nil && isMissingTool(outcome.Err):
		resp.Status = StatusMissingTool
		resp.Message = "ripgrep (rg) was not found. Install ripgrep to enable workspace search."
	case outcome.Err != nil:
		resp.Status = StatusFailed
		resp.Message = outcome.Err.Error()
	default:
		resp.Truncated = outcome.Truncated
		if totalLines == 0 {
			resp.Status = StatusNoMatches
		} else {
			resp.Status = StatusSuccess
		}
	}

	// Only successful runs (with or without matches) carry collected data.
	// Canceled or failed runs return an empty file list so consumers do not
	// display partial results that may be misleading or stale.
	if resp.Status == StatusSuccess || resp.Status == StatusNoMatches {
		sort.SliceStable(order, func(i, j int) bool { return order[i].index < order[j].index })
		files := make([]FileResult, 0, len(order))
		for _, b := range order {
			files = append(files, FileResult{
				Path:         b.path,
				RelativePath: toRelativeForwardSlash(req.Root, b.path),
				Matches:      b.matches,
			})
		}
		resp.Files = files
		resp.TotalFiles = len(files)
		resp.TotalLines = totalLines
	}
	resp.DurationMs = time.Since(start).Milliseconds()
	return resp
}

// Cancel aborts the in-flight request with the given RequestID. It is a
// no-op if no such request is active.
func (m *Manager) Cancel(requestID string) {
	m.mu.Lock()
	run, ok := m.active[requestID]
	if ok {
		delete(m.active, requestID)
	}
	m.mu.Unlock()
	if ok {
		run.cancel()
	}
}

// CancelAll aborts every in-flight request. Used during workspace teardown
// or app shutdown so no rg child processes outlive the IDE.
func (m *Manager) CancelAll() {
	m.mu.Lock()
	runs := make([]*activeRun, 0, len(m.active))
	for id, run := range m.active {
		runs = append(runs, run)
		delete(m.active, id)
	}
	m.mu.Unlock()
	for _, r := range runs {
		r.cancel()
	}
}

// register stores cancel under requestID, canceling any previous request
// that shared the id (defensive: the frontend should produce unique ids,
// but we still guarantee no stale process lingers). It returns a token used
// later by unregister to ensure the entry has not been replaced by a newer
// request that reused the same id.
func (m *Manager) register(requestID string, cancel context.CancelFunc) uint64 {
	token := m.nextToken.Add(1)
	m.mu.Lock()
	prev, hadPrev := m.active[requestID]
	m.active[requestID] = &activeRun{cancel: cancel, token: token}
	m.mu.Unlock()
	if hadPrev {
		prev.cancel()
	}
	return token
}

// unregister removes the registration for requestID only if its token still
// matches. This avoids racing with a later request that reused the id.
func (m *Manager) unregister(requestID string, token uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cur, ok := m.active[requestID]; ok && cur.token == token {
		delete(m.active, requestID)
	}
}

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"firn/internal/ai"
	"firn/internal/watcher"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

// golemMarker stands in for any credential-shaped text a raw Golem cause could
// carry. No Wails-facing string may ever contain it.
const golemMarker = "API_KEY_MARKER_sk-live-0f9a8b7c6d5e"

// golemRunID is a canonical lowercase RFC 4122 v4 UUID, the exact shape
// crypto.randomUUID produces and ai.Service accepts.
const golemRunID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"

// golemConsentDegraded is the only Remote-consent degradation notice.
const golemConsentDegraded = "Remote consent storage is unavailable."

// golemPublicMessages is the complete set of user-visible Golem failures.
// Anything else crossing the boundary is a leak or an unprojected error.
var golemPublicMessages = map[string]bool{
	"Golem configuration was not found.":     true,
	"Golem configuration is invalid.":        true,
	golemConsentDegraded:                     true,
	"The Golem request is invalid or stale.": true,
	"The Golem workspace is unavailable.":    true,
	"The Golem run failed.":                  true,
	"Golem is unavailable.":                  true,
}

// newGolemApp starts an App whose Golem service is live but deterministic:
// GO_LLM_CONFIG is pinned empty so config discovery can never reach the
// developer's real go-llm configuration.
func newGolemApp(t *testing.T) *App {
	t.Helper()
	t.Setenv("GO_LLM_CONFIG", "")
	app := NewApp()
	app.emitFn = func(string, ...any) {}
	app.startup(context.Background())
	if app.aiService == nil {
		t.Fatal("startup did not create the Golem service")
	}
	t.Cleanup(app.closeAIService)
	return app
}

// bindGolemRepo binds a fresh empty repository and returns its info.
func bindGolemRepo(t *testing.T, app *App) WorkspaceInfo {
	t.Helper()
	info, err := app.GetWorkspaceInfo(t.TempDir())
	if err != nil {
		t.Fatalf("GetWorkspaceInfo: %v", err)
	}
	return info
}

func TestGetWorkspaceInfoReturnsCanonicalRootAndRepoIdentity(t *testing.T) {
	app := newGolemApp(t)
	repo := t.TempDir()
	canonical, err := filepath.EvalSymlinks(repo)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}

	info, err := app.GetWorkspaceInfo(repo)
	if err != nil {
		t.Fatalf("GetWorkspaceInfo: %v", err)
	}
	if info.Path != canonical {
		t.Errorf("Path = %q, want the canonical root %q", info.Path, canonical)
	}
	if info.Name != filepath.Base(canonical) {
		t.Errorf("Name = %q, want %q", info.Name, filepath.Base(canonical))
	}
	if len(info.RepoKey) != 64 {
		t.Errorf("RepoKey = %q, want a 64-character SHA-256 digest", info.RepoKey)
	}
	if strings.ContainsAny(info.RepoKey, `/\`) {
		t.Errorf("RepoKey = %q, want a digest, not a path", info.RepoKey)
	}
	if info.RepoEpoch == 0 {
		t.Error("RepoEpoch = 0, want the allocated incarnation epoch")
	}
}

func TestGetWorkspaceInfoRebindKeepsEpochAndUnbindAdvancesIt(t *testing.T) {
	app := newGolemApp(t)
	repo := t.TempDir()

	first, err := app.GetWorkspaceInfo(repo)
	if err != nil {
		t.Fatalf("first bind: %v", err)
	}
	again, err := app.GetWorkspaceInfo(repo)
	if err != nil {
		t.Fatalf("repeated bind: %v", err)
	}
	if again.RepoEpoch != first.RepoEpoch {
		t.Errorf("repeated bind epoch = %d, want the unchanged %d", again.RepoEpoch, first.RepoEpoch)
	}
	if again.RepoKey != first.RepoKey {
		t.Errorf("repeated bind key = %q, want %q", again.RepoKey, first.RepoKey)
	}

	empty, err := app.GetWorkspaceInfo("")
	if err != nil {
		t.Fatalf("unbind returned an error: %v", err)
	}
	if empty != (WorkspaceInfo{}) {
		t.Errorf("unbind returned %+v, want zero values", empty)
	}

	rebound, err := app.GetWorkspaceInfo(repo)
	if err != nil {
		t.Fatalf("rebind: %v", err)
	}
	if rebound.RepoEpoch <= first.RepoEpoch {
		t.Errorf("rebind epoch = %d, want an advance past %d", rebound.RepoEpoch, first.RepoEpoch)
	}
	if rebound.RepoKey != first.RepoKey {
		t.Errorf("rebind key = %q, want the same root digest %q", rebound.RepoKey, first.RepoKey)
	}

	// The stale epoch must no longer authorize anything.
	stale, err := app.GetGolemStatus(ai.StatusRequest{RepoEpoch: first.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("stale status transport error: %v", err)
	}
	if stale.Available {
		t.Error("stale-epoch status reported Available")
	}
	if stale.InitError != "The Golem request is invalid or stale." {
		t.Errorf("stale status InitError = %q, want the stale-request message", stale.InitError)
	}
	_, err = app.RunGolemTurn(ai.TurnRequest{
		Identity: ai.RunIdentity{
			RepoEpoch:      first.RepoEpoch,
			WorkspaceID:    "project",
			ConversationID: ai.ConversationID(first.RepoKey, "project"),
			RunID:          golemRunID,
		},
		Message: "hello",
	})
	if err == nil {
		t.Fatal("stale-epoch turn was admitted")
	}
	if err.Error() != "The Golem request is invalid or stale." {
		t.Errorf("stale turn error = %q, want the stale-request message", err.Error())
	}
}

func TestGolemStatusNeverReturnsARepositoryRoot(t *testing.T) {
	app := newGolemApp(t)
	repo := t.TempDir()
	info, err := app.GetWorkspaceInfo(repo)
	if err != nil {
		t.Fatalf("GetWorkspaceInfo: %v", err)
	}

	status, err := app.GetGolemStatus(ai.StatusRequest{RepoEpoch: info.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("GetGolemStatus: %v", err)
	}
	if status.ActiveRuns == nil {
		t.Error("ActiveRuns is nil, want a non-nil slice")
	}
	if status.Identity.RepoEpoch != info.RepoEpoch || status.Identity.WorkspaceID != "project" {
		t.Errorf("Identity = %+v, want the requested epoch/workspace", status.Identity)
	}
	if want := ai.ConversationID(info.RepoKey, "project"); status.Identity.ConversationID != want {
		t.Errorf("ConversationID = %q, want the deterministic %q", status.Identity.ConversationID, want)
	}

	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal status: %v", err)
	}
	for _, forbidden := range []string{info.Path, repo, filepath.Dir(info.Path)} {
		if strings.Contains(string(encoded), forbidden) {
			t.Errorf("status JSON leaked %q: %s", forbidden, encoded)
		}
	}
}

// The three Golem methods carry ai structs verbatim and take no path or
// endpoint: a caller must not be able to redirect the repository root or the
// provider endpoint through the Wails surface.
func TestGolemMethodSignaturesCarryStructsUnchanged(t *testing.T) {
	appType := reflect.TypeOf(&App{})
	errorType := reflect.TypeOf((*error)(nil)).Elem()
	cases := []struct {
		method string
		in     reflect.Type
		out    reflect.Type
	}{
		{"GetWorkspaceInfo", reflect.TypeOf(""), reflect.TypeOf(WorkspaceInfo{})},
		{"GetGolemStatus", reflect.TypeOf(ai.StatusRequest{}), reflect.TypeOf(ai.Status{})},
		{"RunGolemTurn", reflect.TypeOf(ai.TurnRequest{}), reflect.TypeOf(ai.TurnAdmission{})},
		{"CancelGolemRun", reflect.TypeOf(ai.RunIdentity{}), reflect.TypeOf(false)},
	}
	for _, tc := range cases {
		method, ok := appType.MethodByName(tc.method)
		if !ok {
			t.Errorf("App has no method %s", tc.method)
			continue
		}
		signature := method.Type
		if signature.NumIn() != 2 || signature.In(1) != tc.in {
			t.Errorf("%s takes %v, want exactly (%v)", tc.method, signature, tc.in)
			continue
		}
		if signature.NumOut() != 2 || signature.Out(0) != tc.out || signature.Out(1) != errorType {
			t.Errorf("%s returns %v, want (%v, error)", tc.method, signature, tc.out)
		}
	}

	// Request types carry identity only. ai.Status/ai.TurnAdmission may expose
	// the resolved ProviderDestination, but nothing a caller supplies may.
	forbidden := []string{"path", "root", "dir", "endpoint", "url", "host", "key", "token"}
	for _, requestType := range []reflect.Type{
		reflect.TypeOf(ai.StatusRequest{}),
		reflect.TypeOf(ai.TurnRequest{}),
		reflect.TypeOf(ai.RunIdentity{}),
	} {
		for i := range requestType.NumField() {
			name := strings.ToLower(requestType.Field(i).Name)
			for _, bad := range forbidden {
				if strings.Contains(name, bad) {
					t.Errorf("%s.%s accepts a %s from the frontend",
						requestType.Name(), requestType.Field(i).Name, bad)
				}
			}
		}
	}
}

// Every error the four Wails methods return is a fixed public projection: no
// absolute root, no config or consent path, no credential text.
func TestGolemWailsMethodsReturnOnlyFixedPublicErrors(t *testing.T) {
	app := newGolemApp(t)
	leaky := filepath.Join(t.TempDir(), golemMarker, "no-such-repository")
	notStarted := &App{}

	cases := []struct {
		name string
		call func() error
		want string
	}{
		{
			name: "GetWorkspaceInfo on an unresolvable root",
			call: func() error { _, err := app.GetWorkspaceInfo(leaky); return err },
			want: "The Golem workspace is unavailable.",
		},
		{
			name: "GetGolemStatus before startup",
			call: func() error { _, err := notStarted.GetGolemStatus(ai.StatusRequest{}); return err },
			want: "Golem is unavailable.",
		},
		{
			name: "RunGolemTurn with no repository bound",
			call: func() error {
				_, err := app.RunGolemTurn(ai.TurnRequest{
					Identity: ai.RunIdentity{
						RepoEpoch: 99, WorkspaceID: "project",
						ConversationID: "golem-unbound", RunID: golemRunID,
					},
					Message: "hello",
				})
				return err
			},
			want: "The Golem workspace is unavailable.",
		},
		{
			name: "CancelGolemRun for an unknown run",
			call: func() error {
				_, err := app.CancelGolemRun(ai.RunIdentity{
					RepoEpoch: 99, WorkspaceID: "project",
					ConversationID: "golem-unbound", RunID: golemRunID,
				})
				return err
			},
			want: "The Golem request is invalid or stale.",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.call()
			if err == nil {
				t.Fatal("expected a rejection, got nil")
			}
			var public ai.PublicError
			if !errors.As(err, &public) {
				t.Fatalf("error type = %T, want ai.PublicError", err)
			}
			if err.Error() != tc.want {
				t.Errorf("message = %q, want %q", err.Error(), tc.want)
			}
			if !golemPublicMessages[err.Error()] {
				t.Errorf("message %q is not on the fixed public allowlist", err.Error())
			}
			assertNoGolemLeak(t, err.Error(), leaky)
			encoded, marshalErr := json.Marshal(err.Error())
			if marshalErr != nil {
				t.Fatalf("marshal error string: %v", marshalErr)
			}
			assertNoGolemLeak(t, string(encoded), leaky)
		})
	}
}

// The helper is the single seal: whatever raw cause reaches it, only the fixed
// projection leaves. The synthetic causes below exist to prove the Wails side
// is sealed, not because the app ever logs credentials on purpose.
func TestGolemErrorProjectsRawCausesToFixedMessages(t *testing.T) {
	app := &App{}
	separator := string(filepath.Separator)
	root := filepath.Join(separator, "Users", "dev", "repo")
	config := filepath.Join(root, ".config", "go-llm", "models.json")
	consent := filepath.Join(separator, "Users", "dev", ".firn", "golem-consent.json")

	cases := []struct {
		name  string
		cause error
		want  string
	}{
		{
			name:  "config missing",
			cause: fmt.Errorf("%w: reading %s (key %s)", ai.ErrAgentConfigMissing, config, golemMarker),
			want:  "Golem configuration was not found.",
		},
		{
			name:  "consent unavailable",
			cause: fmt.Errorf("%w: writing %s under %s (key %s)", ai.ErrConsentUnavailable, consent, root, golemMarker),
			want:  golemConsentDegraded,
		},
		{
			name:  "run failed",
			cause: fmt.Errorf("%w: provider call from %s failed (key %s)", ai.ErrRunFailed, root, golemMarker),
			want:  "The Golem run failed.",
		},
		{
			name:  "unrecognized cause takes the catch-all",
			cause: fmt.Errorf("dial tcp: %s rejected key %s", root, golemMarker),
			want:  "Golem is unavailable.",
		},
		{
			name:  "already public errors keep their selected message",
			cause: ai.PublicError{Code: "config_invalid", Message: "Golem configuration is invalid."},
			want:  "Golem configuration is invalid.",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := app.golemError(tc.cause)
			if got == nil {
				t.Fatal("golemError returned nil for a non-nil cause")
			}
			if got.Error() != tc.want {
				t.Errorf("message = %q, want %q", got.Error(), tc.want)
			}
			assertNoGolemLeak(t, got.Error(), root, config, consent)
			var public ai.PublicError
			if !errors.As(got, &public) {
				t.Fatalf("type = %T, want ai.PublicError", got)
			}
			// The code is a host-side classification; concatenating it into the
			// user-visible message would widen the boundary for no benefit.
			if strings.Contains(got.Error(), public.Code) {
				t.Errorf("message %q embeds the internal code %q", got.Error(), public.Code)
			}
		})
	}

	if got := app.golemError(nil); got != nil {
		t.Errorf("golemError(nil) = %v, want nil", got)
	}
}

// A missing home directory must not fall back to a relative .firn, must leave
// Local chat usable, and must report Remote consent as explicitly degraded.
func TestGolemStartupWithoutFirnDirDegradesRemoteConsent(t *testing.T) {
	t.Setenv("HOME", "")
	t.Setenv("GO_LLM_CONFIG", "")
	repo := t.TempDir()
	cwd := t.TempDir()
	t.Chdir(cwd)

	app := NewApp()
	if app.firnDir != "" {
		t.Fatalf("firnDir = %q, want empty when the home directory is unavailable", app.firnDir)
	}
	app.emitFn = func(string, ...any) {}
	app.startup(context.Background())
	t.Cleanup(app.closeAIService)

	info, err := app.GetWorkspaceInfo(repo)
	if err != nil {
		t.Fatalf("GetWorkspaceInfo: %v", err)
	}
	status, err := app.GetGolemStatus(ai.StatusRequest{RepoEpoch: info.RepoEpoch, WorkspaceID: "project"})
	if err != nil {
		t.Fatalf("GetGolemStatus: %v", err)
	}
	if !golemHasWarning(status, golemConsentDegraded) {
		t.Errorf("Warnings = %v, want the Remote consent degradation notice", status.Warnings)
	}
	if _, err := os.Stat(filepath.Join(cwd, ".firn")); !os.IsNotExist(err) {
		t.Errorf("a relative .firn was created in the process CWD: %v", err)
	}
}

// The consent store lives at exactly <firnDir>/golem-consent.json: an
// unreadably-permissioned file at that path must degrade Remote consent, and a
// clean home must not.
func TestGolemStartupUsesConsentPathUnderFirnDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("consent permission verification is POSIX-only")
	}
	t.Setenv("GO_LLM_CONFIG", "")

	poisoned := t.TempDir()
	firnDir := filepath.Join(poisoned, ".firn")
	if err := os.MkdirAll(firnDir, 0o700); err != nil {
		t.Fatalf("mkdir .firn: %v", err)
	}
	consentPath := filepath.Join(firnDir, "golem-consent.json")
	if err := os.WriteFile(consentPath, []byte(`{}`), 0o600); err != nil {
		t.Fatalf("write consent file: %v", err)
	}
	if err := os.Chmod(consentPath, 0o644); err != nil { // group/other readable: fail closed
		t.Fatalf("chmod consent file: %v", err)
	}

	for _, tc := range []struct {
		name         string
		home         string
		wantDegraded bool
	}{
		{name: "world-readable consent file at the expected path", home: poisoned, wantDegraded: true},
		{name: "clean home", home: t.TempDir(), wantDegraded: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("HOME", tc.home)
			app := NewApp()
			if want := filepath.Join(tc.home, ".firn"); app.firnDir != want {
				t.Fatalf("firnDir = %q, want %q", app.firnDir, want)
			}
			app.emitFn = func(string, ...any) {}
			app.startup(context.Background())
			t.Cleanup(app.closeAIService)

			info, err := app.GetWorkspaceInfo(t.TempDir())
			if err != nil {
				t.Fatalf("GetWorkspaceInfo: %v", err)
			}
			status, err := app.GetGolemStatus(ai.StatusRequest{RepoEpoch: info.RepoEpoch, WorkspaceID: "project"})
			if err != nil {
				t.Fatalf("GetGolemStatus: %v", err)
			}
			if got := golemHasWarning(status, golemConsentDegraded); got != tc.wantDegraded {
				t.Errorf("degraded = %v, want %v (warnings %v)", got, tc.wantDegraded, status.Warnings)
			}
		})
	}
}

// A watched policy manifest reloads in place and announces a payload-free
// status change; every other file event does neither.
func TestGolemWatchEventReloadsPolicyOnlyForWatchedManifests(t *testing.T) {
	app := newGolemApp(t)
	info := bindGolemRepo(t, app)

	type emitted struct {
		event string
		data  []any
	}
	var events []emitted
	app.emitFn = func(event string, data ...any) {
		events = append(events, emitted{event: event, data: data})
	}

	manifest := filepath.Join(info.Path, "ai-kit.yaml")
	app.handleWatchEvent(watcher.FileEvent{Path: manifest, Type: watcher.EventModified})

	if len(events) != 2 {
		t.Fatalf("manifest change emitted %d events (%+v), want file:changed then golem:status-changed",
			len(events), events)
	}
	if events[0].event != "file:changed" {
		t.Errorf("first event = %q, want file:changed emitted before the policy reload", events[0].event)
	}
	if events[1].event != "golem:status-changed" {
		t.Errorf("second event = %q, want golem:status-changed", events[1].event)
	}
	if len(events[1].data) != 0 {
		t.Errorf("golem:status-changed carried a payload %+v, want none", events[1].data)
	}

	events = nil
	app.handleWatchEvent(watcher.FileEvent{
		Path: filepath.Join(info.Path, "src", "main.go"),
		Type: watcher.EventModified,
	})
	if len(events) != 1 || events[0].event != "file:changed" {
		t.Fatalf("unrelated change emitted %+v, want only file:changed", events)
	}

	// No binding, no reload: an unbound service must not announce anything.
	if _, err := app.GetWorkspaceInfo(""); err != nil {
		t.Fatalf("unbind: %v", err)
	}
	events = nil
	app.handleWatchEvent(watcher.FileEvent{Path: manifest, Type: watcher.EventModified})
	if len(events) != 1 || events[0].event != "file:changed" {
		t.Fatalf("unbound manifest change emitted %+v, want only file:changed", events)
	}
}

func TestGolemCloseAIServiceClosesAdmissionAndToleratesNoService(t *testing.T) {
	// A nil service is the pre-startup case; closing must be a no-op.
	(&App{}).closeAIService()

	app := newGolemApp(t)
	info := bindGolemRepo(t, app)

	app.closeAIService()

	_, err := app.RunGolemTurn(ai.TurnRequest{
		Identity: ai.RunIdentity{
			RepoEpoch:      info.RepoEpoch,
			WorkspaceID:    "project",
			ConversationID: ai.ConversationID(info.RepoKey, "project"),
			RunID:          golemRunID,
		},
		Message: "hello",
	})
	if err == nil {
		t.Fatal("a closed Golem service admitted a turn")
	}
	if err.Error() != "Golem is unavailable." {
		t.Errorf("closed-service message = %q, want the catch-all", err.Error())
	}

	app.closeAIService() // idempotent
}

// beforeClose owns the shutdown fan-out, and its runtime.Quit call makes it
// unrunnable outside a live Wails app, so the concurrency shape is asserted
// structurally — the same approach the existing beforeClose contract test uses.
func TestBeforeCloseRunsAIShutdownAsAThirdConcurrentWorker(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "app.go", nil, 0)
	if err != nil {
		t.Fatalf("parse app.go: %v", err)
	}
	beforeClose := golemFuncDecl(t, file, "beforeClose")

	// Each worker is a goroutine that closes its own done channel.
	closedInGoroutines := map[string]bool{}
	ast.Inspect(beforeClose.Body, func(node ast.Node) bool {
		goStatement, ok := node.(*ast.GoStmt)
		if !ok {
			return true
		}
		ast.Inspect(goStatement.Call, func(inner ast.Node) bool {
			call, ok := inner.(*ast.CallExpr)
			if !ok || len(call.Args) != 1 {
				return true
			}
			if name, ok := call.Fun.(*ast.Ident); !ok || name.Name != "close" {
				return true
			}
			if channel, ok := call.Args[0].(*ast.Ident); ok {
				closedInGoroutines[channel.Name] = true
			}
			return true
		})
		return true
	})
	for _, worker := range []string{"runnerDone", "lspDone", "aiDone"} {
		if !closedInGoroutines[worker] {
			t.Errorf("beforeClose has no goroutine closing %s; want three concurrent shutdown workers", worker)
		}
	}

	// The AI worker runs the service shutdown, not something else.
	if !golemCallsFunction(beforeClose.Body, "closeAIService") {
		t.Error("beforeClose never calls closeAIService")
	}

	// The outer deadline stays at two seconds and drains every worker channel.
	source := golemNodeText(t, fset, beforeClose)
	if !strings.Contains(source, "2 * time.Second") {
		t.Error("beforeClose no longer bounds shutdown with the 2 s outer deadline")
	}
	for _, channel := range []string{"closeReadyCh", "runnerDoneCh", "lspDoneCh", "aiDoneCh"} {
		// Declared, tested in the loop condition, and selected on.
		if strings.Count(source, channel) < 3 {
			t.Errorf("%s is not declared, tested in the loop condition, and selected on", channel)
		}
	}

	// The AI shutdown gets its own 1500 ms budget inside that deadline.
	closeAI := golemFuncDecl(t, file, "closeAIService")
	if text := golemNodeText(t, fset, closeAI); !strings.Contains(text, "1500*time.Millisecond") &&
		!strings.Contains(text, "1500 * time.Millisecond") {
		t.Error("closeAIService does not bound ai.Service.Close with a 1500 ms context")
	}
}

func golemHasWarning(status ai.Status, want string) bool {
	for _, warning := range status.Warnings {
		if warning == want {
			return true
		}
	}
	return false
}

func golemFuncDecl(t *testing.T, file *ast.File, name string) *ast.FuncDecl {
	t.Helper()
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if ok && function.Name.Name == name {
			return function
		}
	}
	t.Fatalf("app.go has no %s function", name)
	return nil
}

func golemCallsFunction(body ast.Node, name string) bool {
	found := false
	ast.Inspect(body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch fun := call.Fun.(type) {
		case *ast.SelectorExpr:
			if fun.Sel.Name == name {
				found = true
			}
		case *ast.Ident:
			if fun.Name == name {
				found = true
			}
		}
		return true
	})
	return found
}

// golemNodeText renders node back to Go source.
func golemNodeText(t *testing.T, fset *token.FileSet, node ast.Node) string {
	t.Helper()
	var buf bytes.Buffer
	if err := printer.Fprint(&buf, fset, node); err != nil {
		t.Fatalf("print node: %v", err)
	}
	return buf.String()
}

func assertNoGolemLeak(t *testing.T, text string, forbidden ...string) {
	t.Helper()
	if strings.Contains(text, golemMarker) {
		t.Errorf("%q leaked the credential marker", text)
	}
	for _, secret := range forbidden {
		if secret != "" && strings.Contains(text, secret) {
			t.Errorf("%q leaked %q", text, secret)
		}
	}
}

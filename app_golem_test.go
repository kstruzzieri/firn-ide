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
	"log"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
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

	// The root reported back must be a fixpoint of Bind: feeding it in again
	// changes nothing, epoch included.
	again, err := app.GetWorkspaceInfo(info.Path)
	if err != nil {
		t.Fatalf("rebinding the returned root: %v", err)
	}
	if again != info {
		t.Errorf("rebinding the returned root gave %+v, want the unchanged %+v", again, info)
	}
}

// TestGetWorkspaceInfoPathIsTheServiceAuthorizedRoot pins Path to the root
// ai.Service reports having authorized, rather than to any canonicalization
// App performs for itself. Binding through a symlink separates the caller's
// input from the authorized root, and the comparison target is the service's
// own return: a rebind of the live incarnation hands back the root stored on
// the binding, so this asserts Path equals what the backend actually holds.
func TestGetWorkspaceInfoPathIsTheServiceAuthorizedRoot(t *testing.T) {
	app := newGolemApp(t)
	target := t.TempDir()
	link := filepath.Join(t.TempDir(), "repo-link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("Symlink: %v", err)
	}

	info, err := app.GetWorkspaceInfo(link)
	if err != nil {
		t.Fatalf("GetWorkspaceInfo: %v", err)
	}
	if info.Path == link {
		t.Fatalf("Path = %q, want the resolved root rather than the caller's input", link)
	}

	// Same root, so this is the same-incarnation refresh: the returned root is
	// the one recorded when GetWorkspaceInfo bound it, not a fresh derivation.
	identity, authorized, err := app.aiService.BindRepository(link)
	if err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
	if info.Path != authorized {
		t.Errorf("Path = %q, want the service-authorized root %q", info.Path, authorized)
	}
	if info.Name != filepath.Base(authorized) {
		t.Errorf("Name = %q, want %q", info.Name, filepath.Base(authorized))
	}
	if info.RepoKey != identity.RepoKey || info.RepoEpoch != identity.RepoEpoch {
		t.Errorf("identity = {%q %d}, want the service's {%q %d}",
			info.RepoKey, info.RepoEpoch, identity.RepoKey, identity.RepoEpoch)
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

// The six Golem methods — GetWorkspaceInfo plus the three that carry ai
// structs verbatim, and the two zero-input settings methods — must never let
// a caller redirect the repository root or the provider endpoint through the
// Wails surface.
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

	// The two settings methods take no input at all: nothing a caller supplies
	// can influence discovery, and the projection is the only output.
	zeroInput := []struct {
		method string
		out    reflect.Type
	}{
		{"GetGolemSettings", reflect.TypeOf(ai.SettingsProjection{})},
		{"ReloadGolemSettings", reflect.TypeOf(ai.SettingsReloadResult{})},
	}
	for _, tc := range zeroInput {
		method, ok := appType.MethodByName(tc.method)
		if !ok {
			t.Errorf("App has no method %s", tc.method)
			continue
		}
		signature := method.Type
		if signature.NumIn() != 1 {
			t.Errorf("%s takes arguments (%v); it must take none", tc.method, signature)
			continue
		}
		if signature.NumOut() != 2 || signature.Out(0) != tc.out || signature.Out(1) != errorType {
			t.Errorf("%s returns %v, want (%v, error)", tc.method, signature, tc.out)
		}
	}

	// Settings RESPONSE types may expose endpoints (like ProviderDestination)
	// but never paths, roots, keys, or tokens.
	forbiddenResponse := []string{"path", "root", "dir", "key", "token"}
	for _, responseType := range []reflect.Type{
		reflect.TypeOf(ai.SettingsProjection{}),
		reflect.TypeOf(ai.SettingsReloadResult{}),
		reflect.TypeOf(ai.RouteProjection{}),
		reflect.TypeOf(ai.ModelProjection{}),
		reflect.TypeOf(ai.ProviderProjection{}),
		reflect.TypeOf(ai.Diagnostic{}),
	} {
		for i := range responseType.NumField() {
			name := strings.ToLower(responseType.Field(i).Name)
			for _, bad := range forbiddenResponse {
				if strings.Contains(name, bad) {
					t.Errorf("%s.%s would carry a %s across the settings boundary",
						responseType.Name(), responseType.Field(i).Name, bad)
				}
			}
		}
	}
}

// The two settings methods share the same pre-startup guard as the other
// Golem-bound methods: no service means the fixed unavailable projection, not
// a nil-pointer panic.
func TestGolemSettingsMethodsUninitializedService(t *testing.T) {
	app := &App{}
	if _, err := app.GetGolemSettings(); err == nil || err.Error() != "Golem is unavailable." {
		t.Fatalf("GetGolemSettings uninitialized = %v", err)
	}
	if _, err := app.ReloadGolemSettings(); err == nil || err.Error() != "Golem is unavailable." {
		t.Fatalf("ReloadGolemSettings uninitialized = %v", err)
	}
}

// Every error each of these four struct-carrying Wails methods returns is a
// fixed public projection: no absolute root, no config or consent path, no
// credential text. The two zero-input settings methods carry the same
// guarantee, checked separately above and by the golemError-routing tests
// below.
func TestGolemWailsMethodsReturnOnlyFixedPublicErrors(t *testing.T) {
	app := newGolemApp(t)
	leaky := filepath.Join(t.TempDir(), golemMarker, "no-such-repository")
	notStarted := &App{}

	// A second app bound to a live root whose canonical path carries the
	// marker. The unbound cases below cannot leak a root that does not exist;
	// these can, so the stale-request projections are checked against one.
	markerApp := newGolemApp(t)
	markerRoot := filepath.Join(t.TempDir(), golemMarker)
	if err := os.Mkdir(markerRoot, 0o700); err != nil {
		t.Fatalf("mkdir marker root: %v", err)
	}
	bound, err := markerApp.GetWorkspaceInfo(markerRoot)
	if err != nil {
		t.Fatalf("bind marker root: %v", err)
	}
	if !strings.Contains(bound.Path, golemMarker) {
		t.Fatalf("bound root %q lost the marker; the leak assertions would be vacuous", bound.Path)
	}
	staleEpoch := bound.RepoEpoch + 1
	staleIdentity := ai.RunIdentity{
		RepoEpoch:      staleEpoch,
		WorkspaceID:    "project",
		ConversationID: ai.ConversationID(bound.RepoKey, "project"),
		RunID:          golemRunID,
	}

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
		{
			name: "RunGolemTurn against a stale epoch of a marker-bearing root",
			call: func() error {
				_, err := markerApp.RunGolemTurn(ai.TurnRequest{Identity: staleIdentity, Message: "hello"})
				return err
			},
			want: "The Golem request is invalid or stale.",
		},
		{
			name: "CancelGolemRun against a stale epoch of a marker-bearing root",
			call: func() error {
				_, err := markerApp.CancelGolemRun(staleIdentity)
				return err
			},
			want: "The Golem request is invalid or stale.",
		},
		{
			name: "GetWorkspaceInfo on an unresolvable child of a marker-bearing root",
			call: func() error {
				_, err := markerApp.GetWorkspaceInfo(filepath.Join(bound.Path, "no-such-child"))
				return err
			},
			want: "The Golem workspace is unavailable.",
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
			assertNoGolemLeak(t, err.Error(), leaky, bound.Path)
			encoded, marshalErr := json.Marshal(err.Error())
			if marshalErr != nil {
				t.Fatalf("marshal error string: %v", marshalErr)
			}
			assertNoGolemLeak(t, string(encoded), leaky, bound.Path)
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

// Every error result of the Wails Golem methods is a golemError call. Three of
// them receive only already-projected ai errors today, so returning one raw
// would change no message — the seal would simply be gone the first time an
// App-constructed cause appeared. This pins it structurally, including the
// branch that no reachable input exercises. The method list is derived from
// the source, so every aiService-touching method is covered the day it is
// written — six today, more tomorrow.
func TestGolemWailsMethodsReturnErrorsOnlyThroughGolemError(t *testing.T) {
	fset, files := golemPackageFiles(t)

	methods := golemWailsMethods(files)
	// The plan freezes six bound Golem methods today (the four struct-carrying
	// methods plus the two zero-input settings methods). The floor stays at 4:
	// fewer than that means the derivation itself broke, and everything below
	// it would pass vacuously.
	if len(methods) < 4 {
		t.Fatalf("derived %d exported App methods using the Golem service (%v), want at least 4 (six expected today)",
			len(methods), golemSortedNames(methods))
	}

	for _, name := range golemSortedNames(methods) {
		sealed := 0
		ast.Inspect(methods[name].Body, func(node ast.Node) bool {
			ret, ok := node.(*ast.ReturnStmt)
			if !ok || len(ret.Results) == 0 {
				return true
			}
			last := ret.Results[len(ret.Results)-1]
			if identifier, ok := last.(*ast.Ident); ok && identifier.Name == "nil" {
				return true
			}
			if call, ok := last.(*ast.CallExpr); ok {
				if selector, ok := call.Fun.(*ast.SelectorExpr); ok && selector.Sel.Name == "golemError" {
					sealed++
					return true
				}
			}
			t.Errorf("%s returns %s as its error result; every error must pass through golemError",
				name, golemNodeText(t, fset, last))
			return true
		})
		// Counting golemError returns specifically, not returns in general:
		// deleting a method's error path outright would still leave returns
		// behind, and the floor is meant to mean "this method still routes its
		// errors through the seal".
		if sealed == 0 {
			t.Errorf("%s routes no error through golemError; the seal is gone from it", name)
		}
	}
}

// golemError is the only host-side record of a raw Golem cause: the raw text —
// credential marker and all — reaches the log, and only the fixed projection is
// returned. A method returning its error without the helper loses the log line.
func TestGolemWailsMethodsHostLogRawCausesWithoutReturningThem(t *testing.T) {
	app := newGolemApp(t)
	leaky := filepath.Join(t.TempDir(), golemMarker, "no-such-repository")
	notStarted := &App{}
	unknownRun := ai.RunIdentity{
		RepoEpoch: 99, WorkspaceID: "project",
		ConversationID: "golem-unbound", RunID: golemRunID,
	}

	for _, tc := range []struct {
		name string
		call func() error
		// wantRaw is raw cause text that must reach the host log, if the cause
		// carries any; the projection returned to the UI must never contain it.
		wantRaw string
	}{
		{
			name:    "GetWorkspaceInfo",
			call:    func() error { _, err := app.GetWorkspaceInfo(leaky); return err },
			wantRaw: golemMarker,
		},
		{
			name: "GetGolemStatus",
			call: func() error { _, err := notStarted.GetGolemStatus(ai.StatusRequest{}); return err },
		},
		{
			name: "RunGolemTurn",
			call: func() error {
				_, err := app.RunGolemTurn(ai.TurnRequest{Identity: unknownRun, Message: "hello"})
				return err
			},
		},
		{
			name: "CancelGolemRun",
			call: func() error { _, err := app.CancelGolemRun(unknownRun); return err },
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logged := captureGolemLog(t)
			err := tc.call()
			if err == nil {
				t.Fatal("expected a rejection, got nil")
			}
			if !strings.Contains(logged(), golemLogPrefix) {
				t.Errorf("host log %q carries no %q line: the error never passed through golemError",
					logged(), golemLogPrefix)
			}
			if tc.wantRaw != "" && !strings.Contains(logged(), tc.wantRaw) {
				t.Errorf("host log %q dropped the raw cause %q", logged(), tc.wantRaw)
			}
			if !golemPublicMessages[err.Error()] {
				t.Errorf("message %q is not on the fixed public allowlist", err.Error())
			}
			assertNoGolemLeak(t, err.Error(), leaky)
		})
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
	// Nothing at all lands in the process CWD. Naming the artifacts instead
	// would miss most of them: without the firnDir guard the consent path is
	// the bare relative "golem-consent.json", so the hazard is a file beside
	// the working directory rather than a .firn under it.
	entries, err := os.ReadDir(cwd)
	if err != nil {
		t.Fatalf("read CWD: %v", err)
	}
	if len(entries) != 0 {
		names := make([]string, 0, len(entries))
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Errorf("startup wrote %v into the process CWD, want nothing", names)
	}
}

// The consent store lives at exactly <firnDir>/golem-consent.json: an unusable
// file at that path must degrade Remote consent, and a clean home must not.
func TestGolemStartupUsesConsentPathUnderFirnDir(t *testing.T) {
	t.Setenv("GO_LLM_CONFIG", "")

	poisoned := t.TempDir()
	firnDir := filepath.Join(poisoned, ".firn")
	if err := os.MkdirAll(firnDir, 0o700); err != nil {
		t.Fatalf("mkdir .firn: %v", err)
	}
	// Invalid content fails the store closed on every OS, so the exact filename
	// stays pinned on Windows too, where mode-bit poisoning would not apply.
	consentPath := filepath.Join(firnDir, "golem-consent.json")
	if err := os.WriteFile(consentPath, []byte(`{"version":`), 0o600); err != nil {
		t.Fatalf("write consent file: %v", err)
	}

	for _, tc := range []struct {
		name         string
		home         string
		wantDegraded bool
	}{
		{name: "unreadable consent state at the expected path", home: poisoned, wantDegraded: true},
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

	sink := &golemEventSink{}
	app.emitFn = sink.emit

	manifest := filepath.Join(info.Path, "ai-kit.yaml")
	app.handleWatchEvent(watcher.FileEvent{Path: manifest, Type: watcher.EventModified})

	events := sink.drain()
	if len(events) != 2 {
		t.Fatalf("manifest change emitted %d events (%+v), want file:changed then golem:status-changed",
			len(events), events)
	}
	if events[0].event != "file:changed" {
		t.Errorf("first event = %q, want file:changed emitted before the policy reload", events[0].event)
	}
	if events[1].event != ai.EventGolemStatusChanged {
		t.Errorf("second event = %q, want %q", events[1].event, ai.EventGolemStatusChanged)
	}
	if len(events[1].data) != 0 {
		t.Errorf("%s carried a payload %+v, want none", ai.EventGolemStatusChanged, events[1].data)
	}

	app.handleWatchEvent(watcher.FileEvent{
		Path: filepath.Join(info.Path, "src", "main.go"),
		Type: watcher.EventModified,
	})
	if events = sink.drain(); len(events) != 1 || events[0].event != "file:changed" {
		t.Fatalf("unrelated change emitted %+v, want only file:changed", events)
	}

	// No binding, no reload: an unbound service must not announce anything.
	if _, err := app.GetWorkspaceInfo(""); err != nil {
		t.Fatalf("unbind: %v", err)
	}
	sink.drain()
	app.handleWatchEvent(watcher.FileEvent{Path: manifest, Type: watcher.EventModified})
	if events = sink.drain(); len(events) != 1 || events[0].event != "file:changed" {
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
	fset, files := golemPackageFiles(t)
	beforeClose := golemFuncDecl(t, files, "beforeClose")

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
	closeAI := golemFuncDecl(t, files, "closeAIService")
	if text := golemNodeText(t, fset, closeAI); !strings.Contains(text, "1500*time.Millisecond") &&
		!strings.Contains(text, "1500 * time.Millisecond") {
		t.Error("closeAIService does not bound ai.Service.Close with a 1500 ms context")
	}
}

// captureGolemLog redirects the standard logger for the rest of the test and
// returns an accessor for everything written to it.
func captureGolemLog(t *testing.T) func() string {
	t.Helper()
	sink := &golemLogSink{}
	previous := log.Writer()
	log.SetOutput(sink)
	t.Cleanup(func() { log.SetOutput(previous) })
	return sink.String
}

// golemLogSink is readable while service goroutines are still logging.
type golemLogSink struct {
	mu    sync.Mutex
	lines bytes.Buffer
}

func (s *golemLogSink) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lines.Write(p)
}

func (s *golemLogSink) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lines.String()
}

// golemEventSink records emit calls. ai.Service is handed App.emit at startup
// and calls it from run goroutines, so the recorder a test installs must be
// safe to append to and read concurrently even when this particular test
// starts no runs.
type golemEventSink struct {
	mu     sync.Mutex
	events []golemEmitted
}

type golemEmitted struct {
	event string
	data  []any
}

func (s *golemEventSink) emit(event string, data ...any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, golemEmitted{event: event, data: data})
}

// drain returns everything recorded since the last drain and resets the sink.
func (s *golemEventSink) drain() []golemEmitted {
	s.mu.Lock()
	defer s.mu.Unlock()
	recorded := s.events
	s.events = nil
	return recorded
}

func golemHasWarning(status ai.Status, want string) bool {
	for _, warning := range status.Warnings {
		if warning == want {
			return true
		}
	}
	return false
}

// golemPackageFiles parses every non-test source file in the package. Scanning
// the package rather than app.go by name keeps splitting app.go a free choice:
// the contracts below follow the declarations wherever they move.
func golemPackageFiles(t *testing.T) (*token.FileSet, []*ast.File) {
	t.Helper()
	paths, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob package sources: %v", err)
	}
	fset := token.NewFileSet()
	var files []*ast.File
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		files = append(files, parsed)
	}
	if len(files) == 0 {
		t.Fatal("no non-test sources found in the package directory")
	}
	return fset, files
}

func golemFuncDecl(t *testing.T, files []*ast.File, name string) *ast.FuncDecl {
	t.Helper()
	for _, file := range files {
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if ok && function.Name.Name == name {
				return function
			}
		}
	}
	t.Fatalf("the package has no %s function", name)
	return nil
}

// golemWailsMethods returns the exported App methods that reach the Golem
// service, keyed by name — the set that crosses the Wails boundary carrying
// ai errors.
func golemWailsMethods(files []*ast.File) map[string]*ast.FuncDecl {
	found := map[string]*ast.FuncDecl{}
	for _, file := range files {
		for _, declaration := range file.Decls {
			method, ok := declaration.(*ast.FuncDecl)
			if !ok || method.Recv == nil || method.Body == nil || !method.Name.IsExported() {
				continue
			}
			ast.Inspect(method.Body, func(node ast.Node) bool {
				if selector, ok := node.(*ast.SelectorExpr); ok && selector.Sel.Name == "aiService" {
					found[method.Name.Name] = method
				}
				return true
			})
		}
	}
	return found
}

func golemSortedNames(methods map[string]*ast.FuncDecl) []string {
	names := make([]string, 0, len(methods))
	for name := range methods {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
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

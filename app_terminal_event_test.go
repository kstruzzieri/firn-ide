package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// TestAppEmitIsNotVariadic and TestAppEmitFnIsNotVariadic make the "emit is a
// single-payload call, compiler-enforced" claim self-verifying: if (*App).emit
// or the App.emitFn field ever regains a variadic ...any parameter, these
// fail directly via reflection, without relying on the AST guard below to
// notice the drift.
func TestAppEmitIsNotVariadic(t *testing.T) {
	t.Parallel()

	got := reflect.TypeOf((*App).emit).IsVariadic()
	if got {
		t.Errorf("reflect.TypeOf((*App).emit).IsVariadic() = %t, want false", got)
	}
}

func TestAppEmitFnIsNotVariadic(t *testing.T) {
	t.Parallel()

	field, ok := reflect.TypeOf(App{}).FieldByName("emitFn")
	if !ok {
		t.Fatal("reflect.TypeOf(App{}).FieldByName(\"emitFn\") not found")
	}
	if field.Type.IsVariadic() {
		t.Error("App.emitFn is variadic, want fixed func(string, any)")
	}
}

func TestEmitTerminalOutputSinglePayload(t *testing.T) {
	a := NewApp()
	var gotEvent string
	var gotData any
	a.emitFn = func(event string, data any) {
		gotEvent = event
		gotData = data
	}

	a.emitTerminalOutput("term-1", "hello")

	if gotEvent != "terminal:output" {
		t.Fatalf("event = %q, want terminal:output", gotEvent)
	}
	ev, ok := gotData.(TerminalOutputEvent)
	if !ok {
		t.Fatalf("payload type = %T, want TerminalOutputEvent", gotData)
	}
	if ev.TermID != "term-1" || ev.Data != "hello" {
		t.Fatalf("payload = %+v", ev)
	}

	b, err := json.Marshal(gotData)
	if err != nil || string(b) != `{"termId":"term-1","data":"hello"}` {
		t.Fatalf("wire shape = %s (err %v), want exact keys termId/data - Terminal.tsx depends on them", b, err)
	}
}

// The functions below enforce a single choke point for Wails event emission:
// only (*App).emit in root app.go may reach the v3 event bus. v3 emits through
// a value (app.Event.Emit), not a package function, so the guard keys on the
// selector chain ending in .Event.Emit rather than on an import alias: the
// seam's own a.v3app.Event.Emit, an application.Get().Event.Emit anywhere else,
// and a stored method value are all recognized the same way, whatever the file
// called its import. That also retires the v2 dot-import rule - a dot-import of
// the application package cannot produce an emission that does not end in
// .Event.Emit, so it needs no rule of its own.
//
// The scan is anti-vacuous: TestOnlyAppEmitReferencesWailsEventsEmit fails
// if it finds zero allowed references (its `allowed == 0` check), so renaming
// or moving the seam, or breaking its fixed shape, fails loudly instead of
// silently disabling the guard.
const wailsApplicationImportPath = "github.com/wailsapp/wails/v3/pkg/application"

var eventEmitScanSkipDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"frontend":     true,
	".claude":      true,
	".superpowers": true,
	"testdata":     true,
}

const eventEmitScanRoot = "."

func isAppEmitSeam(path string, fn *ast.FuncDecl) bool {
	if filepath.Clean(path) != "app.go" || fn.Name.Name != "emit" || fn.Recv == nil || len(fn.Recv.List) != 1 {
		return false
	}
	ptr, ok := fn.Recv.List[0].Type.(*ast.StarExpr)
	if !ok {
		return false
	}
	receiver, ok := ptr.X.(*ast.Ident)
	return ok && receiver.Name == "App"
}

// eventBusEmitSelector reports whether expr is an `<anything>.Event.Emit`
// selector - the only shape a v3 event emission can take, whatever holds the
// application value it is reached through.
func eventBusEmitSelector(expr ast.Expr) (*ast.SelectorExpr, bool) {
	sel, ok := expr.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Emit" {
		return nil, false
	}
	bus, ok := sel.X.(*ast.SelectorExpr)
	return sel, ok && bus.Sel.Name == "Event"
}

// validAppEmitCall reports whether call is the fixed-shape
// a.v3app.Event.Emit(event) or a.v3app.Event.Emit(event, data) invocation the
// seam is allowed to make, and if not, a reason naming the specific defect.
// The bus must be the app's own v3 handle rather than one fetched from
// somewhere else, and every argument must be the exact identifier emit's own
// signature received - so the payload in particular cannot be a literal nil:
// that would let the seam smuggle a hardcoded no-payload emission in place of
// actually forwarding the caller's data.
func validAppEmitCall(sel *ast.SelectorExpr, call *ast.CallExpr) (bool, string) {
	if call.Ellipsis.IsValid() {
		return false, "must not spread its arguments with ellipsis"
	}
	// sel matched eventBusEmitSelector, so sel.X is the `<host>.Event` selector;
	// the host below must in turn be the a.v3app field.
	bus := sel.X.(*ast.SelectorExpr)
	host, hostOK := bus.X.(*ast.SelectorExpr)
	if !hostOK {
		return false, "must emit through a.v3app.Event"
	}
	receiver, receiverOK := host.X.(*ast.Ident)
	if !receiverOK || receiver.Name != "a" || host.Sel.Name != "v3app" {
		return false, "must emit through a.v3app.Event"
	}
	if len(call.Args) != 1 && len(call.Args) != 2 {
		return false, "must be a fixed 1- or 2-argument call"
	}
	event, eventOK := call.Args[0].(*ast.Ident)
	if !eventOK || event.Name != "event" {
		return false, "first argument must be the forwarded event identifier"
	}
	if len(call.Args) == 1 {
		return true, ""
	}
	data, ok := call.Args[1].(*ast.Ident)
	if !ok || data.Name != "data" {
		return false, "second argument must be the forwarded data identifier, not a literal"
	}
	return true, ""
}

func scanWailsEventsEmitFile(fset *token.FileSet, path string, file *ast.File) (int, []string) {
	var violations []string

	var seam *ast.BlockStmt
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Body != nil && isAppEmitSeam(path, fn) {
			seam = fn.Body
			break
		}
	}

	seamCalls := make(map[*ast.SelectorExpr]bool)
	shapes := make(map[int]int)
	if seam != nil {
		ast.Inspect(seam, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := eventBusEmitSelector(call.Fun)
			if !ok {
				return true
			}
			valid, reason := validAppEmitCall(sel, call)
			seamCalls[sel] = valid
			if valid {
				shapes[len(call.Args)]++
			} else {
				pos := fset.Position(call.Pos())
				violations = append(violations, fmt.Sprintf("%s:%d: Event.Emit in (*App).emit %s", pos.Filename, pos.Line, reason))
			}
			return true
		})
		if shapes[1] != 1 || shapes[2] != 1 {
			violations = append(violations, fmt.Sprintf("%s: (*App).emit must contain exactly one payload-free and one single-payload a.v3app.Event.Emit call", path))
		}
	}

	allowed := 0
	ast.Inspect(file, func(node ast.Node) bool {
		sel, ok := node.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		_, isEventBusEmit := eventBusEmitSelector(sel)
		if !isEventBusEmit {
			return true
		}
		if seam != nil && seam.Pos() <= sel.Pos() && sel.End() <= seam.End() {
			if valid, directCall := seamCalls[sel]; directCall {
				if valid {
					allowed++
				}
				return true
			}
			pos := fset.Position(sel.Pos())
			violations = append(violations, fmt.Sprintf("%s:%d: Event.Emit in (*App).emit must be called directly", pos.Filename, pos.Line))
			return true
		}
		pos := fset.Position(sel.Pos())
		violations = append(violations, fmt.Sprintf("%s:%d: Event.Emit referenced outside (*App).emit", pos.Filename, pos.Line))
		return true
	})
	return allowed, violations
}

// The v3 bus is reached through a value, so no import name identifies it: a
// file that aliases the application package and one that emits through the
// App's own field must both be caught outside the seam, and a stored method
// value counts as an emission just like a direct call.
func TestWailsEventsEmitGuardDetectsEmitOutsideTheSeam(t *testing.T) {
	t.Parallel()

	bypasses := map[string]string{
		"aliased package call": `func bypass() { wailsapp.Get().Event.Emit("terminal:output") }`,
		"stored method value":  `func bypass(a *App) { send := a.v3app.Event.Emit; _ = send }`,
	}

	for name, body := range bypasses {
		t.Run(name, func(t *testing.T) {
			source := "package main\nimport wailsapp \"" + wailsApplicationImportPath + "\"\n" + body
			fset := token.NewFileSet()
			file, err := parser.ParseFile(fset, "bypass.go", source, 0)
			if err != nil {
				t.Fatalf("parser.ParseFile(bypass fixture) error = %v, want nil", err)
			}
			_, violations := scanWailsEventsEmitFile(fset, "bypass.go", file)
			if len(violations) != 1 {
				t.Errorf("len(scanWailsEventsEmitFile(bypass fixture).violations) = %d, want 1", len(violations))
			}
		})
	}
}

func TestWailsEventsEmitGuardRejectsInvalidSeamReferences(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"method value":   `func (a *App) emit(event string, data any) { send := a.v3app.Event.Emit; _ = send }`,
		"extra argument": `func (a *App) emit(event string, data any) { a.v3app.Event.Emit(event, data, data) }`,
		"ellipsis":       `func (a *App) emit(event string, data any) { args := []any{data}; a.v3app.Event.Emit(event, args...) }`,
		"nil payload": `func (a *App) emit(event string, data any) {
			if data == nil { a.v3app.Event.Emit(event); return }
			a.v3app.Event.Emit(event, nil)
		}`,
		"foreign bus": `func (a *App) emit(event string, data any) {
			if data == nil { application.Get().Event.Emit(event); return }
			application.Get().Event.Emit(event, data)
		}`,
	}

	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			source := "package main\nimport \"" + wailsApplicationImportPath + "\"\n" + body
			fset := token.NewFileSet()
			file, err := parser.ParseFile(fset, "app.go", source, 0)
			if err != nil {
				t.Fatalf("parser.ParseFile(invalid seam fixture) error = %v, want nil", err)
			}
			_, violations := scanWailsEventsEmitFile(fset, "app.go", file)
			if len(violations) == 0 {
				t.Error("scanWailsEventsEmitFile(invalid seam fixture) returned no violations")
			}
		})
	}
}

func TestOnlyAppEmitReferencesWailsEventsEmit(t *testing.T) {
	t.Parallel()

	fset := token.NewFileSet()
	allowed := 0
	var violations []string

	err := filepath.WalkDir(eventEmitScanRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if eventEmitScanSkipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			violations = append(violations, fmt.Sprintf("%s: parse error: %v", path, err))
			return nil
		}
		fileAllowed, fileViolations := scanWailsEventsEmitFile(fset, path, file)
		allowed += fileAllowed
		violations = append(violations, fileViolations...)
		return nil
	})
	if err != nil {
		t.Fatalf("walk repository for production .go files: %v", err)
	}

	if allowed == 0 {
		violations = append(violations, "guard found no a.v3app.Event.Emit reference inside (*App).emit")
	}
	if len(violations) > 0 {
		t.Fatalf("direct Wails event-emission violations:\n%s", strings.Join(violations, "\n"))
	}
}

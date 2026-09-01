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
	"strconv"
	"strings"
	"testing"
)

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

const wailsRuntimeImportPath = "github.com/wailsapp/wails/v2/pkg/runtime"

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

func wailsEventsEmitSelector(expr ast.Expr, aliases map[string]bool) (*ast.SelectorExpr, bool) {
	sel, ok := expr.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "EventsEmit" {
		return nil, false
	}
	pkg, ok := sel.X.(*ast.Ident)
	return sel, ok && aliases[pkg.Name] && pkg.Obj == nil
}

func validAppEmitCall(call *ast.CallExpr) bool {
	if call.Ellipsis.IsValid() || (len(call.Args) != 2 && len(call.Args) != 3) {
		return false
	}
	ctx, ok := call.Args[0].(*ast.SelectorExpr)
	if !ok {
		return false
	}
	receiver, receiverOK := ctx.X.(*ast.Ident)
	event, eventOK := call.Args[1].(*ast.Ident)
	if !receiverOK || receiver.Name != "a" || ctx.Sel.Name != "ctx" || !eventOK || event.Name != "event" {
		return false
	}
	if len(call.Args) == 2 {
		return true
	}
	data, ok := call.Args[2].(*ast.Ident)
	return ok && data.Name == "data"
}

func scanWailsEventsEmitFile(fset *token.FileSet, path string, file *ast.File) (int, []string) {
	aliases := map[string]bool{}
	var violations []string
	for _, spec := range file.Imports {
		importPath, err := strconv.Unquote(spec.Path.Value)
		if err != nil || importPath != wailsRuntimeImportPath {
			continue
		}
		name := "runtime"
		if spec.Name != nil {
			name = spec.Name.Name
		}
		if name == "." {
			pos := fset.Position(spec.Pos())
			violations = append(violations, fmt.Sprintf("%s:%d: dot-import of Wails runtime bypasses App.emit", pos.Filename, pos.Line))
			continue
		}
		if name != "_" {
			aliases[name] = true
		}
	}

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
			sel, ok := wailsEventsEmitSelector(call.Fun, aliases)
			if !ok {
				return true
			}
			valid := validAppEmitCall(call)
			seamCalls[sel] = valid
			if valid {
				shapes[len(call.Args)]++
			} else {
				pos := fset.Position(call.Pos())
				violations = append(violations, fmt.Sprintf("%s:%d: runtime.EventsEmit in (*App).emit must be a fixed 2- or 3-argument call", pos.Filename, pos.Line))
			}
			return true
		})
		if shapes[2] != 1 || shapes[3] != 1 {
			violations = append(violations, fmt.Sprintf("%s: (*App).emit must contain exactly one payload-free and one single-payload runtime.EventsEmit call", path))
		}
	}

	allowed := 0
	ast.Inspect(file, func(node ast.Node) bool {
		sel, ok := node.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		_, isWailsEventsEmit := wailsEventsEmitSelector(sel, aliases)
		if !isWailsEventsEmit {
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
			violations = append(violations, fmt.Sprintf("%s:%d: runtime.EventsEmit in (*App).emit must be called directly", pos.Filename, pos.Line))
			return true
		}
		pos := fset.Position(sel.Pos())
		violations = append(violations, fmt.Sprintf("%s:%d: runtime.EventsEmit referenced outside (*App).emit", pos.Filename, pos.Line))
		return true
	})
	return allowed, violations
}

func TestWailsEventsEmitGuardRejectsAlias(t *testing.T) {
	t.Parallel()

	const source = `package main
import wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
func bypass() { send := wailsruntime.EventsEmit; _ = send }
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "bypass.go", source, 0)
	if err != nil {
		t.Fatalf("parser.ParseFile(alias fixture) error = %v, want nil", err)
	}
	_, violations := scanWailsEventsEmitFile(fset, "bypass.go", file)
	if len(violations) != 1 {
		t.Errorf("len(scanWailsEventsEmitFile(alias fixture).violations) = %d, want 1", len(violations))
	}
}

func TestWailsEventsEmitGuardRejectsInvalidSeamReferences(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"method value":   `func (a *App) emit(event string, data any) { send := runtime.EventsEmit; _ = send }`,
		"extra argument": `func (a *App) emit(event string, data any) { runtime.EventsEmit(a.ctx, event, data, data) }`,
		"ellipsis":       `func (a *App) emit(event string, data any) { args := []any{data}; runtime.EventsEmit(a.ctx, event, args...) }`,
		"nil payload": `func (a *App) emit(event string, data any) {
			if data == nil { runtime.EventsEmit(a.ctx, event); return }
			runtime.EventsEmit(a.ctx, event, nil)
		}`,
	}

	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			source := "package main\nimport \"" + wailsRuntimeImportPath + "\"\n" + body
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
		violations = append(violations, "guard found no runtime.EventsEmit reference inside (*App).emit")
	}
	if len(violations) > 0 {
		t.Fatalf("direct Wails event-emission violations:\n%s", strings.Join(violations, "\n"))
	}
}

package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

func TestEmitTerminalOutputSinglePayload(t *testing.T) {
	a := NewApp()
	var gotEvent string
	var gotData []any
	a.emitFn = func(event string, data ...any) {
		gotEvent = event
		gotData = data
	}

	a.emitTerminalOutput("term-1", "hello")

	if gotEvent != "terminal:output" {
		t.Fatalf("event = %q, want terminal:output", gotEvent)
	}
	if len(gotData) != 1 {
		t.Fatalf("payload count = %d, want 1 (single-payload contract)", len(gotData))
	}
	ev, ok := gotData[0].(TerminalOutputEvent)
	if !ok {
		t.Fatalf("payload type = %T, want TerminalOutputEvent", gotData[0])
	}
	if ev.TermID != "term-1" || ev.Data != "hello" {
		t.Fatalf("payload = %+v", ev)
	}
}

// emitTarget names one tracked emit-shaped call: the selector method/function
// name to match, the category its hits are counted under, and how many
// leading (non-payload) arguments precede the payload — 2 for
// runtime.EventsEmit(ctx, event, data...), 1 for every event(data...)-shaped
// wrapper (App.emit, the internal producer emitters).
type emitTarget struct {
	category    string
	leadingArgs int
}

// eventEmitTargets is the fixed set of call shapes the guard tracks across
// every production (non-test) Go file in the repo. It is intentionally a
// closed list naming Firn's current event-emission identifiers — see
// TestProductionEventEmitSitesUseAtMostOnePayload's doc comment for why a
// symbol rename must touch this list, not silently pass it.
var eventEmitTargets = map[string]emitTarget{
	"EventsEmit": {category: "EventsEmit", leadingArgs: 2}, // runtime.EventsEmit(ctx, event, data...)
	"emit":       {category: "emit", leadingArgs: 1},       // App.emit / ai.Service.emit / menu app.emit(...)
	"emitFn":     {category: "emitFn", leadingArgs: 1},     // runprofile.Executor.emitFn(...)
	"emitter":    {category: "emitter", leadingArgs: 1},    // lsp.Manager.emitter(...)
}

// eventEmitScanSkipDirs excludes trees that hold no production Go source (or,
// for .git, nothing parseable at all) so the walk stays fast.
var eventEmitScanSkipDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"frontend":     true,
	".claude":      true,
	".superpowers": true,
}

// TestProductionEventEmitSitesUseAtMostOnePayload is a static guard over
// Firn's event-emission topology (#273 Task 4): every production Go call
// shaped like an event emit — runtime.EventsEmit, App.emit, and the internal
// producer wrappers (runprofile.Executor.emitFn, lsp.Manager.emitter,
// ai.Service.emit) — must carry at most one payload argument and must never
// forward a slice via "...". EventsEmit carries a stronger rule: it may only
// ever be called from inside App.emit itself (app.go's (a *App) emit
// method) — any other call, of any arity, is the seam being bypassed. That
// one call inside App.emit is the sole exempt call site in the whole guard;
// everything else it matches is checked.
//
// Method-value wiring such as runprofile.NewExecutor(a.emit, ...) is exempt
// by construction: a bare "a.emit" passed as an argument is an *ast.SelectorExpr,
// never wrapped in the *ast.CallExpr this guard inspects.
//
// This is an explicit guard over Firn's current event topology, not a proof
// over arbitrary dynamically-constructed call data. To keep it from going
// vacuous when a symbol here is renamed (Phase B's v3 event bridge is
// expected to touch these), the test also asserts anti-vacuity per category:
//   - emit/emitFn/emitter must each have matched at least one call site
//     OUTSIDE App.emit's exempt body — the real external producers
//     (runprofile.Executor.emitFn, lsp.Manager.emitter, ai.Service.emit, the
//     App/main.go event calls). Counting App.emit's own internal calls here
//     would keep these green even if the external producer's identifier
//     changed, since App.emit's body would still match by coincidence — the
//     exact failure mode this check exists to catch.
//   - EventsEmit has no external producer to count non-exemptly (only
//     App.emit may call it at all, by design), so its anti-vacuity instead
//     confirms the one exempt call inside App.emit was actually found — a
//     rename there zeroes it out and fails loudly too.
const eventEmitScanRoot = "."

func TestProductionEventEmitSitesUseAtMostOnePayload(t *testing.T) {
	fset := token.NewFileSet()
	var violations []string
	nonExemptCounts := map[string]int{}
	exemptEventsEmitCount := 0

	scanFile := func(path string) {
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		// Only the repo-root app.go's own (a *App) emit method may call
		// EventsEmit at all, or forward a variadic call, or carry more than
		// one payload — it is the seam's single choke point. A same-named
		// app.go nested under internal/** (or anywhere else) does not
		// inherit this exemption. Every other function, in every file, is
		// checked.
		isAppEmitSeam := path == filepath.Join(eventEmitScanRoot, "app.go")
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			exempt := isAppEmitSeam && fn.Name.Name == "emit"
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				target, tracked := eventEmitTargets[sel.Sel.Name]
				if !tracked {
					return true
				}
				pos := fset.Position(call.Pos())
				if exempt {
					if target.category == "EventsEmit" {
						exemptEventsEmitCount++
					}
					return true
				}
				nonExemptCounts[target.category]++
				if target.category == "EventsEmit" {
					// Bypassing the seam is itself the violation — arity
					// doesn't matter, only App.emit may call this directly.
					violations = append(violations, fmt.Sprintf(
						"%s:%d: EventsEmit(...) called outside App.emit — only the seam's own forwarding call may call it directly",
						pos.Filename, pos.Line,
					))
					return true
				}
				hasEllipsis := call.Ellipsis != token.NoPos
				payloadArgs := len(call.Args) - target.leadingArgs
				if hasEllipsis || payloadArgs > 1 {
					forwarding := ""
					if hasEllipsis {
						forwarding = " (ellipsis-forwarded)"
					}
					violations = append(violations, fmt.Sprintf(
						"%s:%d: %s(...) carries %d payload argument(s)%s, want at most 1 and no forwarding",
						pos.Filename, pos.Line, sel.Sel.Name, payloadArgs, forwarding,
					))
				}
				return true
			})
		}
	}

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
		scanFile(path)
		return nil
	})
	if err != nil {
		t.Fatalf("walk repository for production .go files: %v", err)
	}

	if exemptEventsEmitCount == 0 {
		t.Error("guard found no EventsEmit(...) call inside App.emit — it has gone vacuous (symbol renamed or App.emit restructured?)")
	}
	for _, category := range []string{"emit", "emitFn", "emitter"} {
		if nonExemptCounts[category] == 0 {
			t.Errorf("guard matched zero non-exempt %s(...) call sites — it has gone vacuous (symbol renamed?)", category)
		}
	}

	if len(violations) > 0 {
		t.Fatalf("production event-emit arity violations:\n%s", strings.Join(violations, "\n"))
	}
}

import { applyNavigation } from '../../../components/Editor/applyNavigation';
import type { EditorNavigationRequest } from '../../../stores/ideStore';

// Regression guard for the bug where clicking a search result opened the file
// but left the viewport at the top. On a freshly-opened file the document is
// swapped into the shared view in the same commit, so CodeMirror resolves
// `scrollIntoView: true` against an unmeasured document and the target line
// stays off-screen (the cursor lands correctly). The fix re-asserts the scroll
// on the next animation frame, once the layout exists — guarded against a stale
// navigation or a torn-down view.
//
// applyNavigation is extracted into its own module so these tests run against
// the real EditorView (whose static scrollIntoView is a pure effect factory)
// without the heavy CodeMirror component mock.

interface NavDispatchSpec {
  selection?: { anchor: number };
  scrollIntoView?: boolean;
  effects?: { value: { y: string } };
}

/**
 * Minimal fake of the EditorView surface applyNavigation touches. The dispatch
 * spy updates the tracked selection head so the deferred re-scroll's guard
 * (`selection.main.head === pos`) behaves like the real view.
 */
function makeFakeView(text: string, connected = true) {
  const lines = text.split('\n');
  const view = {
    dom: { isConnected: connected },
    focus: jest.fn(),
    dispatch: jest.fn((spec: NavDispatchSpec) => {
      if (spec.selection) {
        view.state.selection = { main: { head: spec.selection.anchor } };
      }
    }),
    state: {
      selection: { main: { head: 0 } },
      doc: {
        lines: lines.length,
        line(lineNumber: number) {
          let from = 0;
          for (let i = 0; i < lineNumber - 1; i += 1) {
            from += (lines[i] ?? '').length + 1;
          }
          return { from, length: (lines[lineNumber - 1] ?? '').length };
        },
      },
    },
  };
  return view;
}

const DOC = Array.from({ length: 20 }, (_, i) => `line ${i + 1} contents`).join('\n');

function nav(line: number, column = 1): EditorNavigationRequest {
  return { fileId: '/f.ts', line, column, revision: 1 };
}

let rafCallbacks: FrameRequestCallback[] = [];

beforeEach(() => {
  // Capture rAF callbacks so each test controls when the deferred re-scroll runs.
  rafCallbacks = [];
  global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
});

function flushRaf() {
  const pending = rafCallbacks;
  rafCallbacks = [];
  pending.forEach((cb) => cb(0));
}

describe('applyNavigation', () => {
  it('moves the selection and scrolls synchronously', () => {
    const view = makeFakeView(DOC);
    const expectedPos = view.state.doc.line(5).from + 2; // line 5, column 3

    applyNavigation(view as never, nav(5, 3));

    expect(view.dispatch).toHaveBeenNthCalledWith(1, {
      selection: { anchor: expectedPos },
      scrollIntoView: true,
    });
    expect(view.focus).toHaveBeenCalled();
  });

  it('re-asserts the scroll on the next animation frame (fresh-open fix)', () => {
    const view = makeFakeView(DOC);

    applyNavigation(view as never, nav(12));
    expect(view.dispatch).toHaveBeenCalledTimes(1); // only the synchronous scroll so far

    flushRaf();

    expect(view.dispatch).toHaveBeenCalledTimes(2);
    const second = view.dispatch.mock.calls[1][0] as NavDispatchSpec;
    // The deferred dispatch carries a scrollIntoView effect, not a selection change.
    expect(second.selection).toBeUndefined();
    expect(second.effects?.value.y).toBe('nearest');
  });

  it('skips the deferred re-scroll if the selection has moved on (stale nav guard)', () => {
    const view = makeFakeView(DOC);

    applyNavigation(view as never, nav(8));
    // Simulate a rapid file switch / follow-up navigation before the frame runs.
    view.state.selection = { main: { head: 999 } };
    flushRaf();

    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  it('skips the deferred re-scroll if the document has changed', () => {
    const view = makeFakeView(DOC);

    applyNavigation(view as never, nav(8));
    view.state.doc = makeFakeView(DOC).state.doc;
    flushRaf();

    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  it('skips the deferred re-scroll if the view was torn down', () => {
    const view = makeFakeView(DOC, /* connected */ false);

    applyNavigation(view as never, nav(8));
    flushRaf();

    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  it('clamps to the last line and ignores non-positive lines', () => {
    const view = makeFakeView(DOC);
    applyNavigation(view as never, nav(999));
    expect(view.dispatch).toHaveBeenNthCalledWith(1, {
      selection: { anchor: view.state.doc.line(20).from },
      scrollIntoView: true,
    });

    const view2 = makeFakeView(DOC);
    applyNavigation(view2 as never, nav(0));
    expect(view2.dispatch).not.toHaveBeenCalled();
  });
});

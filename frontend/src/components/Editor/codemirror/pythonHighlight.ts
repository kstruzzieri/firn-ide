/**
 * Python-specific highlight overlay.
 *
 * lezer-python tags `self`/`cls`, builtin types/functions (`dict`, `str`, `float`,
 * …), decorator names, and keyword-argument names all as plain `VariableName`/
 * `PropertyName` — the same tag as any user identifier — so the syntax theme's
 * HighlightStyle cannot distinguish them. This ViewPlugin walks the syntax tree
 * and marks those tokens with CSS classes the active theme colours (see
 * `buildChromeRules` in theme.ts):
 *   - `.firn-tok-self`      → palette.keyword  (self / cls)
 *   - `.firn-tok-builtin`   → palette.type     (dict / str / float / len / …)
 *   - `.firn-tok-decorator` → palette.function (name in `@property`, `@app.route`)
 *   - `.firn-tok-param`     → palette.property (keyword-arg names: `Foo(id=…)`)
 *
 * Runs at `Prec.highest` so its mark spans nest *inside* the syntax-highlight spans
 * and win the colour cascade. Scope to Python documents only — other languages share
 * the `VariableName` tag and would be mis-coloured.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Prec, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import type { SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common';

/** Python identifiers conventionally highlighted like keywords. */
export const PY_SELF_NAMES = new Set(['self', 'cls']);

/** Python builtin types/functions highlighted distinctly from user variables. */
export const PY_BUILTINS = new Set([
  // Types
  'bool',
  'bytearray',
  'bytes',
  'complex',
  'dict',
  'float',
  'frozenset',
  'int',
  'list',
  'memoryview',
  'object',
  'range',
  'set',
  'slice',
  'str',
  'tuple',
  'type',
  // Common builtin functions
  'abs',
  'all',
  'any',
  'ascii',
  'bin',
  'callable',
  'chr',
  'classmethod',
  'compile',
  'delattr',
  'dir',
  'divmod',
  'enumerate',
  'eval',
  'exec',
  'filter',
  'format',
  'getattr',
  'globals',
  'hasattr',
  'hash',
  'help',
  'hex',
  'id',
  'input',
  'isinstance',
  'issubclass',
  'iter',
  'len',
  'locals',
  'map',
  'max',
  'min',
  'next',
  'oct',
  'open',
  'ord',
  'pow',
  'print',
  'property',
  'repr',
  'reversed',
  'round',
  'setattr',
  'sorted',
  'staticmethod',
  'sum',
  'super',
  'vars',
  'zip',
]);

export type PythonTokenClass =
  | 'firn-tok-self'
  | 'firn-tok-builtin'
  | 'firn-tok-decorator'
  | 'firn-tok-param';

export interface PythonTokenContext {
  /** Node is the callee/name of a decorator. */
  decoratorName: boolean;
  /** Node is a keyword-argument name (`name=` inside a call's ArgList). */
  kwargName: boolean;
}

/**
 * Pure classifier (exported for tests). Decorator-name and kwarg-name context take
 * precedence so e.g. `@property` colours `property` as a decorator rather than as the
 * `property` builtin.
 */
export function pythonTokenClass(
  nodeName: string,
  text: string,
  ctx: PythonTokenContext
): PythonTokenClass | null {
  if (ctx.decoratorName && (nodeName === 'VariableName' || nodeName === 'PropertyName')) {
    return 'firn-tok-decorator';
  }
  if (ctx.kwargName && nodeName === 'VariableName') {
    return 'firn-tok-param';
  }
  if (nodeName !== 'VariableName') return null;
  if (PY_SELF_NAMES.has(text)) return 'firn-tok-self';
  if (PY_BUILTINS.has(text)) return 'firn-tok-builtin';
  return null;
}

/**
 * True when `node` is the callee/name of a decorator (inside a `Decorator` node and
 * NOT one of its call arguments). `@wraps(func)` → `wraps` is a name, `func` is an
 * argument (inside `ArgList`) and is left alone.
 */
function isDecoratorName(node: SyntaxNode): boolean {
  for (let cur: SyntaxNode | null = node.parent; cur; cur = cur.parent) {
    if (cur.name === 'ArgList') return false;
    if (cur.name === 'Decorator') return true;
  }
  return false;
}

/** True when `node` is the `name` in a `name=value` keyword argument. */
function isKwargName(node: SyntaxNode): boolean {
  return node.parent?.name === 'ArgList' && node.nextSibling?.name === 'AssignOp';
}

function classifyNode(state: EditorState, ref: SyntaxNodeRef): PythonTokenClass | null {
  if (ref.name !== 'VariableName' && ref.name !== 'PropertyName') return null;
  const node = ref.node;
  return pythonTokenClass(ref.name, state.sliceDoc(ref.from, ref.to), {
    decoratorName: isDecoratorName(node),
    kwargName: isKwargName(node),
  });
}

/**
 * Collects every overlay mark in the document. Exported for tests so the tree-walk +
 * classification can be verified without rendering.
 */
export function collectPythonMarks(
  state: EditorState,
  tree: Tree = syntaxTree(state)
): { from: number; to: number; cls: PythonTokenClass }[] {
  const out: { from: number; to: number; cls: PythonTokenClass }[] = [];
  tree.iterate({
    enter: (ref) => {
      const cls = classifyNode(state, ref);
      if (cls) out.push({ from: ref.from, to: ref.to, cls });
    },
  });
  return out;
}

const MARKS: Record<PythonTokenClass, Decoration> = {
  'firn-tok-self': Decoration.mark({ class: 'firn-tok-self' }),
  'firn-tok-builtin': Decoration.mark({ class: 'firn-tok-builtin' }),
  'firn-tok-decorator': Decoration.mark({ class: 'firn-tok-decorator' }),
  'firn-tok-param': Decoration.mark({ class: 'firn-tok-param' }),
};

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (ref) => {
        const cls = classifyNode(view.state, ref);
        if (cls) builder.add(ref.from, ref.to, MARKS[cls]);
      },
    });
  }
  return builder.finish();
}

/**
 * Python highlight overlay extension. Add only for Python documents.
 */
export function pythonHighlightExtensions(): Extension {
  return Prec.highest(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
        }

        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            syntaxTree(update.startState) !== syntaxTree(update.state)
          ) {
            this.decorations = buildDecorations(update.view);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations }
    )
  );
}

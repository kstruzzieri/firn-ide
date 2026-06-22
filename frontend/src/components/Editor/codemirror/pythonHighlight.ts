/**
 * Python-specific highlight overlay.
 *
 * lezer-python tags `self`/`cls`, builtin types/functions (`dict`, `str`, `float`,
 * …), and decorator names all as plain `VariableName`/`PropertyName` — the same tag
 * as any user identifier — so the syntax theme's HighlightStyle cannot distinguish
 * them. This ViewPlugin walks the syntax tree and marks those tokens with CSS classes
 * that the active theme colours (see `buildChromeRules` in theme.ts):
 *   - `.firn-tok-self`      → palette.keyword  (self / cls)
 *   - `.firn-tok-builtin`   → palette.type     (dict / str / float / len / …)
 *   - `.firn-tok-decorator` → palette.function (the name in `@property`, `@app.route`)
 *
 * Scope this to Python documents only — other languages share the `VariableName` tag
 * and would mis-colour identifiers like a JS variable named `self`.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

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

export type PythonTokenClass = 'firn-tok-self' | 'firn-tok-builtin' | 'firn-tok-decorator';

/**
 * Pure classifier (exported for tests). Decorator-name detection takes precedence so
 * `@property` colours `property` as a decorator rather than as the `property` builtin.
 */
export function pythonTokenClass(
  nodeName: string,
  text: string,
  isDecoratorName: boolean
): PythonTokenClass | null {
  if (isDecoratorName && (nodeName === 'VariableName' || nodeName === 'PropertyName')) {
    return 'firn-tok-decorator';
  }
  if (nodeName !== 'VariableName') return null;
  if (PY_SELF_NAMES.has(text)) return 'firn-tok-self';
  if (PY_BUILTINS.has(text)) return 'firn-tok-builtin';
  return null;
}

/**
 * True when `node` is the callee/name of a decorator (lives inside a `Decorator`
 * node and is NOT one of its call arguments). `@wraps(func)` → `wraps` is a name,
 * `func` is an argument (inside `ArgList`) and is left alone.
 */
function isDecoratorName(node: SyntaxNode): boolean {
  for (let cur: SyntaxNode | null = node.parent; cur; cur = cur.parent) {
    if (cur.name === 'ArgList') return false;
    if (cur.name === 'Decorator') return true;
  }
  return false;
}

const MARKS: Record<PythonTokenClass, Decoration> = {
  'firn-tok-self': Decoration.mark({ class: 'firn-tok-self' }),
  'firn-tok-builtin': Decoration.mark({ class: 'firn-tok-builtin' }),
  'firn-tok-decorator': Decoration.mark({ class: 'firn-tok-decorator' }),
};

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'VariableName' && node.name !== 'PropertyName') return;
        const text = view.state.sliceDoc(node.from, node.to);
        const cls = pythonTokenClass(node.name, text, isDecoratorName(node.node));
        if (cls) builder.add(node.from, node.to, MARKS[cls]);
      },
    });
  }
  return builder.finish();
}

/**
 * Python highlight overlay extension. Add only for Python documents.
 */
export function pythonHighlightExtensions(): Extension {
  return ViewPlugin.fromClass(
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
  );
}

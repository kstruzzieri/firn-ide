import { tags as t, tagHighlighter, type Highlighter } from '@lezer/highlight';

/**
 * Curated syntax roles the search panel colors. These are exactly the
 * `SyntaxPalette` keys the one-line preview cares about — `background` and
 * `param` are intentionally excluded (`background` is the canvas; `param` is a
 * Python syntax-tree overlay role, not a Lezer tag). Kept in sync by hand with
 * the palette-backed portions of `theme.ts:buildHighlightSpec`; drift is
 * cosmetic in a single-line preview (see the #215 design doc).
 */
export const SEARCH_TOKEN_ROLES = [
  'keyword',
  'string',
  'number',
  'comment',
  'function',
  'type',
  'variable',
  'property',
  'operator',
  'punctuation',
  'constant',
  'tag',
  'attribute',
  'regexp',
  'escape',
  'decorator',
] as const;

export type SearchTokenRole = (typeof SEARCH_TOKEN_ROLES)[number];

// tagHighlighter precedence: more specific tags win, so `function(variableName)`
// overrides the base `variableName` rule and definitions inherit their base role.
export const searchTokenHighlighter: Highlighter = tagHighlighter([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'tok-comment' },
  { tag: [t.string, t.special(t.string), t.character, t.attributeValue], class: 'tok-string' },
  { tag: t.escape, class: 'tok-escape' },
  { tag: [t.number, t.integer, t.float], class: 'tok-number' },
  {
    tag: [
      t.keyword,
      t.modifier,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.self,
    ],
    class: 'tok-keyword',
  },
  {
    tag: [
      t.operator,
      t.compareOperator,
      t.arithmeticOperator,
      t.logicOperator,
      t.bitwiseOperator,
      t.updateOperator,
      t.definitionOperator,
    ],
    class: 'tok-operator',
  },
  {
    tag: [
      t.punctuation,
      t.paren,
      t.brace,
      t.bracket,
      t.squareBracket,
      t.separator,
      t.derefOperator,
      t.angleBracket,
    ],
    class: 'tok-punctuation',
  },
  { tag: t.meta, class: 'tok-decorator' },
  { tag: [t.variableName, t.definition(t.variableName)], class: 'tok-variable' },
  { tag: [t.propertyName, t.definition(t.propertyName)], class: 'tok-property' },
  {
    tag: [
      t.function(t.variableName),
      t.definition(t.function(t.variableName)),
      t.function(t.propertyName),
    ],
    class: 'tok-function',
  },
  { tag: [t.typeName, t.className, t.namespace, t.annotation], class: 'tok-type' },
  {
    tag: [t.constant(t.variableName), t.bool, t.null, t.atom, t.unit],
    class: 'tok-constant',
  },
  { tag: t.tagName, class: 'tok-tag' },
  { tag: t.attributeName, class: 'tok-attribute' },
  { tag: t.regexp, class: 'tok-regexp' },
]);

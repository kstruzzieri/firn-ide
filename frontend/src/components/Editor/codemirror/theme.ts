/**
 * Firn Glacier Theme for CodeMirror 6
 *
 * A custom dark theme with blue-tinted gradient depth surfaces
 * and vivid syntax highlighting. Matches Firn IDE's Firn Glacier design system.
 */

import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Firn Glacier color palette extracted from design tokens.
 * Blue-tinted gradient depth surfaces with vivid -300 Tailwind syntax tones.
 */
const colors = {
  // Surfaces (Approach C — blue-tinted gradient depth)
  background: '#0F172A', // Panel background (slate-900)
  backgroundHighlight: '#152035', // Elevated/tab bars
  surface: '#1E293B', // Hover state (slate-800)
  surfaceHover: '#1E293B', // Hover states
  surfaceActive: '#243147', // Active/pressed

  // Borders
  border: '#1E3A5F', // Subtle blue border
  borderSubtle: '#162D4A', // Softer border

  // Text
  foreground: '#F1F5F9', // slate-100
  foregroundSecondary: '#94A3B8', // slate-400
  foregroundMuted: '#64748B', // slate-500
  foregroundDisabled: '#475569', // slate-600

  // Accent (Glacier Blue)
  accent: '#38BDF8', // sky-400
  accentDim: 'rgba(56, 189, 248, 0.12)',
  accentGlow: 'rgba(56, 189, 248, 0.25)',

  // Syntax highlighting — vivid -300 Tailwind tones
  keyword: '#C4B5FD', // violet-300 (icier)
  string: '#86EFAC', // green-300 (brighter)
  number: '#FCD34D', // amber-300 (gold)
  comment: '#64748B', // slate-500
  function: '#7DD3FC', // sky-300 (glacier family)
  variable: '#FDE68A', // amber-200
  type: '#FDA4AF', // rose-300 (softer)
  operator: '#67E8F9', // cyan-300 (brighter)
  punctuation: '#CBD5E1', // slate-300
  tag: '#FDA4AF', // rose-300
  attribute: '#FCD34D', // amber-300
  constant: '#FCD34D', // amber-300
  regexp: '#86EFAC', // green-300

  // UI States
  selection: 'rgba(56, 189, 248, 0.3)',
  selectionMatch: 'rgba(56, 189, 248, 0.15)',
  cursor: '#38BDF8',
  activeLine: 'rgba(56, 189, 248, 0.06)',
  matchingBracket: 'rgba(56, 189, 248, 0.4)',
  searchMatch: 'rgba(245, 158, 11, 0.3)',

  // Gutter
  gutterBackground: '#0F172A',
  gutterForeground: '#475569',
  gutterActiveForeground: '#64748B',

  // Status
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
};

/**
 * Editor theme - controls the visual appearance of the editor chrome.
 */
export const firnGlacierTheme = EditorView.theme(
  {
    // Root editor styling
    '&': {
      color: colors.foreground,
      backgroundColor: colors.background,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '13px',
      lineHeight: '1.6',
    },

    // Content area
    '.cm-content': {
      caretColor: colors.cursor,
      padding: '8px 0',
    },

    // Cursor styling
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: colors.cursor,
      borderLeftWidth: '2px',
    },

    // Selection
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: colors.selection,
      },

    // Active line highlight
    '.cm-activeLine': {
      backgroundColor: colors.activeLine,
    },

    // Matching brackets
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: colors.matchingBracket,
      outline: `1px solid ${colors.accent}`,
    },

    // Non-matching bracket (error state)
    '&.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(239, 68, 68, 0.3)',
      outline: `1px solid ${colors.error}`,
    },

    // Search matches
    '.cm-searchMatch': {
      backgroundColor: colors.searchMatch,
      outline: `1px solid ${colors.warning}`,
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(245, 158, 11, 0.5)',
    },

    // Selection matches (same word highlighting)
    '.cm-selectionMatch': {
      backgroundColor: colors.selectionMatch,
    },

    // Gutters (line numbers, fold markers)
    '.cm-gutters': {
      backgroundColor: colors.gutterBackground,
      color: colors.gutterForeground,
      border: 'none',
      borderRight: `1px solid ${colors.borderSubtle}`,
    },

    '.cm-gutter': {
      minWidth: '48px',
    },

    // Line numbers
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 12px 0 8px',
      minWidth: '40px',
      textAlign: 'right',
    },

    // Active line number
    '.cm-activeLineGutter': {
      backgroundColor: colors.activeLine,
      color: colors.gutterActiveForeground,
    },

    // Fold markers
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 4px',
      cursor: 'pointer',
      color: colors.foregroundMuted,
      transition: 'color 100ms ease-out',
    },
    '.cm-foldGutter .cm-gutterElement:hover': {
      color: colors.accent,
    },

    // Fold placeholder
    '.cm-foldPlaceholder': {
      backgroundColor: colors.surfaceHover,
      border: `1px solid ${colors.borderSubtle}`,
      borderRadius: '4px',
      color: colors.foregroundMuted,
      padding: '0 8px',
      margin: '0 4px',
    },

    // Tooltips (autocomplete, hover info)
    '.cm-tooltip': {
      backgroundColor: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      color: colors.foreground,
      fontSize: '12px',
    },

    // Autocomplete
    '.cm-tooltip.cm-tooltip-autocomplete': {
      '& > ul': {
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        maxHeight: '300px',
      },
      '& > ul > li': {
        padding: '4px 12px',
        lineHeight: '1.4',
      },
      '& > ul > li[aria-selected]': {
        backgroundColor: colors.accentDim,
        color: colors.foreground,
      },
    },

    // Autocomplete icons
    '.cm-completionIcon': {
      width: '20px',
      opacity: 0.8,
    },

    // Panels (search, goto line)
    '.cm-panels': {
      backgroundColor: colors.surface,
      borderBottom: `1px solid ${colors.border}`,
    },

    '.cm-panel': {
      padding: '8px 12px',
    },

    '.cm-panel input': {
      backgroundColor: colors.background,
      border: `1px solid ${colors.border}`,
      borderRadius: '4px',
      color: colors.foreground,
      padding: '4px 8px',
      fontSize: '12px',
      outline: 'none',
    },

    '.cm-panel input:focus': {
      borderColor: colors.accent,
    },

    '.cm-panel button': {
      backgroundColor: colors.surfaceHover,
      border: `1px solid ${colors.border}`,
      borderRadius: '4px',
      color: colors.foreground,
      padding: '4px 12px',
      fontSize: '12px',
      cursor: 'pointer',
      transition: 'all 100ms ease-out',
    },

    '.cm-panel button:hover': {
      backgroundColor: colors.surfaceActive,
      borderColor: colors.accent,
    },

    // Linting
    '.cm-lintRange-error': {
      backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='6' height='3'><path d='m0 3 l2 -2 l1 0 l2 2 l1 0' stroke='%23EF4444' fill='none' stroke-width='1.2'/></svg>")`,
    },
    '.cm-lintRange-warning': {
      backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='6' height='3'><path d='m0 3 l2 -2 l1 0 l2 2 l1 0' stroke='%23F59E0B' fill='none' stroke-width='1.2'/></svg>")`,
    },
    '.cm-lintRange-info': {
      backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='6' height='3'><path d='m0 3 l2 -2 l1 0 l2 2 l1 0' stroke='%233B82F6' fill='none' stroke-width='1.2'/></svg>")`,
    },

    // Lint gutter markers
    '.cm-lint-marker-error': {
      content: '"⛔"',
    },
    '.cm-lint-marker-warning': {
      content: '"⚠"',
    },

    // Scrollbars
    '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
      width: '8px',
      height: '8px',
    },
    '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
      background: colors.borderSubtle,
      borderRadius: '4px',
    },
    '&::-webkit-scrollbar-thumb:hover, & *::-webkit-scrollbar-thumb:hover': {
      background: colors.border,
    },
  },
  { dark: true }
);

/**
 * Syntax highlighting styles for the Firn Glacier theme.
 * Uses semantic token types from @lezer/highlight.
 */
export const firnGlacierHighlightStyle = HighlightStyle.define([
  // Comments
  { tag: t.comment, color: colors.comment, fontStyle: 'italic' },
  { tag: t.lineComment, color: colors.comment, fontStyle: 'italic' },
  { tag: t.blockComment, color: colors.comment, fontStyle: 'italic' },
  { tag: t.docComment, color: colors.comment, fontStyle: 'italic' },

  // Strings
  { tag: t.string, color: colors.string },
  { tag: t.special(t.string), color: colors.string },
  { tag: t.character, color: colors.string },
  { tag: t.escape, color: colors.operator },

  // Numbers
  { tag: t.number, color: colors.number },
  { tag: t.integer, color: colors.number },
  { tag: t.float, color: colors.number },

  // Keywords
  { tag: t.keyword, color: colors.keyword },
  { tag: t.modifier, color: colors.keyword },
  { tag: t.controlKeyword, color: colors.keyword },
  { tag: t.operatorKeyword, color: colors.keyword },
  { tag: t.definitionKeyword, color: colors.keyword },
  { tag: t.moduleKeyword, color: colors.keyword },

  // Operators and punctuation
  { tag: t.operator, color: colors.operator },
  { tag: t.compareOperator, color: colors.operator },
  { tag: t.arithmeticOperator, color: colors.operator },
  { tag: t.logicOperator, color: colors.operator },
  { tag: t.bitwiseOperator, color: colors.operator },
  { tag: t.punctuation, color: colors.punctuation },
  { tag: t.paren, color: colors.punctuation },
  { tag: t.brace, color: colors.punctuation },
  { tag: t.bracket, color: colors.punctuation },
  { tag: t.separator, color: colors.punctuation },

  // Variables and properties
  { tag: t.variableName, color: colors.foreground },
  { tag: t.definition(t.variableName), color: colors.variable },
  { tag: t.propertyName, color: colors.variable },
  { tag: t.definition(t.propertyName), color: colors.variable },

  // Functions
  { tag: t.function(t.variableName), color: colors.function },
  { tag: t.definition(t.function(t.variableName)), color: colors.function },
  { tag: t.function(t.propertyName), color: colors.function },

  // Types
  { tag: t.typeName, color: colors.type },
  { tag: t.className, color: colors.type },
  { tag: t.namespace, color: colors.type },
  { tag: t.annotation, color: colors.type },
  { tag: t.self, color: colors.keyword },

  // Constants and special values
  { tag: t.constant(t.variableName), color: colors.constant },
  { tag: t.bool, color: colors.constant },
  { tag: t.null, color: colors.constant },
  { tag: t.atom, color: colors.constant },
  { tag: t.unit, color: colors.constant },

  // HTML/JSX tags
  { tag: t.tagName, color: colors.tag },
  { tag: t.angleBracket, color: colors.punctuation },
  { tag: t.attributeName, color: colors.attribute },
  { tag: t.attributeValue, color: colors.string },

  // Regular expressions
  { tag: t.regexp, color: colors.regexp },

  // Headings (Markdown)
  { tag: t.heading, color: colors.function, fontWeight: 'bold' },
  { tag: t.heading1, color: colors.function, fontWeight: 'bold', fontSize: '1.4em' },
  { tag: t.heading2, color: colors.function, fontWeight: 'bold', fontSize: '1.2em' },
  { tag: t.heading3, color: colors.function, fontWeight: 'bold' },

  // Markdown specific
  { tag: t.link, color: colors.accent, textDecoration: 'underline' },
  { tag: t.url, color: colors.accent },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.quote, color: colors.foregroundSecondary, fontStyle: 'italic' },

  // Labels (goto, break targets)
  { tag: t.labelName, color: colors.accent },

  // Invalid/error
  { tag: t.invalid, color: colors.error },
]);

/**
 * Complete Firn Glacier theme extension combining editor theme and syntax highlighting.
 */
export const firnGlacier: Extension = [
  firnGlacierTheme,
  syntaxHighlighting(firnGlacierHighlightStyle),
];

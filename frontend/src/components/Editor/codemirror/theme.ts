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
      zIndex: '1200',
    },

    // Autocomplete
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: '#10192A',
      border: `1px solid ${colors.border}`,
      borderRadius: '7px',
      minWidth: '440px',
      maxWidth: '620px',
      padding: 0,
      overflow: 'visible',
      boxShadow: '0 18px 36px rgba(2, 6, 23, 0.48)',
      '& > ul': {
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        maxHeight: '320px',
        padding: 0,
        overflow: 'hidden auto',
        borderRadius: '7px',
        overscrollBehavior: 'contain',
        scrollbarGutter: 'stable',
        background:
          'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(15, 23, 42, 0.94) 100%)',
      },
      '& > ul > completion-section': {
        display: 'list-item',
      },
      '& > ul > completion-section:not(:first-child)': {
        borderTop: `1px solid rgba(148, 163, 184, 0.12)`,
      },
      '& > ul > li': {
        display: 'grid',
        gridTemplateColumns: '18px minmax(0, 1.4fr) minmax(0, 1fr) auto',
        gridTemplateRows: 'auto auto',
        gridTemplateAreas: '"icon label tail detail" "icon meta meta detail"',
        columnGap: '12px',
        rowGap: '3px',
        alignItems: 'start',
        padding: '10px 14px 9px 12px',
        lineHeight: '1.25',
        borderLeft: '3px solid rgba(56, 189, 248, 0.08)',
        borderTop: `1px solid rgba(148, 163, 184, 0.08)`,
        background:
          'linear-gradient(90deg, rgba(148, 163, 184, 0.03) 0%, rgba(148, 163, 184, 0) 28%)',
      },
      '& > ul > completion-section + li': {
        borderTop: 'none',
      },
      '& > ul > li[aria-selected]': {
        backgroundColor: '#1F2E45',
        borderLeftColor: colors.accent,
        boxShadow: 'inset 0 0 0 1px rgba(56, 189, 248, 0.12)',
        color: colors.foreground,
      },
      '& > ul > li[aria-selected] .firn-completion-meta': {
        color: '#AFC3D8',
      },
      '& > ul > li[aria-selected] .firn-completion-meta-source': {
        color: '#C1D3E8',
      },
      '& > ul > li:not([aria-selected]):hover': {
        backgroundColor: 'rgba(36, 49, 71, 0.62)',
      },
    },

    // Autocomplete icons
    '.cm-completionIcon': {
      width: '20px',
      opacity: 0.8,
    },
    '.cm-completionLabel': {
      gridArea: 'label',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontWeight: '650',
      fontSize: '13px',
      letterSpacing: '0.01em',
      color: '#D7E2EE',
    },
    '.firn-completion-tail': {
      gridArea: 'tail',
      alignSelf: 'center',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: '12px',
      color: '#8FA6C2',
      letterSpacing: '0.01em',
    },
    '.cm-completionMatchedText': {
      color: colors.accent,
      textDecoration: 'none',
    },
    '.cm-completionDetail': {
      gridArea: 'detail',
      alignSelf: 'center',
      color: '#9DB3CC',
      fontSize: '10.5px',
      fontWeight: '600',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      marginLeft: '16px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '180px',
      textAlign: 'right',
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

    // --- Completion styles ---
    '.firn-completion-icon': {
      display: 'inline-flex',
      gridArea: 'icon',
      alignItems: 'center',
      justifyContent: 'center',
      width: '18px',
      height: '18px',
      marginTop: '2px',
      verticalAlign: 'middle',
      opacity: 0.92,
    },
    '.firn-completion-section': {
      display: 'block',
      listStyle: 'none',
      minHeight: '30px',
      padding: '10px 14px 7px 12px',
      color: '#8FB0D4',
      fontSize: '11px',
      fontWeight: '700',
      background: 'linear-gradient(180deg, rgba(21, 32, 53, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%)',
      letterSpacing: '0.03em',
      textTransform: 'uppercase',
      lineHeight: '1.25',
    },
    '.firn-completion-meta': {
      gridArea: 'meta',
      color: '#8CA0BB',
      fontSize: '11px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    '.firn-completion-meta-source': {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      color: '#7F93AD',
    },
    '.firn-completion-option-internal .cm-completionLabel': {
      color: colors.foregroundSecondary,
    },
    '.firn-completion-option-internal .firn-completion-meta': {
      color: colors.foregroundDisabled,
    },
    '.firn-completion-option-internal .cm-completionDetail': {
      color: colors.foregroundDisabled,
    },
    '.firn-completion-info': {
      padding: '12px 14px 13px',
      maxWidth: '320px',
      maxHeight: '260px',
      overflow: 'auto',
      overscrollBehavior: 'contain',
      fontSize: '12px',
      lineHeight: '1.45',
      background: 'linear-gradient(180deg, rgba(16, 25, 42, 0.98) 0%, rgba(13, 20, 34, 0.98) 100%)',
      border: `1px solid ${colors.border}`,
      borderRadius: '7px',
      boxShadow: '0 12px 28px rgba(0, 0, 0, 0.34)',
    },
    '.firn-completion-info-top': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      marginBottom: '8px',
    },
    '.firn-completion-info-title': {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '12px',
      color: '#DDE7F4',
      fontWeight: '700',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    '.firn-completion-info-badge': {
      flexShrink: 0,
      padding: '2px 7px',
      borderRadius: '999px',
      backgroundColor: 'rgba(148, 163, 184, 0.12)',
      border: '1px solid rgba(148, 163, 184, 0.18)',
      color: '#B8C7DA',
      fontSize: '10px',
      fontWeight: '700',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    },
    '.firn-completion-info-signature': {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '12px',
      lineHeight: '1.5',
      padding: '8px 10px',
      borderRadius: '6px',
      backgroundColor: 'rgba(30, 41, 59, 0.72)',
      border: '1px solid rgba(56, 189, 248, 0.08)',
      marginBottom: '10px',
      whiteSpace: 'normal',
      wordBreak: 'break-word',
    },
    '.firn-completion-info-signature-name': {
      color: '#DDE7F4',
      fontWeight: '700',
    },
    '.firn-completion-info-signature-tail': {
      color: '#8FD4FF',
    },
    '.firn-completion-info-signature-punct': {
      color: '#90A4BF',
    },
    '.firn-completion-info-signature-type': {
      color: '#FDE68A',
      fontStyle: 'italic',
    },
    '.firn-completion-info-body': {
      color: colors.foregroundSecondary,
      fontSize: '11px',
      whiteSpace: 'pre-wrap',
      lineHeight: '1.55',
    },
    '.cm-tooltip.cm-completionInfo, .cm-tooltip.cm-tooltip-hover': {
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: 0,
      boxShadow: 'none',
      padding: 0,
    },

    // Completion row color coding
    '.firn-completion-option-callable': {
      borderLeftColor: 'rgba(125, 211, 252, 0.3)',
      background: 'linear-gradient(90deg, rgba(14, 116, 144, 0.12) 0%, rgba(15, 23, 42, 0) 34%)',
    },
    '.firn-completion-option-callable .cm-completionLabel': {
      color: '#6FD3FF',
    },
    '.firn-completion-option-callable .firn-completion-tail': {
      color: '#A7E7FF',
    },
    '.firn-completion-option-callable .cm-completionDetail': {
      color: '#FDE68A',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-callable .cm-completionLabel':
      {
        color: '#86DDFF',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-callable .firn-completion-tail':
      {
        color: '#C0EEFF',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-callable .cm-completionDetail':
      {
        color: '#FFE08A',
      },

    '.firn-completion-option-member': {
      borderLeftColor: 'rgba(96, 165, 250, 0.28)',
      background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.11) 0%, rgba(15, 23, 42, 0) 34%)',
    },
    '.firn-completion-option-member .cm-completionLabel': {
      color: '#6EC8FF',
    },
    '.firn-completion-option-member .firn-completion-tail': {
      color: '#9EC7EB',
    },
    '.firn-completion-option-member .cm-completionDetail': {
      color: '#9BD3FF',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-member .cm-completionLabel':
      {
        color: '#9FD8FF',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-member .firn-completion-tail':
      {
        color: '#CBE4FB',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-member .cm-completionDetail':
      {
        color: '#FFE082',
      },

    '.firn-completion-option-value': {
      borderLeftColor: 'rgba(196, 181, 253, 0.32)',
      background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.1) 0%, rgba(15, 23, 42, 0) 34%)',
    },
    '.firn-completion-option-value .cm-completionLabel': {
      color: '#B98CFF',
    },
    '.firn-completion-option-value .firn-completion-tail': {
      color: '#DAC8FF',
    },
    '.firn-completion-option-value .cm-completionDetail': {
      color: '#FDE68A',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-value .cm-completionLabel':
      {
        color: '#CAA5FF',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-value .firn-completion-tail':
      {
        color: '#E7D9FF',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-value .cm-completionDetail':
      {
        color: '#FFE59C',
      },

    '.firn-completion-option-type': {
      borderLeftColor: 'rgba(253, 164, 175, 0.3)',
      background: 'linear-gradient(90deg, rgba(244, 114, 182, 0.1) 0%, rgba(15, 23, 42, 0) 34%)',
    },
    '.firn-completion-option-type .cm-completionLabel': {
      color: '#FF9DB0',
    },
    '.firn-completion-option-type .firn-completion-tail': {
      color: '#FFD1D8',
    },
    '.firn-completion-option-type .cm-completionDetail': {
      color: '#FDE68A',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-type .cm-completionLabel':
      {
        color: '#FFB3C1',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-type .firn-completion-tail':
      {
        color: '#FFE0E5',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-type .cm-completionDetail':
      {
        color: '#FFE9A8',
      },

    '.firn-completion-option-constant': {
      borderLeftColor: 'rgba(252, 211, 77, 0.34)',
      background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.12) 0%, rgba(15, 23, 42, 0) 34%)',
    },
    '.firn-completion-option-constant .cm-completionLabel': {
      color: '#F7C95E',
    },
    '.firn-completion-option-constant .firn-completion-tail': {
      color: '#FFD98D',
    },
    '.firn-completion-option-constant .cm-completionDetail': {
      color: '#FFF2BF',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-constant .cm-completionLabel':
      {
        color: '#FFD86A',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-constant .firn-completion-tail':
      {
        color: '#FFE7A3',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-constant .cm-completionDetail':
      {
        color: '#FFF4C8',
      },

    '.firn-completion-option-import': {
      borderLeftColor: 'rgba(52, 211, 153, 0.28)',
      background: 'linear-gradient(90deg, rgba(16, 185, 129, 0.1) 0%, rgba(15, 23, 42, 0) 34%)',
    },
    '.firn-completion-option-import .cm-completionLabel': {
      color: '#42D69D',
    },
    '.firn-completion-option-import .firn-completion-meta-source': {
      color: '#79E9BE',
    },
    '.firn-completion-option-import .cm-completionDetail': {
      color: '#D9F99D',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-import .cm-completionLabel':
      {
        color: '#69E6B2',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-import .cm-completionDetail':
      {
        color: '#E5F9B8',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-import .firn-completion-meta-source':
      {
        color: '#92F0CB',
      },

    '.firn-completion-option-keyword': {
      borderLeftColor: 'rgba(253, 186, 116, 0.32)',
      background: 'linear-gradient(90deg, rgba(249, 115, 22, 0.1) 0%, rgba(15, 23, 42, 0) 34%)',
    },
    '.firn-completion-option-keyword .cm-completionLabel': {
      color: '#FFB86B',
    },
    '.firn-completion-option-keyword .firn-completion-tail': {
      color: '#FFD1A1',
    },
    '.firn-completion-option-keyword .cm-completionDetail': {
      color: '#FDE68A',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-keyword .cm-completionLabel':
      {
        color: '#FFC990',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-keyword .firn-completion-tail':
      {
        color: '#FFE0BA',
      },
    '.cm-tooltip-autocomplete > ul > li[aria-selected].firn-completion-option-keyword .cm-completionDetail':
      {
        color: '#FFE9A8',
      },

    '.firn-completion-info[data-tone="callable"] .firn-completion-info-badge': {
      backgroundColor: 'rgba(125, 211, 252, 0.16)',
      borderColor: 'rgba(125, 211, 252, 0.22)',
      color: '#BAE6FD',
    },
    '.firn-completion-info[data-tone="member"] .firn-completion-info-badge': {
      backgroundColor: 'rgba(148, 163, 184, 0.16)',
      borderColor: 'rgba(148, 163, 184, 0.22)',
      color: '#CBD5E1',
    },
    '.firn-completion-info[data-tone="value"] .firn-completion-info-badge': {
      backgroundColor: 'rgba(196, 181, 253, 0.16)',
      borderColor: 'rgba(196, 181, 253, 0.22)',
      color: '#DDD6FE',
    },
    '.firn-completion-info[data-tone="type"] .firn-completion-info-badge': {
      backgroundColor: 'rgba(253, 164, 175, 0.16)',
      borderColor: 'rgba(253, 164, 175, 0.22)',
      color: '#FFD1D8',
    },
    '.firn-completion-info[data-tone="constant"] .firn-completion-info-badge': {
      backgroundColor: 'rgba(252, 211, 77, 0.16)',
      borderColor: 'rgba(252, 211, 77, 0.22)',
      color: '#FDE68A',
    },
    '.firn-completion-info[data-tone="constant"] .firn-completion-info-title': {
      color: '#F7D074',
    },
    '.firn-completion-info[data-tone="constant"] .firn-completion-info-signature-name': {
      color: '#F7D074',
    },
    '.firn-completion-info[data-tone="import"] .firn-completion-info-badge': {
      backgroundColor: 'rgba(103, 232, 249, 0.16)',
      borderColor: 'rgba(103, 232, 249, 0.22)',
      color: '#A5F3FC',
    },
    '.firn-completion-info[data-tone="keyword"] .firn-completion-info-badge': {
      backgroundColor: 'rgba(253, 186, 116, 0.16)',
      borderColor: 'rgba(253, 186, 116, 0.22)',
      color: '#FED7AA',
    },

    // --- Hover tooltip styles ---
    '.firn-hover-tooltip': {
      backgroundColor: '#10192A',
      border: `1px solid ${colors.border}`,
      borderRadius: '7px',
      padding: '0',
      minWidth: '320px',
      maxWidth: '520px',
      maxHeight: '360px',
      overflow: 'auto',
      fontSize: '13px',
      lineHeight: '1.5',
      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.34)',
    },
    '.firn-hover-signature': {
      padding: '10px 12px',
      backgroundColor: '#0F172A',
    },
    '.firn-hover-code': {
      margin: '0',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '12px',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap',
      color: '#BCCBDC',
    },
    '.firn-hover-separator': {
      borderTop: `1px solid ${colors.border}`,
      margin: '0',
    },
    '.firn-hover-docs': {
      padding: '10px 12px',
      color: '#C1D1E2',
      fontSize: '12px',
    },
    '.firn-hover-doc-text': {
      whiteSpace: 'pre-wrap',
    },
    '.firn-hover-doc-code': {
      margin: '6px 0',
      padding: '8px 10px',
      backgroundColor: colors.activeLine,
      borderRadius: '5px',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '11px',
      color: colors.foreground,
      whiteSpace: 'pre-wrap',
    },
    '.firn-hover-doc-tag': {
      color: colors.keyword,
      fontWeight: '600',
    },
    '.firn-hover-actions': {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '16px',
      padding: '8px 12px',
      borderTop: `1px solid ${colors.border}`,
      backgroundColor: '#0F172A',
    },
    '.firn-hover-action': {
      color: '#9FB5CF',
      fontSize: '11px',
      fontWeight: '600',
      textDecoration: 'none',
      cursor: 'pointer',
      transition: 'color 120ms ease-out',
    },
    '.firn-hover-action:hover': {
      color: colors.accent,
    },

    // --- Hover syntax highlighting ---
    '.firn-hover-code .firn-hover-keyword': {
      color: colors.keyword,
    },
    '.firn-hover-code .firn-hover-function': {
      color: colors.function,
    },
    '.firn-hover-code .firn-hover-variable': {
      color: '#6EC8FF',
    },
    '.firn-hover-code .firn-hover-constant': {
      color: '#FCD34D',
    },
    '.firn-hover-code .firn-hover-type': {
      color: colors.type,
    },
    '.firn-hover-code .firn-hover-string': {
      color: colors.string,
    },
    '.firn-hover-code .firn-hover-punctuation': {
      color: colors.punctuation,
    },

    // --- Definition underline ---
    '.firn-definition-link': {
      textDecoration: 'underline',
      textDecorationColor: 'rgba(56, 189, 248, 0.5)',
      textUnderlineOffset: '2px',
      cursor: 'pointer',
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

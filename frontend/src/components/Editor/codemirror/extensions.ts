/**
 * CodeMirror 6 Extensions Configuration
 *
 * Provides a modular set of editor extensions organized by functionality.
 * Each function returns extensions that can be composed based on requirements.
 */

import { Extension, Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  lineNumbers,
  highlightActiveLineGutter,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  defaultHighlightStyle,
  indentUnit,
  LanguageSupport,
} from '@codemirror/language';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

// Language imports
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { rust } from '@codemirror/lang-rust';

import { firnGlacier } from './theme';

/**
 * Compartments for dynamic extension reconfiguration.
 * Allows changing language, theme, etc. without recreating the editor.
 */
export const languageCompartment = new Compartment();
export const themeCompartment = new Compartment();
export const readOnlyCompartment = new Compartment();
export const tabSizeCompartment = new Compartment();

/**
 * Language detection from file extension.
 */
export function getLanguageExtension(filename: string): LanguageSupport | null {
  const ext = filename.split('.').pop()?.toLowerCase();

  switch (ext) {
    // JavaScript/TypeScript
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });

    // Python
    case 'py':
    case 'pyw':
    case 'pyi':
      return python();

    // Go
    case 'go':
      return go();

    // Web
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'html':
    case 'htm':
      return html();

    // Data formats
    case 'json':
    case 'jsonc':
      return json();

    // Documentation
    case 'md':
    case 'markdown':
      return markdown();

    // XML
    case 'xml':
    case 'xsl':
    case 'xslt':
    case 'svg':
    case 'plist':
      return xml();

    // YAML
    case 'yml':
    case 'yaml':
      return yaml();

    // Rust
    case 'rs':
      return rust();

    default:
      return null;
  }
}

/**
 * Get human-readable language name for status bar.
 */
export function getLanguageName(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();

  const languageNames: Record<string, string> = {
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    jsx: 'JavaScript JSX',
    ts: 'TypeScript',
    mts: 'TypeScript',
    cts: 'TypeScript',
    tsx: 'TypeScript JSX',
    py: 'Python',
    pyw: 'Python',
    pyi: 'Python',
    go: 'Go',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    html: 'HTML',
    htm: 'HTML',
    json: 'JSON',
    jsonc: 'JSON with Comments',
    md: 'Markdown',
    markdown: 'Markdown',
    txt: 'Plain Text',
    sh: 'Shell',
    bash: 'Bash',
    zsh: 'Zsh',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    svg: 'SVG',
    sql: 'SQL',
    rs: 'Rust',
    rb: 'Ruby',
    java: 'Java',
    kt: 'Kotlin',
    swift: 'Swift',
    c: 'C',
    h: 'C Header',
    cpp: 'C++',
    hpp: 'C++ Header',
    cs: 'C#',
    php: 'PHP',
  };

  return ext ? languageNames[ext] || 'Plain Text' : 'Plain Text';
}

/**
 * Core editing extensions - essential functionality.
 */
export function coreExtensions(): Extension[] {
  return [
    // Line numbers and gutter
    lineNumbers(),
    highlightActiveLineGutter(),

    // Special character visualization
    highlightSpecialChars(),

    // Undo/redo
    history(),

    // Code folding
    foldGutter({
      openText: '▾',
      closedText: '▸',
    }),

    // Selection rendering
    drawSelection(),
    dropCursor(),

    // Multi-cursor support
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),

    // Active line highlighting
    highlightActiveLine(),

    // Bracket matching
    bracketMatching(),

    // Auto-indent on input
    indentOnInput(),

    // Default syntax highlighting (fallback)
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  ];
}

/**
 * Autocomplete and bracket extensions.
 */
export function autocompleteExtensions(): Extension[] {
  return [
    closeBrackets(),
    autocompletion({
      activateOnTyping: true,
      maxRenderedOptions: 50,
    }),
  ];
}

/**
 * Search and selection extensions.
 */
export function searchExtensions(): Extension[] {
  return [highlightSelectionMatches()];
}

/**
 * Keymap extensions - all keyboard shortcuts.
 */
export function keymapExtensions(): Extension[] {
  return [
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
  ];
}

/**
 * Editor behavior extensions.
 */
export function behaviorExtensions(): Extension[] {
  return [
    // 2-space indentation by default
    indentUnit.of('  '),

    // Wrap long lines
    EditorView.lineWrapping,

    // Update listener for content changes
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        // Content changed - can trigger save indicator, etc.
      }
    }),
  ];
}

/**
 * Creates a placeholder extension for empty documents.
 */
export function placeholderText(text: string): Extension {
  return placeholderExtension(text);
}

/**
 * Creates a read-only extension.
 */
export function readOnly(isReadOnly: boolean): Extension {
  return EditorView.editable.of(!isReadOnly);
}

/**
 * Creates a tab size extension.
 */
export function tabSize(size: number): Extension {
  return indentUnit.of(' '.repeat(size));
}

/**
 * Complete editor setup with all standard extensions.
 * This is the recommended way to initialize the editor.
 */
export function createEditorExtensions(options: {
  filename: string;
  readOnly?: boolean;
  tabSize?: number;
  placeholder?: string;
  onChange?: (content: string) => void;
  onCursorChange?: (line: number, column: number) => void;
}): Extension[] {
  const {
    filename,
    readOnly: isReadOnly = false,
    tabSize: tabs = 2,
    placeholder,
    onChange,
    onCursorChange,
  } = options;

  const language = getLanguageExtension(filename);

  const extensions: Extension[] = [
    // Theme
    themeCompartment.of(firnGlacier),

    // Core functionality
    ...coreExtensions(),

    // Autocomplete
    ...autocompleteExtensions(),

    // Search
    ...searchExtensions(),

    // Keymaps
    ...keymapExtensions(),

    // Behavior
    ...behaviorExtensions(),

    // Tab size
    tabSizeCompartment.of(tabSize(tabs)),

    // Read-only mode
    readOnlyCompartment.of(readOnly(isReadOnly)),

    // Language (in compartment for dynamic switching)
    languageCompartment.of(language || []),
  ];

  // Optional placeholder
  if (placeholder) {
    extensions.push(placeholderText(placeholder));
  }

  // Content change callback
  if (onChange) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      })
    );
  }

  // Cursor position change callback
  if (onCursorChange) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          onCursorChange(line.number, pos - line.from + 1);
        }
      })
    );
  }

  return extensions;
}

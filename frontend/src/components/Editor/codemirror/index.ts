/**
 * CodeMirror 6 Integration for Arc IDE
 *
 * Re-exports all CodeMirror utilities and components for use throughout the app.
 */

// Theme
export { deepOcean, deepOceanTheme, deepOceanHighlightStyle } from './theme';

// Extensions and utilities
export {
  createEditorExtensions,
  getLanguageExtension,
  getLanguageName,
  languageCompartment,
  themeCompartment,
  readOnlyCompartment,
  tabSizeCompartment,
  coreExtensions,
  autocompleteExtensions,
  searchExtensions,
  keymapExtensions,
  behaviorExtensions,
  placeholderText,
  readOnly,
  tabSize,
} from './extensions';

// Re-export commonly used CodeMirror types
export { EditorView } from '@codemirror/view';
export { EditorState, type Extension } from '@codemirror/state';

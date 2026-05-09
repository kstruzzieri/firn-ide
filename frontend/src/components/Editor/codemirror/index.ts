/**
 * CodeMirror 6 Integration for Firn IDE
 *
 * Re-exports all CodeMirror utilities and components for use throughout the app.
 */

// Theme
export { firnGlacier, firnGlacierTheme, firnGlacierHighlightStyle } from './theme';

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
  inFileSearchKeymap,
  keymapExtensions,
  behaviorExtensions,
  placeholderText,
  readOnly,
  tabSize,
} from './extensions';

// Diagnostics
export { updateEditorDiagnostics, lspToCMDiagnostics, diagnosticsCompartment } from './diagnostics';

// Completion
export { completionCompartment, reconfigureCompletion, resetCompletion } from './completion';

// Hover
export { hoverCompartment, reconfigureHover } from './hover';

// Definition
export { definitionExtensions } from './definition';

// Re-export commonly used CodeMirror types
export { EditorView } from '@codemirror/view';
export { EditorState, type Extension } from '@codemirror/state';

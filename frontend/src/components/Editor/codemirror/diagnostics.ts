/**
 * CodeMirror Diagnostics Integration
 *
 * Converts LSP diagnostics into CodeMirror lint diagnostics and provides
 * a reconfigurable compartment for the editor extension stack.
 */

import { Compartment } from '@codemirror/state';
import { type Diagnostic, lintGutter, setDiagnostics as cmSetDiagnostics } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import type { LSPDiagnostic } from '../../../stores/lspStore';

/** Compartment for the lint gutter extension. */
export const diagnosticsCompartment = new Compartment();

/**
 * Creates the initial diagnostics extensions for the editor.
 * Returns the lint gutter (empty until diagnostics are pushed).
 */
export function diagnosticsExtensions() {
  return [diagnosticsCompartment.of(lintGutter())];
}

/**
 * Maps LSP severity to CodeMirror lint severity.
 * LSP: 1=Error, 2=Warning, 3=Information, 4=Hint
 */
function mapSeverity(lspSeverity?: number): 'error' | 'warning' | 'info' {
  switch (lspSeverity) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    default:
      return 'info';
  }
}

/**
 * Converts LSP diagnostics into CodeMirror Diagnostic objects for the given document.
 * Clamps positions to valid document bounds.
 */
export function lspToCMDiagnostics(
  lspDiagnostics: LSPDiagnostic[],
  doc: { length: number; line: (n: number) => { from: number; to: number }; lines: number }
): Diagnostic[] {
  const result: Diagnostic[] = [];

  for (const diag of lspDiagnostics) {
    // LSP lines are 0-based, CodeMirror doc.line() is 1-based
    const startLine = Math.min(diag.range.start.line + 1, doc.lines);
    const endLine = Math.min(diag.range.end.line + 1, doc.lines);

    const startLineInfo = doc.line(startLine);
    const endLineInfo = doc.line(endLine);

    const from = Math.min(startLineInfo.from + diag.range.start.character, startLineInfo.to);
    const to = Math.min(endLineInfo.from + diag.range.end.character, endLineInfo.to);

    // Build message with optional source/code
    let message = diag.message;
    if (diag.source || diag.code !== undefined) {
      const suffix = [diag.source, diag.code !== undefined ? String(diag.code) : null]
        .filter(Boolean)
        .join(' ');
      if (suffix) {
        message = `${message} [${suffix}]`;
      }
    }

    result.push({
      from: Math.max(0, from),
      to: Math.max(from, Math.min(to, doc.length)),
      severity: mapSeverity(diag.severity),
      message,
    });
  }

  return result;
}

/**
 * Pushes LSP diagnostics into a CodeMirror EditorView via the lint system.
 * This replaces all current diagnostics for the document.
 */
export function updateEditorDiagnostics(view: EditorView, lspDiagnostics: LSPDiagnostic[]): void {
  const cmDiags = lspToCMDiagnostics(lspDiagnostics, view.state.doc);
  view.dispatch(cmSetDiagnostics(view.state, cmDiags));
}

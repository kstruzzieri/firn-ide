/**
 * CodeMirror LSP Completion Integration
 *
 * Registers an LSP completion source via a reconfigurable compartment.
 * The source is added additively alongside language-mode completions
 * using EditorState.languageData (not autocompletion({ override })).
 */

import { Compartment, EditorState } from '@codemirror/state';
import {
  type CompletionContext,
  type CompletionResult,
  type Completion,
  snippet,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { LSPComplete } from '../../../../wailsjs/go/main/App';
import { decodeLSPContent } from '../../../utils/lspContent';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Compartment for the LSP completion source. Empty when no LSP is active. */
export const completionCompartment = new Compartment();

/**
 * Returns the initial (empty) completion extensions.
 * When LSP becomes ready, reconfigure with `reconfigureCompletion()`.
 */
export function completionExtensions() {
  return [completionCompartment.of([])];
}

/**
 * Builds the extension value to reconfigure the completion compartment
 * when an LSP server becomes ready. Registers the LSP source additively
 * alongside existing language-mode completions via languageData facet.
 */
export function reconfigureCompletion(filePath: string, triggerCharacters: string[]) {
  const triggerSet = new Set(triggerCharacters);
  const source = createLSPCompletionSource(filePath, triggerSet);
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}

// --- Completion Source ---

function createLSPCompletionSource(filePath: string, triggerChars: Set<string>) {
  return async function lspCompletionSource(
    ctx: CompletionContext
  ): Promise<CompletionResult | null> {
    const { pos, explicit } = ctx;
    const lineText = ctx.state.doc.lineAt(pos);
    const charBefore = pos > lineText.from ? ctx.state.sliceDoc(pos - 1, pos) : '';

    let triggerCharacter = '';
    if (!explicit && triggerChars.has(charBefore)) {
      triggerCharacter = charBefore;
    } else if (!explicit) {
      const word = ctx.matchBefore(/\w+/);
      if (!word) return null;
    }

    const line = lineText.number - 1;
    const character = pos - lineText.from;

    let result;
    try {
      result = await LSPComplete(filePath, line, character, triggerCharacter);
    } catch {
      return null;
    }

    if (!result || !result.items || result.items.length === 0) return null;

    const completions: Completion[] = result.items.map((item) => {
      const completion: Completion & { firnKind?: number } = {
        label: item.label,
        detail: item.detail || undefined,
        boost: 1,
      };

      if (item.kind) {
        completion.firnKind = item.kind;
      }

      if (item.documentation && item.documentation.length > 0) {
        completion.info = () => {
          const content = decodeLSPContent(item.documentation);
          if (!content) return null;
          const div = document.createElement('div');
          div.className = 'firn-completion-info';
          if (item.detail) {
            const header = document.createElement('div');
            header.className = 'firn-completion-info-header';
            header.textContent = `${item.label} — ${item.detail}`;
            div.appendChild(header);
          }
          const body = document.createElement('div');
          body.className = 'firn-completion-info-body';
          body.textContent = content.value;
          div.appendChild(body);
          return div;
        };
      }

      const insertionText = item.textEdit?.newText ?? item.insertText ?? item.label;
      const isSnippet = item.insertTextFormat === 2;

      if (item.textEdit) {
        const { range } = item.textEdit;
        completion.apply = (
          view: EditorView,
          _completion: Completion,
          _from: number,
          _to: number
        ) => {
          const doc = view.state.doc;
          const startLine = doc.line(range.start.line + 1);
          const endLine = doc.line(range.end.line + 1);
          const editFrom = startLine.from + range.start.character;
          const editTo = endLine.from + range.end.character;

          if (isSnippet) {
            snippet(insertionText)(view, _completion, editFrom, editTo);
          } else {
            view.dispatch({
              changes: { from: editFrom, to: editTo, insert: insertionText },
              selection: { anchor: editFrom + insertionText.length },
            });
          }
        };
      } else if (isSnippet) {
        completion.apply = (
          view: EditorView,
          _completion: Completion,
          from: number,
          to: number
        ) => {
          snippet(insertionText)(view, _completion, from, to);
        };
      }

      return completion;
    });

    const word = ctx.matchBefore(/\w*/);
    const from = word ? word.from : pos;

    return {
      from,
      options: completions,
      validFor: result.isIncomplete ? undefined : /^\w*$/,
    };
  };
}

// --- Kind Icons (built with safe DOM methods, no innerHTML) ---

const KIND_ICONS: Record<number, { letter: string; color: string }> = {
  2: { letter: 'M', color: '#FDA4AF' },
  3: { letter: 'F', color: '#7DD3FC' },
  4: { letter: 'N', color: '#FDE68A' },
  5: { letter: 'f', color: '#94A3B8' },
  6: { letter: 'V', color: '#C4B5FD' },
  7: { letter: 'C', color: '#FCD34D' },
  8: { letter: 'I', color: '#86EFAC' },
  9: { letter: 'm', color: '#38BDF8' },
  10: { letter: 'P', color: '#94A3B8' },
  13: { letter: 'E', color: '#F9A8D4' },
  14: { letter: 'K', color: '#FDBA74' },
  15: { letter: 'S', color: '#A5B4FC' },
  21: { letter: 'c', color: '#67E8F9' },
  25: { letter: 'T', color: '#FDA4AF' },
};

function createKindSvg(config: { letter: string; color: string }): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', '1');
  rect.setAttribute('y', '1');
  rect.setAttribute('width', '14');
  rect.setAttribute('height', '14');
  rect.setAttribute('rx', '3');
  rect.setAttribute('fill', config.color);
  rect.setAttribute('opacity', '0.18');
  svg.appendChild(rect);

  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', '8');
  text.setAttribute('y', '11.5');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '10');
  text.setAttribute('font-weight', '600');
  text.setAttribute('font-family', 'monospace');
  text.setAttribute('fill', config.color);
  text.textContent = config.letter;
  svg.appendChild(text);

  return svg;
}

function createFallbackSvg(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '8');
  circle.setAttribute('cy', '8');
  circle.setAttribute('r', '3');
  circle.setAttribute('fill', '#64748B');
  svg.appendChild(circle);

  return svg;
}

export function renderKindIcon(completion: Completion): HTMLElement | null {
  const kind = (completion as Completion & { firnKind?: number }).firnKind;

  const span = document.createElement('span');
  span.className = 'firn-completion-icon';
  span.setAttribute('aria-hidden', 'true');

  const config = kind ? KIND_ICONS[kind] : undefined;
  span.appendChild(config ? createKindSvg(config) : createFallbackSvg());

  return span;
}

import { Compartment } from '@codemirror/state';
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { LSPHover, LSPDefinition } from '../../../../wailsjs/go/main/App';
import { ClipboardSetText } from '../../../../wailsjs/runtime/runtime';
import { decodeLSPContent } from '../../../utils/lspContent';
import { fileURIToPath } from '../../../utils/lspUri';
import { navigateToEditorLocation } from '../../../utils/editorNavigation';

/** Compartment for the LSP hover tooltip. Empty when no LSP is active. */
export const hoverCompartment = new Compartment();

export function hoverExtensions() {
  return [hoverCompartment.of([])];
}

export function reconfigureHover(filePath: string) {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      const line = view.state.doc.lineAt(pos);
      const lspLine = line.number - 1;
      const lspChar = pos - line.from;

      let result;
      try {
        result = await LSPHover(filePath, lspLine, lspChar);
      } catch {
        return null;
      }

      if (!result || !result.contents) return null;

      const content = decodeLSPContent(result.contents as unknown as number[]);
      if (!content) return null;

      const wordRange = view.state.wordAt(pos);
      const from = wordRange ? wordRange.from : pos;

      return {
        pos: from,
        above: true,
        create: () => {
          const dom = createHoverTooltipDOM(content.value, filePath, lspLine, lspChar);
          return { dom };
        },
      };
    },
    { hideOnChange: true }
  );
}

function createHoverTooltipDOM(
  rawContent: string,
  filePath: string,
  line: number,
  character: number
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'firn-hover-tooltip';

  const { signature, docs } = splitSignatureAndDocs(rawContent);

  if (signature) {
    const sigDiv = document.createElement('div');
    sigDiv.className = 'firn-hover-signature';
    renderHighlightedSignature(sigDiv, signature);
    container.appendChild(sigDiv);
  }

  if (signature && docs) {
    const sep = document.createElement('div');
    sep.className = 'firn-hover-separator';
    container.appendChild(sep);
  }

  if (docs) {
    const docsDiv = document.createElement('div');
    docsDiv.className = 'firn-hover-docs';
    renderDocumentation(docsDiv, docs);
    container.appendChild(docsDiv);
  }

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'firn-hover-actions';

  const goToDef = document.createElement('a');
  goToDef.className = 'firn-hover-action';
  goToDef.textContent = 'Go to Definition';
  goToDef.href = '#';
  goToDef.addEventListener('click', (e) => {
    e.preventDefault();
    LSPDefinition(filePath, line, character)
      .then((locations) => {
        if (!locations || locations.length === 0) return;
        const loc = locations[0];
        const path = fileURIToPath(loc.uri);
        if (path) {
          navigateToEditorLocation(path, loc.range.start.line + 1, loc.range.start.character + 1);
        }
      })
      .catch(() => {});
  });
  actionsDiv.appendChild(goToDef);

  const copyType = document.createElement('a');
  copyType.className = 'firn-hover-action';
  copyType.textContent = 'Copy Type';
  copyType.href = '#';
  copyType.addEventListener('click', (e) => {
    e.preventDefault();
    ClipboardSetText(signature || rawContent);
  });
  actionsDiv.appendChild(copyType);

  container.appendChild(actionsDiv);

  return container;
}

function splitSignatureAndDocs(content: string): { signature: string; docs: string } {
  const codeBlockMatch = content.match(/^```[\w]*\n([\s\S]*?)```\n?([\s\S]*)$/);
  if (codeBlockMatch) {
    return {
      signature: codeBlockMatch[1].trim(),
      docs: codeBlockMatch[2].trim(),
    };
  }

  const firstNewline = content.indexOf('\n');
  if (firstNewline === -1) {
    return { signature: content, docs: '' };
  }
  return {
    signature: content.slice(0, firstNewline).trim(),
    docs: content.slice(firstNewline + 1).trim(),
  };
}

const HIGHLIGHT_RULES: Array<{ pattern: RegExp; className: string }> = [
  {
    pattern:
      /\b(const|let|var|function|class|type|interface|enum|import|export|from|extends|implements|return|if|else|for|while|new|async|await|readonly|static|public|private|protected|abstract|declare|namespace|module)\b/g,
    className: 'firn-hover-keyword',
  },
  { pattern: /(?<=:\s*|<|,\s*)\b[A-Z]\w*/g, className: 'firn-hover-type' },
  { pattern: /\b\w+(?=\s*\()/g, className: 'firn-hover-function' },
  { pattern: /(["'`])(?:(?!\1).)*\1/g, className: 'firn-hover-string' },
  // eslint-disable-next-line no-useless-escape
  { pattern: /[{}()\[\]<>:;,=&|?!.]/g, className: 'firn-hover-punctuation' },
];

function renderHighlightedSignature(container: HTMLElement, text: string): void {
  const pre = document.createElement('pre');
  pre.className = 'firn-hover-code';

  const charStyles = new Array(text.length).fill('');

  for (const rule of HIGHLIGHT_RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      for (let i = match.index; i < match.index + match[0].length; i++) {
        if (!charStyles[i]) {
          charStyles[i] = rule.className;
        }
      }
    }
  }

  let currentClass = charStyles[0] || '';
  let currentText = text[0] || '';

  for (let i = 1; i < text.length; i++) {
    const cls = charStyles[i] || '';
    if (cls === currentClass) {
      currentText += text[i];
    } else {
      appendSpan(pre, currentText, currentClass);
      currentClass = cls;
      currentText = text[i];
    }
  }
  if (currentText) {
    appendSpan(pre, currentText, currentClass);
  }

  container.appendChild(pre);
}

function appendSpan(parent: HTMLElement, text: string, className: string): void {
  if (className) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    parent.appendChild(span);
  } else {
    parent.appendChild(document.createTextNode(text));
  }
}

function renderDocumentation(container: HTMLElement, text: string): void {
  const parts = text.split(/(```[\w]*\n[\s\S]*?```)/g);

  for (const part of parts) {
    const codeMatch = part.match(/^```[\w]*\n([\s\S]*?)```$/);
    if (codeMatch) {
      const pre = document.createElement('pre');
      pre.className = 'firn-hover-doc-code';
      pre.textContent = codeMatch[1].trim();
      container.appendChild(pre);
    } else if (part.trim()) {
      const p = document.createElement('div');
      p.className = 'firn-hover-doc-text';
      renderDocText(p, part.trim());
      container.appendChild(p);
    }
  }
}

function renderDocText(container: HTMLElement, text: string): void {
  const lines = text.split('\n');
  for (const line of lines) {
    const tagMatch = line.match(/^(\s*@\w+)/);
    if (tagMatch) {
      const span = document.createElement('span');
      span.className = 'firn-hover-doc-tag';
      span.textContent = tagMatch[1];
      container.appendChild(span);
      container.appendChild(document.createTextNode(line.slice(tagMatch[1].length) + '\n'));
    } else {
      container.appendChild(document.createTextNode(line + '\n'));
    }
  }
}

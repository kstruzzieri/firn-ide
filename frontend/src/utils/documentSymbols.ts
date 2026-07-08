/**
 * Document-symbol helpers for the Structure view (issue #168).
 *
 * Pure functions only — kind→glyph mapping and tree filtering — so they can be
 * unit-tested without React or the Wails bridge. The node shape mirrors the
 * backend `lsp.DocumentSymbol` (normalized; SymbolInformation is flattened into
 * this same shape server-side).
 */

export interface SymbolRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface DocumentSymbolNode {
  name: string;
  detail?: string;
  kind: number;
  range: SymbolRange;
  selectionRange: SymbolRange;
  children?: DocumentSymbolNode[];
}

export interface SymbolKindMeta {
  /** Single-character badge glyph shown in the tree. */
  glyph: string;
  /** CSS-module class controlling the badge color. */
  className: string;
  /** Human label for tooltips/accessibility. */
  label: string;
}

// LSP SymbolKind codes (1-26). Glyphs are chosen for at-a-glance legibility:
// function (F) and field (●) deliberately differ so they never collide.
const KIND_META: Record<number, SymbolKindMeta> = {
  1: { glyph: '⊡', className: 'kFile', label: 'File' },
  2: { glyph: 'M', className: 'kModule', label: 'Module' },
  3: { glyph: 'N', className: 'kNamespace', label: 'Namespace' },
  4: { glyph: 'P', className: 'kNamespace', label: 'Package' },
  5: { glyph: 'C', className: 'kClass', label: 'Class' },
  6: { glyph: 'M', className: 'kMethod', label: 'Method' },
  7: { glyph: 'P', className: 'kProperty', label: 'Property' },
  8: { glyph: 'f', className: 'kField', label: 'Field' },
  9: { glyph: 'C', className: 'kMethod', label: 'Constructor' },
  10: { glyph: 'E', className: 'kEnum', label: 'Enum' },
  11: { glyph: 'I', className: 'kInterface', label: 'Interface' },
  12: { glyph: 'ƒ', className: 'kFunction', label: 'Function' },
  13: { glyph: 'v', className: 'kVariable', label: 'Variable' },
  14: { glyph: 'k', className: 'kConstant', label: 'Constant' },
  15: { glyph: 's', className: 'kString', label: 'String' },
  16: { glyph: '#', className: 'kNumber', label: 'Number' },
  17: { glyph: 'b', className: 'kBoolean', label: 'Boolean' },
  18: { glyph: '[]', className: 'kArray', label: 'Array' },
  19: { glyph: '{}', className: 'kObject', label: 'Object' },
  20: { glyph: 'k', className: 'kProperty', label: 'Key' },
  21: { glyph: '∅', className: 'kNull', label: 'Null' },
  22: { glyph: 'e', className: 'kEnum', label: 'EnumMember' },
  23: { glyph: 'S', className: 'kStruct', label: 'Struct' },
  24: { glyph: '⚡', className: 'kEvent', label: 'Event' },
  25: { glyph: '±', className: 'kOperator', label: 'Operator' },
  26: { glyph: 'T', className: 'kTypeParam', label: 'TypeParameter' },
};

const FALLBACK_META: SymbolKindMeta = { glyph: '•', className: 'kUnknown', label: 'Symbol' };

/** Returns the badge metadata for an LSP SymbolKind, with a safe fallback. */
export function symbolKindMeta(kind: number): SymbolKindMeta {
  return KIND_META[kind] ?? FALLBACK_META;
}

/**
 * Filters a symbol tree by a case-insensitive substring query.
 *
 * - Empty/whitespace query returns the original tree by reference (no copy).
 * - A node whose own name matches keeps its entire subtree.
 * - A non-matching node is kept only if a descendant matches, and then only its
 *   matching branches survive (VS Code Outline filter behavior).
 */
export function filterSymbolTree(
  symbols: DocumentSymbolNode[],
  query: string
): DocumentSymbolNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return symbols;

  const walk = (nodes: DocumentSymbolNode[]): DocumentSymbolNode[] => {
    const out: DocumentSymbolNode[] = [];
    for (const node of nodes) {
      const selfMatch = node.name.toLowerCase().includes(q);
      if (selfMatch) {
        // Keep the whole subtree so users see everything under a matched symbol.
        out.push(node);
        continue;
      }
      const keptChildren = node.children ? walk(node.children) : [];
      if (keptChildren.length > 0) {
        out.push({ ...node, children: keptChildren });
      }
    }
    return out;
  };

  return walk(symbols);
}

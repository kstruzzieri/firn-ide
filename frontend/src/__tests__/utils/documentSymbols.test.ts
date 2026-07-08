import {
  symbolKindMeta,
  filterSymbolTree,
  type DocumentSymbolNode,
} from '../../utils/documentSymbols';

function sym(name: string, kind: number, children: DocumentSymbolNode[] = []): DocumentSymbolNode {
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  return { name, kind, range, selectionRange: range, children };
}

describe('symbolKindMeta', () => {
  it('maps known LSP kinds to a glyph, class, and label', () => {
    const cls = symbolKindMeta(5); // Class
    expect(cls.label).toBe('Class');
    expect(cls.glyph).toBeTruthy();
    expect(cls.className).toBeTruthy();

    expect(symbolKindMeta(12).label).toBe('Function');
    expect(symbolKindMeta(6).label).toBe('Method');
    expect(symbolKindMeta(11).label).toBe('Interface');
  });

  it('distinguishes function and field glyphs (readability fix)', () => {
    // Function and field must not collide on the same glyph.
    expect(symbolKindMeta(12).glyph).not.toBe(symbolKindMeta(8).glyph);
  });

  it('falls back gracefully for unknown kinds', () => {
    const meta = symbolKindMeta(999);
    expect(meta.label).toBe('Symbol');
    expect(meta.glyph).toBeTruthy();
    expect(meta.className).toBeTruthy();
  });
});

describe('filterSymbolTree', () => {
  const tree: DocumentSymbolNode[] = [
    sym('ProfileRunner', 5, [
      sym('start', 6),
      sym('stop', 6),
      sym('handleExit', 6, [sym('nextStatus', 13)]),
    ]),
    sym('detectProfiles', 12),
  ];

  it('returns the tree unchanged for an empty query', () => {
    expect(filterSymbolTree(tree, '')).toBe(tree);
    expect(filterSymbolTree(tree, '   ')).toBe(tree);
  });

  it('keeps a node and its full subtree when the node name matches', () => {
    const out = filterSymbolTree(tree, 'ProfileRunner');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('ProfileRunner');
    // Matching node keeps all descendants
    expect(out[0].children).toHaveLength(3);
  });

  it('keeps ancestors when a descendant matches, pruning non-matching siblings', () => {
    const out = filterSymbolTree(tree, 'nextStatus');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('ProfileRunner');
    // Only the branch leading to the match survives
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children![0].name).toBe('handleExit');
    expect(out[0].children![0].children![0].name).toBe('nextStatus');
  });

  it('matches case-insensitively and by substring', () => {
    const out = filterSymbolTree(tree, 'PROFILE');
    // Matches both 'ProfileRunner' and 'detectProfiles'
    expect(out.map((s) => s.name).sort()).toEqual(['ProfileRunner', 'detectProfiles']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterSymbolTree(tree, 'zzzz')).toHaveLength(0);
  });
});

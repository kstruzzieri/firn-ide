import {
  SYNTAX_THEMES,
  SYNTAX_THEME_BY_ID,
  DEFAULT_SYNTAX_THEME_ID,
  getSyntaxPalette,
  isSyntaxThemeId,
  type SyntaxPalette,
  type SyntaxThemeId,
} from '../../../../components/Editor/codemirror/palettes';

const ROLES: (keyof SyntaxPalette)[] = [
  'background',
  'comment',
  'keyword',
  'string',
  'number',
  'function',
  'type',
  'constant',
  'operator',
  'punctuation',
  'variable',
  'property',
  'regexp',
  'tag',
  'attribute',
  'escape',
];

// Relative luminance + contrast ratio (WCAG) for the comment-contrast guard.
function luminance(hex: string): number {
  const m = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('syntax palette registry', () => {
  it('exposes 7 themes in a stable order', () => {
    expect(SYNTAX_THEMES.map((t) => t.id)).toEqual([
      'glacier',
      'solar',
      'reef',
      'nebula',
      'bifrost',
      'aurora',
      'abyssal',
    ]);
  });

  it('default theme id exists in the registry', () => {
    expect(SYNTAX_THEME_BY_ID.has(DEFAULT_SYNTAX_THEME_ID)).toBe(true);
    expect(DEFAULT_SYNTAX_THEME_ID).toBe('abyssal');
  });

  it('every theme defines every palette role as a non-empty string', () => {
    for (const theme of SYNTAX_THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      for (const role of ROLES) {
        expect(typeof theme.palette[role]).toBe('string');
        expect(theme.palette[role].length).toBeGreaterThan(0);
      }
    }
  });

  it('has unique ids and a lookup map covering all themes', () => {
    const ids = SYNTAX_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(SYNTAX_THEME_BY_ID.get(id as SyntaxThemeId)?.id).toBe(id);
    }
  });

  it('never makes number and constant byte-identical within a theme', () => {
    for (const theme of SYNTAX_THEMES) {
      expect(theme.palette.number.toLowerCase()).not.toBe(theme.palette.constant.toLowerCase());
    }
  });

  it('keeps comment contrast at or above 4:1 on each theme canvas', () => {
    for (const theme of SYNTAX_THEMES) {
      const ratio = contrast(theme.palette.comment, theme.palette.background);
      expect(ratio).toBeGreaterThanOrEqual(4);
    }
  });

  it('isSyntaxThemeId guards unknown values', () => {
    expect(isSyntaxThemeId('abyssal')).toBe(true);
    expect(isSyntaxThemeId('nope')).toBe(false);
    expect(isSyntaxThemeId(null)).toBe(false);
    expect(isSyntaxThemeId(42)).toBe(false);
  });

  it('getSyntaxPalette returns the matching palette and falls back to the default for unknown ids', () => {
    expect(getSyntaxPalette('reef')).toBe(SYNTAX_THEME_BY_ID.get('reef')!.palette);
    // Unknown id falls back to the default (abyssal) palette.
    expect(getSyntaxPalette('does-not-exist' as SyntaxThemeId)).toBe(
      SYNTAX_THEME_BY_ID.get(DEFAULT_SYNTAX_THEME_ID)!.palette
    );
  });
});

import { tags as t } from '@lezer/highlight';
import { HighlightStyle } from '@codemirror/language';
import {
  buildHighlightSpec,
  buildHighlightStyle,
  firnGlacierHighlightStyle,
  buildChromeRules,
  buildTheme,
  defaultEditorTheme,
  firnGlacier,
  firnGlacierTheme,
} from '../../../../components/Editor/codemirror/theme';
import { getSyntaxPalette } from '../../../../components/Editor/codemirror/palettes';

describe('highlight-style builders', () => {
  it('maps token roles to the supplied palette colors', () => {
    const palette = getSyntaxPalette('abyssal');
    const spec = buildHighlightSpec(palette);
    const colorFor = (tag: unknown) => spec.find((s) => s.tag === tag)?.color;

    expect(colorFor(t.keyword)).toBe(palette.keyword);
    expect(colorFor(t.comment)).toBe(palette.comment);
    expect(colorFor(t.string)).toBe(palette.string);
    expect(colorFor(t.number)).toBe(palette.number);
    expect(colorFor(t.typeName)).toBe(palette.type);
    expect(colorFor(t.regexp)).toBe(palette.regexp);
    // Compound tag (most likely to be mis-nested) — function(variableName).
    expect(colorFor(t.function(t.variableName))).toBe(palette.function);
  });

  it('builds a defined HighlightStyle for every palette', () => {
    for (const id of [
      'glacier',
      'solar',
      'reef',
      'nebula',
      'bifrost',
      'aurora',
      'abyssal',
    ] as const) {
      expect(buildHighlightStyle(getSyntaxPalette(id))).toBeInstanceOf(HighlightStyle);
    }
  });

  it('keeps the legacy firnGlacierHighlightStyle export', () => {
    expect(firnGlacierHighlightStyle).toBeInstanceOf(HighlightStyle);
  });
});

describe('buildChromeRules', () => {
  it('uses the supplied background for canvas and gutters', () => {
    const rules = buildChromeRules('#08111C');
    expect((rules['&'] as Record<string, string>).backgroundColor).toBe('#08111C');
    expect((rules['.cm-gutters'] as Record<string, string>).backgroundColor).toBe('#08111C');
  });
});

describe('buildTheme', () => {
  it('returns a defined extension for every theme id', () => {
    for (const id of [
      'glacier',
      'solar',
      'reef',
      'nebula',
      'bifrost',
      'aurora',
      'abyssal',
    ] as const) {
      expect(buildTheme(id)).toBeDefined();
    }
  });

  it('keeps legacy theme exports defined', () => {
    expect(defaultEditorTheme).toBeDefined();
    expect(firnGlacier).toBeDefined();
    expect(firnGlacierTheme).toBeDefined();
  });
});

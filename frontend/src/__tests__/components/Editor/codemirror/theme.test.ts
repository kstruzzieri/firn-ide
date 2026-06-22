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
    // Decorator marker (@) — t.meta — must map to the function color.
    expect(colorFor(t.meta)).toBe(palette.function);
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
  it('uses the palette background for canvas and gutters', () => {
    const rules = buildChromeRules(getSyntaxPalette('abyssal'));
    expect((rules['&'] as Record<string, string>).backgroundColor).toBe('#08111C');
    expect((rules['.cm-gutters'] as Record<string, string>).backgroundColor).toBe('#08111C');
    // Guard against accidental truncation of the chrome rule set.
    expect(Object.keys(rules).length).toBeGreaterThan(20);
  });

  it('colours the python overlay token classes from the palette', () => {
    const palette = getSyntaxPalette('abyssal');
    const rules = buildChromeRules(palette);
    expect((rules['.firn-tok-self'] as Record<string, string>).color).toBe(palette.keyword);
    expect((rules['.firn-tok-builtin'] as Record<string, string>).color).toBe(palette.type);
    expect((rules['.firn-tok-decorator'] as Record<string, string>).color).toBe(palette.function);
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

describe('#113 diagnostic tooltip surface', () => {
  const rules = buildChromeRules(getSyntaxPalette('glacier'));

  it('gives the lint tooltip an opaque surface', () => {
    const lint = rules['.cm-tooltip-lint'] as Record<string, string>;
    expect(lint).toBeDefined();
    expect(lint.backgroundColor).toBeDefined();
    expect(lint.backgroundColor).not.toBe('transparent');
    expect(lint.backgroundColor).toBe('#1E293B'); // colors.surface
    expect(lint.border).toBeDefined();
    expect(lint.boxShadow).toBeDefined();
    expect(lint.padding).toBeDefined();
  });

  it('styles diagnostics and per-severity accents', () => {
    expect(rules['.cm-diagnostic']).toBeDefined();
    const error = rules['.cm-diagnostic-error'] as Record<string, string>;
    const warning = rules['.cm-diagnostic-warning'] as Record<string, string>;
    const info = rules['.cm-diagnostic-info'] as Record<string, string>;
    expect(error.borderLeft).toContain('#EF4444');
    expect(warning.borderLeft).toContain('#F59E0B');
    expect(info.borderLeft).toContain('#3B82F6');
    const hint = rules['.cm-diagnostic-hint'] as Record<string, string>;
    expect(hint.borderLeft).toContain('#64748B');
  });
});

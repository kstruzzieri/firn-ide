import { tags as t } from '@lezer/highlight';
import {
  buildHighlightSpec,
  buildHighlightStyle,
  firnGlacierHighlightStyle,
} from '../../../../components/Editor/codemirror/theme';
import { getSyntaxPalette } from '../../../../components/Editor/codemirror/palettes';

describe('buildHighlightSpec', () => {
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
      expect(buildHighlightStyle(getSyntaxPalette(id))).toBeDefined();
    }
  });

  it('keeps the legacy firnGlacierHighlightStyle export', () => {
    expect(firnGlacierHighlightStyle).toBeDefined();
  });
});

import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import {
  searchTokenHighlighter,
  SEARCH_TOKEN_ROLES,
  parseLineTokens,
  MAX_SEARCH_HIGHLIGHT_CHARS,
  MAX_SEARCH_TOKEN_RANGES,
} from '../../utils/searchTokens';

const tsSupport = javascript({ typescript: true });

describe('searchTokenHighlighter', () => {
  it('maps representative tags to tok-<role> classes', () => {
    expect(searchTokenHighlighter.style([t.keyword])).toBe('tok-keyword');
    expect(searchTokenHighlighter.style([t.string])).toBe('tok-string');
    expect(searchTokenHighlighter.style([t.lineComment])).toBe('tok-comment');
    expect(searchTokenHighlighter.style([t.number])).toBe('tok-number');
    expect(searchTokenHighlighter.style([t.typeName])).toBe('tok-type');
    expect(searchTokenHighlighter.style([t.propertyName])).toBe('tok-property');
    expect(searchTokenHighlighter.style([t.tagName])).toBe('tok-tag');
    expect(searchTokenHighlighter.style([t.attributeName])).toBe('tok-attribute');
    expect(searchTokenHighlighter.style([t.regexp])).toBe('tok-regexp');
    expect(searchTokenHighlighter.style([t.escape])).toBe('tok-escape');
    expect(searchTokenHighlighter.style([t.meta])).toBe('tok-decorator');
    expect(searchTokenHighlighter.style([t.operator])).toBe('tok-operator');
    expect(searchTokenHighlighter.style([t.punctuation])).toBe('tok-punctuation');
  });

  it('prefers the function role over the base variable role', () => {
    expect(searchTokenHighlighter.style([t.function(t.variableName)])).toBe('tok-function');
    expect(searchTokenHighlighter.style([t.variableName])).toBe('tok-variable');
  });

  it('collapses bool/null/atom to the constant role', () => {
    expect(searchTokenHighlighter.style([t.bool])).toBe('tok-constant');
    expect(searchTokenHighlighter.style([t.null])).toBe('tok-constant');
    expect(searchTokenHighlighter.style([t.atom])).toBe('tok-constant');
  });

  it('exposes exactly the 16 emitted roles', () => {
    expect([...SEARCH_TOKEN_ROLES].sort()).toEqual(
      [
        'attribute',
        'comment',
        'constant',
        'decorator',
        'escape',
        'function',
        'keyword',
        'number',
        'operator',
        'property',
        'punctuation',
        'regexp',
        'string',
        'tag',
        'type',
        'variable',
      ].sort()
    );
  });
});

describe('parseLineTokens', () => {
  it('returns ordered role ranges for a TypeScript line', () => {
    const line = 'const answer = 42;';
    const tokens = parseLineTokens(line, tsSupport);
    expect(tokens).not.toBeNull();
    for (let i = 1; i < tokens!.length; i++) {
      expect(tokens![i].from).toBeGreaterThanOrEqual(tokens![i - 1].to);
    }
    const classes = tokens!.map((r) => r.className);
    expect(classes).toContain('tok-keyword'); // const
    expect(classes).toContain('tok-number'); // 42
    expect(tokens!.every((r) => r.className.length > 0)).toBe(true);
  });

  it('skips parsing lines longer than the character ceiling', () => {
    const line = 'a'.repeat(MAX_SEARCH_HIGHLIGHT_CHARS + 1);
    expect(parseLineTokens(line, tsSupport)).toBeNull();
  });

  it('falls back to null when a line exceeds the token-range ceiling', () => {
    const line = 'a+'.repeat(MAX_SEARCH_TOKEN_RANGES + 10);
    expect(line.length).toBeLessThanOrEqual(MAX_SEARCH_HIGHLIGHT_CHARS);
    expect(parseLineTokens(line, tsSupport)).toBeNull();
  });

  it('returns null when the parser throws', () => {
    const broken = {
      language: {
        parser: {
          parse() {
            throw new Error('boom');
          },
        },
      },
    } as unknown as typeof tsSupport;
    expect(parseLineTokens('anything', broken)).toBeNull();
  });
});

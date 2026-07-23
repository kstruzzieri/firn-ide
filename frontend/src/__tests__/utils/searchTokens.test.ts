import { tags as t } from '@lezer/highlight';
import { searchTokenHighlighter, SEARCH_TOKEN_ROLES } from '../../utils/searchTokens';

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

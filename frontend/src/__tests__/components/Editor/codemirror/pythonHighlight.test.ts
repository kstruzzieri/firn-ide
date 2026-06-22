import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import {
  PY_BUILTINS,
  PY_SELF_NAMES,
  pythonTokenClass,
  collectPythonMarks,
  pythonHighlightExtensions,
  type PythonTokenContext,
} from '../../../../components/Editor/codemirror/pythonHighlight';

const ctx = (over: Partial<PythonTokenContext> = {}): PythonTokenContext => ({
  decoratorName: false,
  kwargName: false,
  ...over,
});

describe('pythonTokenClass', () => {
  it('classifies self and cls as self', () => {
    expect(pythonTokenClass('VariableName', 'self', ctx())).toBe('firn-tok-self');
    expect(pythonTokenClass('VariableName', 'cls', ctx())).toBe('firn-tok-self');
  });

  it('classifies builtin types/functions as builtin', () => {
    for (const name of ['dict', 'str', 'float', 'int', 'list', 'len', 'print']) {
      expect(pythonTokenClass('VariableName', name, ctx())).toBe('firn-tok-builtin');
    }
  });

  it('lets decorator and kwarg context win, even for builtin names', () => {
    expect(pythonTokenClass('VariableName', 'property', ctx({ decoratorName: true }))).toBe(
      'firn-tok-decorator'
    );
    expect(pythonTokenClass('PropertyName', 'route', ctx({ decoratorName: true }))).toBe(
      'firn-tok-decorator'
    );
    expect(pythonTokenClass('VariableName', 'id', ctx({ kwargName: true }))).toBe('firn-tok-param');
  });

  it('leaves ordinary identifiers and non-decorator property names alone', () => {
    expect(pythonTokenClass('VariableName', 'my_var', ctx())).toBeNull();
    expect(pythonTokenClass('PropertyName', 'value', ctx())).toBeNull();
  });

  it('exposes the builtin and self name sets', () => {
    expect(PY_BUILTINS.has('dict')).toBe(true);
    expect(PY_BUILTINS.has('float')).toBe(true);
    expect(PY_SELF_NAMES.has('self')).toBe(true);
    expect(PY_SELF_NAMES.has('cls')).toBe(true);
  });
});

describe('collectPythonMarks (syntax-tree walk)', () => {
  const doc = '@staticmethod\ndef f(self, x: dict):\n    return Foo(id=x)\n';
  const state = EditorState.create({ doc, extensions: [python()] });
  // Force a full parse — without a view, lezer parses lazily.
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  const marks = collectPythonMarks(state, tree);
  const textFor = (cls: string) =>
    marks.filter((mark) => mark.cls === cls).map((mark) => doc.slice(mark.from, mark.to));

  it('marks the decorator name (not just the @)', () => {
    expect(textFor('firn-tok-decorator')).toContain('staticmethod');
  });

  it('marks self', () => {
    expect(textFor('firn-tok-self')).toContain('self');
  });

  it('marks builtin types', () => {
    expect(textFor('firn-tok-builtin')).toContain('dict');
  });

  it('marks keyword-argument names', () => {
    expect(textFor('firn-tok-param')).toContain('id');
  });
});

describe('pythonHighlightExtensions', () => {
  it('returns a defined extension', () => {
    expect(pythonHighlightExtensions()).toBeDefined();
  });
});

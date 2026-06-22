import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import {
  PY_BUILTINS,
  PY_SELF_NAMES,
  pythonTokenClass,
  pythonHighlightExtensions,
} from '../../../../components/Editor/codemirror/pythonHighlight';

describe('pythonTokenClass', () => {
  it('classifies self and cls as self', () => {
    expect(pythonTokenClass('VariableName', 'self', false)).toBe('firn-tok-self');
    expect(pythonTokenClass('VariableName', 'cls', false)).toBe('firn-tok-self');
  });

  it('classifies builtin types/functions as builtin', () => {
    for (const name of ['dict', 'str', 'float', 'int', 'list', 'len', 'print']) {
      expect(pythonTokenClass('VariableName', name, false)).toBe('firn-tok-builtin');
    }
  });

  it('treats a decorator name as decorator even when it is also a builtin', () => {
    expect(pythonTokenClass('VariableName', 'property', true)).toBe('firn-tok-decorator');
    expect(pythonTokenClass('PropertyName', 'route', true)).toBe('firn-tok-decorator');
  });

  it('leaves ordinary identifiers and non-decorator property names alone', () => {
    expect(pythonTokenClass('VariableName', 'my_var', false)).toBeNull();
    expect(pythonTokenClass('PropertyName', 'value', false)).toBeNull();
  });

  it('exposes the builtin and self name sets', () => {
    expect(PY_BUILTINS.has('dict')).toBe(true);
    expect(PY_BUILTINS.has('float')).toBe(true);
    expect(PY_SELF_NAMES.has('self')).toBe(true);
    expect(PY_SELF_NAMES.has('cls')).toBe(true);
  });
});

describe('pythonHighlightExtensions', () => {
  it('mounts on a python document without throwing', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '@property\ndef f(self):\n    return dict()\n',
        extensions: [python(), pythonHighlightExtensions()],
      }),
    });
    expect(view).toBeDefined();
    view.destroy();
  });
});

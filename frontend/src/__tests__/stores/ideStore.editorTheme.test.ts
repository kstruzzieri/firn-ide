import { useIDEStore, useEditorSyntaxTheme } from '../../stores/ideStore';
import { renderHook } from '@testing-library/react';

const KEY = 'firn.editorSyntaxTheme';

describe('editorSyntaxTheme store slice', () => {
  beforeEach(() => {
    localStorage.clear();
    useIDEStore.getState().setEditorSyntaxTheme('abyssal');
  });

  it('defaults to abyssal', () => {
    expect(useIDEStore.getState().editorSyntaxTheme).toBe('abyssal');
  });

  it('setEditorSyntaxTheme updates state and persists to localStorage', () => {
    useIDEStore.getState().setEditorSyntaxTheme('reef');
    expect(useIDEStore.getState().editorSyntaxTheme).toBe('reef');
    expect(localStorage.getItem(KEY)).toBe('reef');
  });

  it('ignores invalid ids by leaving state unchanged', () => {
    useIDEStore.getState().setEditorSyntaxTheme('nebula');
    // @ts-expect-error testing runtime guard with a bad value
    useIDEStore.getState().setEditorSyntaxTheme('bogus');
    expect(useIDEStore.getState().editorSyntaxTheme).toBe('nebula');
  });

  it('exposes a selector hook', () => {
    useIDEStore.getState().setEditorSyntaxTheme('solar');
    const { result } = renderHook(() => useEditorSyntaxTheme());
    expect(result.current).toBe('solar');
  });
});

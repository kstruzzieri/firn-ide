import { useIDEStore } from '../../stores/ideStore';

// Reset store between tests
beforeEach(() => {
  useIDEStore.setState({
    openFiles: [],
    activeFileId: null,
    toast: null,
  });
});

describe('ideStore - editor actions', () => {
  it('should add lineEndings to opened files', () => {
    const { openFile } = useIDEStore.getState();
    openFile({
      id: '/test/file.ts',
      name: 'file.ts',
      path: '/test/file.ts',
      language: 'typescript',
      encoding: 'utf-8',
      lineEndings: 'LF',
      content: 'const x = 1;',
      isModified: false,
    });

    const file = useIDEStore.getState().openFiles[0];
    expect(file.lineEndings).toBe('LF');
  });

  it('should update file content and mark as modified', () => {
    const { openFile, updateFileContent } = useIDEStore.getState();
    openFile({
      id: '/test/file.ts',
      name: 'file.ts',
      path: '/test/file.ts',
      language: 'typescript',
      encoding: 'utf-8',
      lineEndings: 'LF',
      content: 'const x = 1;',
      isModified: false,
    });

    updateFileContent('/test/file.ts', 'const x = 2;');

    const file = useIDEStore.getState().openFiles[0];
    expect(file.content).toBe('const x = 2;');
    expect(file.isModified).toBe(true);
  });

  it('should not mark unmodified file when content is same', () => {
    const { openFile, updateFileContent } = useIDEStore.getState();
    openFile({
      id: '/test/file.ts',
      name: 'file.ts',
      path: '/test/file.ts',
      language: 'typescript',
      encoding: 'utf-8',
      lineEndings: 'LF',
      content: 'const x = 1;',
      isModified: false,
    });

    updateFileContent('/test/file.ts', 'const x = 1;');

    const file = useIDEStore.getState().openFiles[0];
    expect(file.isModified).toBe(false);
  });
});

describe('ideStore - toast', () => {
  it('should show and clear toast', () => {
    const { showToast } = useIDEStore.getState();
    showToast('Save failed', 'error');

    expect(useIDEStore.getState().toast).toEqual({
      message: 'Save failed',
      type: 'error',
    });
  });

  it('should clear toast', () => {
    const { showToast, clearToast } = useIDEStore.getState();
    showToast('Save failed', 'error');
    clearToast();

    expect(useIDEStore.getState().toast).toBeNull();
  });
});

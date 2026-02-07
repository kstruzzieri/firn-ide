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

describe('ideStore - panel collapse', () => {
  it('should start with all panels visible', () => {
    const state = useIDEStore.getState();
    expect(state.isLeftPanelCollapsed).toBe(false);
    expect(state.isRightPanelCollapsed).toBe(false);
    expect(state.isBottomPanelCollapsed).toBe(false);
  });

  it('should toggle left panel', () => {
    const { toggleLeftPanel } = useIDEStore.getState();
    toggleLeftPanel();
    expect(useIDEStore.getState().isLeftPanelCollapsed).toBe(true);
    toggleLeftPanel();
    expect(useIDEStore.getState().isLeftPanelCollapsed).toBe(false);
  });

  it('should toggle right panel', () => {
    const { toggleRightPanel } = useIDEStore.getState();
    toggleRightPanel();
    expect(useIDEStore.getState().isRightPanelCollapsed).toBe(true);
    toggleRightPanel();
    expect(useIDEStore.getState().isRightPanelCollapsed).toBe(false);
  });

  it('should toggle bottom panel', () => {
    const { toggleBottomPanel } = useIDEStore.getState();
    toggleBottomPanel();
    expect(useIDEStore.getState().isBottomPanelCollapsed).toBe(true);
    toggleBottomPanel();
    expect(useIDEStore.getState().isBottomPanelCollapsed).toBe(false);
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

import { useIDEStore } from '../../stores/ideStore';
import { useGitStore } from '../../stores/gitStore';
import { __resetGolemStore, useGolemStore } from '../../stores/golemStore';
import { focusConfigTab, focusEditorSurface } from '../../utils/editorSurface';

jest.mock('../../wails/bindings', () => ({}));

beforeEach(() => {
  useIDEStore.setState(useIDEStore.getInitialState());
  useGitStore.setState(useGitStore.getInitialState());
  __resetGolemStore();
});

describe('editorSurface reveal routing (#271 §6.3)', () => {
  it('repeated config/file focus reveals, while passive and restore focus preserve collapse', () => {
    focusConfigTab();
    useIDEStore.getState().setFilesPanelCollapsed(true);
    // Same target, second time: the intent is what reveals, not a changed flag.
    focusConfigTab();
    expect(useIDEStore.getState().isFilesPanelCollapsed).toBe(false);
    expect(useGolemStore.getState().configTabFocused).toBe(true);

    useIDEStore.getState().revealCenterPanel('golem');
    focusEditorSurface('file');
    expect(useIDEStore.getState().centerReveal).toBe('files');

    useIDEStore.getState().setFilesPanelCollapsed(true);
    focusEditorSurface('file', { reveal: false });
    expect(useIDEStore.getState().isFilesPanelCollapsed).toBe(true);
    useIDEStore.getState().setRestoringWorkspace(true);
    focusConfigTab();
    expect(useIDEStore.getState().isFilesPanelCollapsed).toBe(true);
  });

  it('keeps focus exclusivity while revealing', () => {
    useGitStore.getState().setEditorFocus('diff');
    focusConfigTab();
    expect(useGitStore.getState()).toMatchObject({ diffFocused: false, mergeFocused: false });

    focusEditorSurface('merge');
    expect(useGitStore.getState().mergeFocused).toBe(true);
    expect(useGolemStore.getState().configTabFocused).toBe(false);
    expect(useIDEStore.getState().centerReveal).toBe('files');
  });

  // #406: the tab strip scrolls, so every activation intent also asks the
  // editor to bring the selected tab into view, even when it was already selected.
  it('requests a tab reveal on every intent, but not from the passive sync', () => {
    const nonce = () => useIDEStore.getState().editorTabRevealNonce;
    const start = nonce();

    focusEditorSurface('file');
    focusEditorSurface('file');
    expect(nonce()).toBe(start + 2);

    focusConfigTab();
    expect(nonce()).toBe(start + 3);

    focusEditorSurface('file', { reveal: false });
    expect(nonce()).toBe(start + 3);
  });
});

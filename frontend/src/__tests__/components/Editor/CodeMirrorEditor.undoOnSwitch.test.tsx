import { render, screen, fireEvent, act } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { Editor } from '../../../components/Editor';
import { useIDEStore, type EditorFile } from '../../../stores/ideStore';

jest.mock('../../../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: jest.fn(),
  ListRecentWorkspaces: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../../../wailsjs/runtime/runtime', () => ({ WindowSetTitle: jest.fn() }));

function file(id: string, content: string): EditorFile {
  return {
    id,
    path: id,
    name: id.split('/').pop() ?? id,
    content,
    isModified: false,
  } as EditorFile;
}

function getView(container: HTMLElement): EditorView {
  const dom = container.querySelector('.cm-editor');
  const view = dom ? EditorView.findFromDOM(dom as HTMLElement) : null;
  if (!view) throw new Error('CodeMirror view not found');
  return view;
}

function switchToTab(name: RegExp) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

beforeEach(() => {
  useIDEStore.setState({
    workspace: { name: 'w', path: '/w' },
    openFiles: [file('/w/a.ts', 'alpha'), file('/w/b.ts', 'beta')],
    activeFileId: '/w/a.ts',
    recentWorkspaces: [],
    scrollPositions: {},
    cursorPositions: {},
  });
});

describe('per-file undo across tab switch (#153)', () => {
  it('restores the pre-switch edit when undoing after switching back', () => {
    const { container } = render(<Editor />);

    // Edit file A.
    let view = getView(container);
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: ' EDITED' },
        userEvent: 'input.type',
      });
    });
    expect(view.state.doc.toString()).toBe('alpha EDITED');

    // Switch A -> B -> A.
    act(() => switchToTab(/b\.ts/));
    act(() => switchToTab(/a\.ts/));

    // Undo must restore A's pre-edit content (history survived the switch).
    view = getView(container);
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe('alpha');
  });

  it('does not push phantom history when switching with no external change', () => {
    const { container } = render(<Editor />);

    let view = getView(container);
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '!' },
        userEvent: 'input.type',
      });
    });

    act(() => switchToTab(/b\.ts/));
    act(() => switchToTab(/a\.ts/));

    // A single undo reverts ONLY the real edit; a second undo finds nothing.
    view = getView(container);
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe('alpha');
    act(() => {
      const more = undo(view);
      expect(more).toBe(false);
    });
  });

  it('evicts cached state when a tab is closed, giving a fresh history on reopen', () => {
    const { container } = render(<Editor />);

    // Edit A and undo it, leaving the edit on A's REDO stack.
    let view = getView(container);
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: ' EDITED' },
        userEvent: 'input.type',
      });
    });
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe('alpha');

    // Close A (switches active to B), then reopen A from the tree.
    act(() => {
      useIDEStore.getState().closeFile('/w/a.ts');
    });
    act(() => {
      useIDEStore.getState().openFile(file('/w/a.ts', 'alpha'));
      useIDEStore.getState().setActiveFile('/w/a.ts');
    });

    // Fresh history: redo finds nothing. Without eviction, the closed tab's
    // cached state would be restored and redo would resurrect 'alpha EDITED'.
    view = getView(container);
    act(() => {
      const didRedo = redo(view);
      expect(didRedo).toBe(false);
    });
    expect(view.state.doc.toString()).toBe('alpha');
  });
});

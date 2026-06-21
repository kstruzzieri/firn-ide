import { act, render, waitFor } from '@testing-library/react';

type DispatchSpec = {
  selection?: { anchor: number };
  changes?: { from: number; to: number; insert: string };
  effects?: unknown[];
  scrollIntoView?: boolean;
};

class FakeDoc {
  constructor(private text: string) {}

  get lines() {
    return this.text.split('\n').length;
  }

  line(lineNumber: number) {
    const lines = this.text.split('\n');
    let from = 1;
    for (let i = 0; i < lineNumber - 1; i += 1) {
      from += (lines[i] ?? '').length + 1;
    }
    return {
      from,
      length: (lines[lineNumber - 1] ?? '').length,
    };
  }

  toString() {
    return this.text;
  }

  replace(text: string) {
    this.text = text;
  }
}

let lastEditorView: {
  dispatch: jest.Mock<void, [DispatchSpec]>;
  scrollDOM: { scrollTop: number; addEventListener: jest.Mock; removeEventListener: jest.Mock };
} | null = null;

const mockCreateEditorExtensions = jest.fn(() => []);
const mockUpdateEditorDiagnostics = jest.fn();
const mockReconfigureCompletion = jest.fn((filePath: string, triggerCharacters: string[]) => ({
  kind: 'completion-source',
  filePath,
  triggerCharacters,
}));
const mockReconfigureHover = jest.fn((filePath: string) => ({
  kind: 'hover-source',
  filePath,
}));
const mockResetCompletion = jest.fn(() => ({
  kind: 'completion-default',
}));
const mockCompletionCompartmentReconfigure = jest.fn((value: unknown) => ({
  kind: 'completion-compartment',
  value,
}));
const mockHoverCompartmentReconfigure = jest.fn((value: unknown) => ({
  kind: 'hover-compartment',
  value,
}));

jest.mock('../../../components/Editor/codemirror', () => {
  class MockEditorView {
    state: { doc: FakeDoc };
    scrollDOM = {
      scrollTop: 0,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    contentDOM = document.createElement('div');
    dispatch = jest.fn();
    destroy = jest.fn();

    constructor({ state, parent }: { state: { doc: FakeDoc }; parent: HTMLElement }) {
      this.state = state;
      parent.appendChild(this.contentDOM);
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      lastEditorView = this;
    }
  }

  return {
    EditorView: MockEditorView,
    EditorState: {
      create: ({ doc }: { doc: string }) => ({
        doc: new FakeDoc(doc),
      }),
    },
    completionCompartment: {
      reconfigure: mockCompletionCompartmentReconfigure,
    },
    hoverCompartment: {
      reconfigure: mockHoverCompartmentReconfigure,
    },
    createEditorExtensions: mockCreateEditorExtensions,
    applyEditorTheme: jest.fn(),
    reconfigureCompletion: mockReconfigureCompletion,
    reconfigureHover: mockReconfigureHover,
    resetCompletion: mockResetCompletion,
    updateEditorDiagnostics: mockUpdateEditorDiagnostics,
  };
});

import { CodeMirrorEditor } from '../../../components/Editor/CodeMirrorEditor';
import { useIDEStore } from '../../../stores/ideStore';
import { useLSPStore } from '../../../stores/lspStore';

beforeEach(() => {
  jest.clearAllMocks();
  lastEditorView = null;
  useIDEStore.setState(useIDEStore.getInitialState());
  useLSPStore.setState(useLSPStore.getInitialState());
  global.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

describe('CodeMirrorEditor', () => {
  it('applies restored cursor and scroll when they arrive after mount', async () => {
    const { rerender } = render(
      <CodeMirrorEditor fileId="file-1" filename="main.ts" content={'one\ntwo\nthree'} />
    );

    expect(lastEditorView).not.toBeNull();
    expect(lastEditorView?.dispatch).not.toHaveBeenCalled();

    rerender(
      <CodeMirrorEditor
        fileId="file-1"
        filename="main.ts"
        content={'one\ntwo\nthree'}
        initialCursorLine={2}
        initialCursorColumn={3}
        initialScrollTop={55}
      />
    );

    await waitFor(() =>
      expect(lastEditorView?.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 7 },
        scrollIntoView: false,
      })
    );
    expect(lastEditorView?.scrollDOM.scrollTop).toBe(55);
  });

  it('passes the absolute file path into editor extensions', () => {
    render(
      <CodeMirrorEditor fileId="/project/main.ts" filename="main.ts" content="const value = 1;" />
    );

    expect(mockCreateEditorExtensions).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'main.ts',
        filePath: '/project/main.ts',
      })
    );
  });

  it('reconfigures completion and hover from matching LSP server status', async () => {
    render(
      <CodeMirrorEditor fileId="/project/main.ts" filename="main.ts" content="const value = 1;" />
    );

    expect(lastEditorView).not.toBeNull();
    lastEditorView?.dispatch.mockClear();
    mockReconfigureCompletion.mockClear();
    mockReconfigureHover.mockClear();
    mockCompletionCompartmentReconfigure.mockClear();
    mockHoverCompartmentReconfigure.mockClear();

    act(() => {
      useIDEStore.getState().setWorkspace({ name: 'project', path: '/project' });
      useLSPStore.getState().setServerStatus({
        family: 'typescript',
        workspace: '/project',
        state: 'ready',
        completionTriggerCharacters: ['.', ':'],
      });
    });

    await waitFor(() => {
      expect(mockReconfigureCompletion).toHaveBeenCalledWith('/project/main.ts', ['.', ':']);
      expect(mockReconfigureHover).toHaveBeenCalledWith('/project/main.ts');
    });

    expect(lastEditorView?.dispatch).toHaveBeenCalledWith({
      effects: [
        {
          kind: 'completion-compartment',
          value: {
            kind: 'completion-source',
            filePath: '/project/main.ts',
            triggerCharacters: ['.', ':'],
          },
        },
        {
          kind: 'hover-compartment',
          value: {
            kind: 'hover-source',
            filePath: '/project/main.ts',
          },
        },
      ],
    });

    lastEditorView?.dispatch.mockClear();
    mockCompletionCompartmentReconfigure.mockClear();
    mockHoverCompartmentReconfigure.mockClear();

    act(() => {
      useLSPStore.getState().setServerStatus({
        family: 'typescript',
        workspace: '/project',
        state: 'error',
        error: 'server crashed',
      });
    });

    await waitFor(() => {
      expect(mockResetCompletion).toHaveBeenCalled();
      expect(mockHoverCompartmentReconfigure).toHaveBeenCalledWith([]);
    });

    expect(lastEditorView?.dispatch).toHaveBeenCalledWith({
      effects: [
        {
          kind: 'completion-compartment',
          value: {
            kind: 'completion-default',
          },
        },
        {
          kind: 'hover-compartment',
          value: [],
        },
      ],
    });
  });
});

import { render, waitFor } from '@testing-library/react';

type DispatchSpec = {
  selection?: { anchor: number };
  changes?: { from: number; to: number; insert: string };
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
    createEditorExtensions: jest.fn(() => []),
  };
});

import { CodeMirrorEditor } from '../../../components/Editor/CodeMirrorEditor';

beforeEach(() => {
  lastEditorView = null;
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
});

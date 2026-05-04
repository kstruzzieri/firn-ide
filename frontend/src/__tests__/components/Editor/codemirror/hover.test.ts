import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

jest.mock('../../../../../wailsjs/go/main/App', () => ({
  LSPHover: jest.fn(),
  LSPDefinition: jest.fn(),
}));

jest.mock('../../../../../wailsjs/runtime/runtime', () => ({
  ClipboardSetText: jest.fn(),
}));

jest.mock('../../../../utils/lspDocumentSync', () => ({
  flushLSPDocumentChange: jest.fn(() => Promise.resolve(false)),
}));

import { LSPHover } from '../../../../../wailsjs/go/main/App';
import { lsp } from '../../../../../wailsjs/go/models';
import { flushLSPDocumentChange } from '../../../../utils/lspDocumentSync';
import {
  createLSPHoverSource,
  highlightSignatureParts,
  hoverRequestPos,
  hoverTargetRange,
} from '../../../../components/Editor/codemirror/hover';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createLSPHoverSource', () => {
  const mockHover = LSPHover as jest.MockedFunction<typeof LSPHover>;
  const mockFlush = flushLSPDocumentChange as jest.MockedFunction<typeof flushLSPDocumentChange>;

  it('drops hover requests when the document changes while flushing', async () => {
    const { view, setDoc } = createMutableEditorView('const value = 1');
    mockFlush.mockImplementation(async () => {
      setDoc('const other = 1');
      return false;
    });

    const result = await createLSPHoverSource('/project/src/file.ts')(view, 7);

    expect(result).toBeNull();
    expect(mockHover).not.toHaveBeenCalled();
  });

  it('drops hover results when the document changes while the request is in flight', async () => {
    const { view, setDoc } = createMutableEditorView('const value = 1');
    let resolveHover: (value: Awaited<ReturnType<typeof LSPHover>>) => void = () => {};

    mockHover.mockReturnValue(
      new Promise((resolve) => {
        resolveHover = resolve;
      })
    );

    const pending = createLSPHoverSource('/project/src/file.ts')(view, 7);
    await Promise.resolve();

    expect(mockHover).toHaveBeenCalledTimes(1);

    setDoc('const other = 1');
    resolveHover(
      lsp.Hover.createFrom({
        contents: encodeRawJSON({ kind: 'markdown', value: 'value docs' }),
      })
    );

    await expect(pending).resolves.toBeNull();
  });
});

describe('hoverTargetRange', () => {
  it('returns null when there is no word under the cursor', () => {
    expect(hoverTargetRange(null, 12)).toBeNull();
  });

  it('anchors the tooltip to the full symbol range', () => {
    expect(hoverTargetRange({ from: 24, to: 31 }, 27)).toEqual({
      from: 24,
      to: 31,
    });
  });

  it('clamps the hover request position inside the hovered symbol', () => {
    expect(hoverRequestPos({ from: 24, to: 31 }, 31)).toBe(30);
  });
});

describe('highlightSignatureParts', () => {
  it('classifies TypeScript hover signatures into syntax color parts', () => {
    expect(
      highlightSignatureParts('const ANNOTATION_COLORS: Record<AnnotationType, string>')
    ).toEqual([
      { text: 'const', className: 'firn-hover-keyword' },
      { text: ' ', className: '' },
      { text: 'ANNOTATION_COLORS', className: 'firn-hover-constant' },
      { text: ':', className: 'firn-hover-punctuation' },
      { text: ' ', className: '' },
      { text: 'Record', className: 'firn-hover-type' },
      { text: '<', className: 'firn-hover-punctuation' },
      { text: 'AnnotationType', className: 'firn-hover-type' },
      { text: ',', className: 'firn-hover-punctuation' },
      { text: ' ', className: '' },
      { text: 'string', className: 'firn-hover-type' },
      { text: '>', className: 'firn-hover-punctuation' },
    ]);
  });
});

function createMutableEditorView(doc: string): {
  view: EditorView;
  setDoc: (nextDoc: string) => void;
} {
  let currentState = EditorState.create({ doc });
  return {
    view: {
      get state() {
        return currentState;
      },
    } as EditorView,
    setDoc: (nextDoc: string) => {
      currentState = EditorState.create({ doc: nextDoc });
    },
  };
}

function encodeRawJSON(value: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)));
}

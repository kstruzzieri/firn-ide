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

import {
  highlightSignatureParts,
  hoverRequestPos,
  hoverTargetRange,
} from '../../../../components/Editor/codemirror/hover';

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

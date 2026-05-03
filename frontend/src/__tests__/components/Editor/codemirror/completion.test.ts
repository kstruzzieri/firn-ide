import { acceptCompletion } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';

jest.mock('../../../../../wailsjs/go/main/App', () => ({
  LSPComplete: jest.fn(),
  LSPResolveCompletionItem: jest.fn(),
}));

import {
  parseResolvedCompletionDetail,
  positionCompletionInfo,
  sortLSPCompletionItems,
} from '../../../../components/Editor/codemirror/completion';
import {
  editorKeybindings,
  editorTooltipSpace,
} from '../../../../components/Editor/codemirror/extensions';

describe('sortLSPCompletionItems', () => {
  it('preserves server ordering while demoting internal-style names', () => {
    const sorted = sortLSPCompletionItems([
      { label: '__dirname', sortText: '0001' },
      { label: 'squareMeters', sortText: '0010' },
      { label: '_esri', sortText: '0002' },
      { label: 'meters', sortText: '0009' },
    ]);

    expect(sorted.map((item) => item.label)).toEqual([
      'meters',
      'squareMeters',
      '__dirname',
      '_esri',
    ]);
  });
});

describe('editorKeybindings', () => {
  it('accepts the selected completion on Tab before indentation runs', () => {
    const acceptTabIndex = editorKeybindings.findIndex(
      (binding) => binding.key === 'Tab' && binding.run === acceptCompletion
    );
    const indentTabIndex = editorKeybindings.findIndex((binding) => binding === indentWithTab);

    expect(acceptTabIndex).toBeGreaterThan(-1);
    expect(indentTabIndex).toBeGreaterThan(-1);
    expect(acceptTabIndex).toBeLessThan(indentTabIndex);
  });
});

describe('parseResolvedCompletionDetail', () => {
  it('extracts parameter tails and return types from resolved method details', () => {
    expect(parseResolvedCompletionDetail('has', '(method) has(value: string): boolean')).toEqual({
      tail: '(value: string)',
      rightText: 'boolean',
    });
  });

  it('extracts property types from resolved property details', () => {
    expect(
      parseResolvedCompletionDetail('DEFAULT_CHUNK_SIZE', '(property) DEFAULT_CHUNK_SIZE: number')
    ).toEqual({
      rightText: 'number',
    });
  });
});

describe('positionCompletionInfo', () => {
  it('falls back below the selected option instead of covering the section header', () => {
    expect(
      positionCompletionInfo(
        {} as never,
        { left: 260, right: 780, top: 120, bottom: 420 },
        { left: 260, right: 780, top: 150, bottom: 186 },
        { left: 0, right: 340, top: 0, bottom: 180 },
        { left: 220, right: 820, top: 100, bottom: 440 }
      )
    ).toEqual({
      style: 'top: 72px; left: 0; max-width: 360px; max-height: 244px',
      class: 'cm-completionInfo-below-option',
    });
  });
});

describe('editorTooltipSpace', () => {
  it('uses the visible editor viewport instead of the whole window', () => {
    const view = {
      scrollDOM: {
        getBoundingClientRect: () => ({
          top: 100,
          left: 40,
          right: 840,
          bottom: 520,
        }),
      },
    };

    expect(editorTooltipSpace(view as never)).toEqual({
      top: 106,
      left: 44,
      right: 836,
      bottom: 514,
    });
  });
});

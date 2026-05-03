const mockDidOpen = jest.fn().mockResolvedValue(undefined);
const mockDidChange = jest.fn().mockResolvedValue(undefined);
const mockDidSave = jest.fn().mockResolvedValue(undefined);
const mockDidClose = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../wailsjs/go/main/App', () => ({
  LSPDidOpen: (...args: unknown[]) => mockDidOpen(...args),
  LSPDidChange: (...args: unknown[]) => mockDidChange(...args),
  LSPDidSave: (...args: unknown[]) => mockDidSave(...args),
  LSPDidClose: (...args: unknown[]) => mockDidClose(...args),
}));

jest.mock('../../../wailsjs/go/models', () => ({
  lsp: {
    TextDocumentContentChangeEvent: class {
      text: string;
      range?: unknown;
      constructor(source: { text: string; range?: unknown }) {
        this.text = source.text;
        this.range = source.range;
      }
    },
  },
}));

import {
  closeLSPDocument,
  flushLSPDocumentChange,
  openLSPDocument,
  resetLSPDocumentSyncState,
  scheduleLSPDocumentChange,
  saveLSPDocument,
} from '../../utils/lspDocumentSync';

beforeEach(() => {
  jest.useFakeTimers();
  mockDidOpen.mockClear();
  mockDidChange.mockClear();
  mockDidSave.mockClear();
  mockDidClose.mockClear();
  resetLSPDocumentSyncState();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('lspDocumentSync', () => {
  it('flushes the current buffer immediately when a completion request races the debounce', async () => {
    await openLSPDocument(
      '/test/workspace/main.ts',
      'typescript',
      'const features = getFeatures()'
    );

    await flushLSPDocumentChange(
      '/test/workspace/main.ts',
      'const features = getFeatures();\nfeatures.'
    );

    expect(mockDidOpen).toHaveBeenCalledWith(
      '/test/workspace/main.ts',
      'typescript',
      1,
      'const features = getFeatures()'
    );
    expect(mockDidChange).toHaveBeenCalledWith(
      '/test/workspace/main.ts',
      2,
      expect.arrayContaining([
        expect.objectContaining({ text: 'const features = getFeatures();\nfeatures.' }),
      ])
    );
  });

  it('cancels the scheduled debounce after an explicit flush', async () => {
    await openLSPDocument('/test/workspace/main.ts', 'typescript', 'const x = 1;');

    scheduleLSPDocumentChange('/test/workspace/main.ts', 'const x = 2;');
    await flushLSPDocumentChange('/test/workspace/main.ts');

    expect(mockDidChange).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(300);

    expect(mockDidChange).toHaveBeenCalledTimes(1);
  });

  it('sends didSave after syncing unsent content', async () => {
    await openLSPDocument('/test/workspace/main.ts', 'typescript', 'const x = 1;');

    scheduleLSPDocumentChange('/test/workspace/main.ts', 'const x = 2;');
    await saveLSPDocument('/test/workspace/main.ts', 'const x = 2;');

    expect(mockDidChange).toHaveBeenCalledTimes(1);
    expect(mockDidSave).toHaveBeenCalledWith('/test/workspace/main.ts');
  });

  it('sends didClose with the latest content on close', async () => {
    await openLSPDocument('/test/workspace/main.ts', 'typescript', 'const x = 1;');

    scheduleLSPDocumentChange('/test/workspace/main.ts', 'const x = 2;');
    await closeLSPDocument('/test/workspace/main.ts', 'const x = 2;');

    expect(mockDidChange).toHaveBeenCalledTimes(1);
    expect(mockDidClose).toHaveBeenCalledWith('/test/workspace/main.ts');
  });
});

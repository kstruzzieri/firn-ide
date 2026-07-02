jest.mock('../../../../../wailsjs/go/main/App', () => ({
  LSPComplete: jest.fn(),
  LSPResolveCompletionItem: jest.fn(),
  LSPDefinition: jest.fn(),
  LSPHover: jest.fn(),
}));
jest.mock('../../../../utils/lspDocumentSync', () => ({
  flushLSPDocumentChange: jest.fn(() => Promise.resolve(false)),
}));

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  createEditorExtensions,
  applyEditorTheme,
} from '../../../../components/Editor/codemirror/extensions';

describe('editor theme wiring', () => {
  it('createEditorExtensions accepts a syntaxThemeId', () => {
    const ext = createEditorExtensions({
      filename: 'a.ts',
      filePath: '/a.ts',
      syntaxThemeId: 'abyssal',
    });
    expect(Array.isArray(ext)).toBe(true);
    expect(ext.length).toBeGreaterThan(0);
  });

  it('applyEditorTheme reconfigures a live view without throwing', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'const x = 1',
        extensions: createEditorExtensions({
          filename: 'a.ts',
          filePath: '/a.ts',
          syntaxThemeId: 'glacier',
        }),
      }),
    });
    expect(() => applyEditorTheme(view, 'reef')).not.toThrow();
    view.destroy();
  });
});

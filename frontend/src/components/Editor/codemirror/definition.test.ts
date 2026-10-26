import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { useIDEStore } from '../../../stores/ideStore';
import { navigateToEditorLocation } from '../../../utils/editorNavigation';
import { isMac } from '../../../utils/platform';
import { createEditorExtensions } from './extensions';

jest.mock('../../../utils/platform', () => ({
  ...jest.requireActual('../../../utils/platform'),
  isMac: jest.fn(),
}));
jest.mock('../../../utils/editorNavigation', () => ({
  navigateToEditorLocation: jest.fn(),
}));

const FILE = '/repo/src/current.ts';
const EARLIER = { fileId: '/repo/src/earlier.ts', line: 3, column: 5 };
const LATER = { fileId: '/repo/src/later.ts', line: 9, column: 2 };

// jsdom reports no navigator.platform, so CodeMirror resolves `Mod` to Ctrl
// here. Both the navigation binding and the defaultKeymap binding it competes
// with are spelled `Mod-[`, so Ctrl exercises the same conflict Cmd does on macOS.
const KEY_SETS = [
  {
    platform: 'macOS',
    mac: true,
    back: { key: '[', ctrlKey: true },
    forward: { key: ']', ctrlKey: true },
  },
  {
    platform: 'Windows and Linux',
    mac: false,
    back: { key: 'ArrowLeft', altKey: true },
    forward: { key: 'ArrowRight', altKey: true },
  },
];

let view: EditorView | null = null;

function openEditor(doc: string, cursor: number) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: createEditorExtensions({ filename: 'current.ts', filePath: FILE }),
    }),
    parent: document.body,
  });
  return view;
}

function press(editor: EditorView, init: KeyboardEventInit) {
  return runScopeHandlers(editor, new KeyboardEvent('keydown', init), 'editor');
}

afterEach(() => {
  view?.destroy();
  view = null;
  jest.mocked(navigateToEditorLocation).mockClear();
  useIDEStore.setState({ navigationHistory: [], navigationForward: [] });
});

describe.each(KEY_SETS)('definition history keys on $platform (#279)', (keys) => {
  beforeEach(() => {
    jest.mocked(isMac).mockReturnValue(keys.mac);
  });

  it('goes back to the previous definition location', () => {
    useIDEStore.setState({ navigationHistory: [EARLIER], navigationForward: [] });
    const editor = openEditor('const value = 1;\n', 6);

    expect(press(editor, keys.back)).toBe(true);

    expect(navigateToEditorLocation).toHaveBeenCalledWith(
      EARLIER.fileId,
      EARLIER.line,
      EARLIER.column
    );
    expect(editor.state.doc.toString()).toBe('const value = 1;\n');
  });

  it('goes forward to the next definition location', () => {
    useIDEStore.setState({ navigationHistory: [], navigationForward: [LATER] });
    const editor = openEditor('const value = 1;\n', 6);

    expect(press(editor, keys.forward)).toBe(true);

    expect(navigateToEditorLocation).toHaveBeenCalledWith(LATER.fileId, LATER.line, LATER.column);
    expect(editor.state.doc.toString()).toBe('const value = 1;\n');
  });
});

describe('definition history keys with no history (#279)', () => {
  it('leaves Cmd+[ to dedent on macOS', () => {
    jest.mocked(isMac).mockReturnValue(true);
    const editor = openEditor('    indented\n', 6);

    expect(press(editor, { key: '[', ctrlKey: true })).toBe(true);

    expect(navigateToEditorLocation).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe('  indented\n');
  });

  it('leaves Alt+Left to move by syntax unit on Windows and Linux', () => {
    jest.mocked(isMac).mockReturnValue(false);
    const doc = 'const value = 1;\n';
    const editor = openEditor(doc, doc.indexOf(' = '));

    expect(press(editor, { key: 'ArrowLeft', altKey: true })).toBe(true);

    expect(navigateToEditorLocation).not.toHaveBeenCalled();
    expect(editor.state.selection.main.head).toBeLessThan(doc.indexOf(' = '));
  });
});

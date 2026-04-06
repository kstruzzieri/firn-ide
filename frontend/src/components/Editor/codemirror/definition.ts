/**
 * Go-to-Definition Extension for CodeMirror 6
 *
 * Provides:
 * - F12 keybinding to go to definition from cursor position
 * - Cmd+Click (macOS) / Ctrl+Click (others) to go to definition
 * - Cmd+[ / Alt+Left to navigate back through definition history
 * - Cmd+] / Alt+Right to navigate forward through definition history
 * - Underline decoration preview when Cmd/Ctrl is held over a word
 */

import {
  keymap,
  type KeyBinding,
  Decoration,
  type DecorationSet,
  EditorView,
} from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { LSPDefinition } from '../../../../wailsjs/go/main/App';
import { fileURIToPath } from '../../../utils/lspUri';
import { navigateToEditorLocation } from '../../../utils/editorNavigation';
import { useIDEStore } from '../../../stores/ideStore';
import { isMac } from '../../../utils/platform';

const setUnderline = StateEffect.define<{ from: number; to: number } | null>();

const underlineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setUnderline)) {
        if (effect.value) {
          const mark = Decoration.mark({ class: 'firn-definition-link' });
          return Decoration.set([mark.range(effect.value.from, effect.value.to)]);
        }
        return Decoration.none;
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Helper to get the current cursor location as a NavigationLocation. */
function currentLocation(view: EditorView, filePath: string) {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  return {
    fileId: filePath,
    line: line.number,
    column: pos - line.from + 1,
  };
}

async function triggerDefinition(view: EditorView, pos: number, filePath: string): Promise<void> {
  const line = view.state.doc.lineAt(pos);
  const lspLine = line.number - 1;
  const lspChar = pos - line.from;

  const currentLine = line.number;
  const currentCol = pos - line.from + 1;
  useIDEStore.getState().pushNavigationHistory({
    fileId: filePath,
    line: currentLine,
    column: currentCol,
  });

  let locations;
  try {
    locations = await LSPDefinition(filePath, lspLine, lspChar);
  } catch {
    return;
  }

  if (!locations || locations.length === 0) return;

  const loc = locations[0];
  const targetPath = fileURIToPath(loc.uri);
  if (!targetPath) return;

  navigateToEditorLocation(targetPath, loc.range.start.line + 1, loc.range.start.character + 1);
}

export function definitionExtensions(filePath: string) {
  const bindings: KeyBinding[] = [
    {
      key: 'F12',
      run: (view) => {
        const pos = view.state.selection.main.head;
        triggerDefinition(view, pos, filePath);
        return true;
      },
    },
    ...(isMac()
      ? [
          {
            key: 'Mod-[',
            run: (view: EditorView): boolean => {
              const entry = useIDEStore.getState().goBack(currentLocation(view, filePath));
              if (!entry) return false;
              navigateToEditorLocation(entry.fileId, entry.line, entry.column);
              return true;
            },
          },
          {
            key: 'Mod-]',
            run: (view: EditorView): boolean => {
              const entry = useIDEStore.getState().goForward(currentLocation(view, filePath));
              if (!entry) return false;
              navigateToEditorLocation(entry.fileId, entry.line, entry.column);
              return true;
            },
          },
        ]
      : [
          {
            key: 'Alt-ArrowLeft',
            run: (view: EditorView): boolean => {
              const entry = useIDEStore.getState().goBack(currentLocation(view, filePath));
              if (!entry) return false;
              navigateToEditorLocation(entry.fileId, entry.line, entry.column);
              return true;
            },
          },
          {
            key: 'Alt-ArrowRight',
            run: (view: EditorView): boolean => {
              const entry = useIDEStore.getState().goForward(currentLocation(view, filePath));
              if (!entry) return false;
              navigateToEditorLocation(entry.fileId, entry.line, entry.column);
              return true;
            },
          },
        ]),
  ];

  const modifierHandlers = EditorView.domEventHandlers({
    mousemove(event: MouseEvent, view: EditorView) {
      const modHeld = isMac() ? event.metaKey : event.ctrlKey;

      if (!modHeld) {
        view.dispatch({ effects: setUnderline.of(null) });
        return;
      }

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) {
        view.dispatch({ effects: setUnderline.of(null) });
        return;
      }

      const wordRange = view.state.wordAt(pos);
      if (!wordRange) {
        view.dispatch({ effects: setUnderline.of(null) });
        return;
      }

      view.dispatch({
        effects: setUnderline.of({ from: wordRange.from, to: wordRange.to }),
      });
    },

    mouseup(event: MouseEvent, view: EditorView) {
      const modHeld = isMac() ? event.metaKey : event.ctrlKey;
      if (!modHeld) return;

      view.dispatch({ effects: setUnderline.of(null) });

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return;

      triggerDefinition(view, pos, filePath);
    },

    keyup(event: KeyboardEvent, view: EditorView) {
      const modKey = isMac() ? 'Meta' : 'Control';
      if (event.key === modKey) {
        view.dispatch({ effects: setUnderline.of(null) });
      }
    },
  });

  return [keymap.of(bindings), underlineField, modifierHandlers];
}

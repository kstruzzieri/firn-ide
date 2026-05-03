import { renderHook, act } from '@testing-library/react';
import { getPlatform } from '../../utils/platform';
import { useIDEStore } from '../../stores/ideStore';

// Mock Wails bindings
const mockOpenFolderDialog = jest.fn();
const mockNavigateToEditorLocation = jest.fn();
jest.mock('../../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: (...args: unknown[]) => mockOpenFolderDialog(...args),
  ReadDirectory: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

jest.mock('../../utils/editorNavigation', () => ({
  navigateToEditorLocation: (...args: unknown[]) => mockNavigateToEditorLocation(...args),
}));

import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

const isMac = getPlatform() === 'mac';

function modifierKeyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: !isMac,
    metaKey: isMac,
    bubbles: true,
  });
}

function navigationBackEvent(): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: isMac ? '[' : 'ArrowLeft',
    code: isMac ? 'BracketLeft' : 'ArrowLeft',
    metaKey: isMac,
    altKey: !isMac,
    bubbles: true,
    cancelable: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState(useIDEStore.getInitialState());
});

describe('useKeyboardShortcuts', () => {
  it('should open folder dialog on modifier+O', async () => {
    mockOpenFolderDialog.mockResolvedValue('');

    renderHook(() => useKeyboardShortcuts());

    await act(async () => {
      window.dispatchEvent(modifierKeyEvent('o'));
    });

    expect(mockOpenFolderDialog).toHaveBeenCalled();
  });

  it('should not trigger on plain "o" key without modifier', async () => {
    mockOpenFolderDialog.mockResolvedValue('');

    renderHook(() => useKeyboardShortcuts());

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'o',
          bubbles: true,
        })
      );
    });

    expect(mockOpenFolderDialog).not.toHaveBeenCalled();
  });

  it('should clean up listener on unmount', async () => {
    mockOpenFolderDialog.mockResolvedValue('');

    const { unmount } = renderHook(() => useKeyboardShortcuts());
    unmount();

    await act(async () => {
      window.dispatchEvent(modifierKeyEvent('o'));
    });

    expect(mockOpenFolderDialog).not.toHaveBeenCalled();
  });

  it('should navigate back through editor navigation history', async () => {
    renderHook(() => useKeyboardShortcuts());

    useIDEStore.setState({
      activeFileId: '/current.ts',
      cursorPosition: { line: 9, column: 4 },
      cursorPositions: { '/current.ts': { line: 12, column: 8 } },
    });
    useIDEStore.getState().pushNavigationHistory({
      fileId: '/definition-source.ts',
      line: 3,
      column: 2,
    });

    const event = navigationBackEvent();
    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(mockNavigateToEditorLocation).toHaveBeenCalledWith('/definition-source.ts', 3, 2);
    expect(useIDEStore.getState().navigationForward).toEqual([
      { fileId: '/current.ts', line: 12, column: 8 },
    ]);
  });

  it('should not handle navigation shortcuts that were already handled', async () => {
    renderHook(() => useKeyboardShortcuts());

    useIDEStore.setState({
      activeFileId: '/current.ts',
      cursorPosition: { line: 9, column: 4 },
      cursorPositions: { '/current.ts': { line: 12, column: 8 } },
    });
    useIDEStore.getState().pushNavigationHistory({
      fileId: '/definition-source.ts',
      line: 3,
      column: 2,
    });

    const event = navigationBackEvent();
    event.preventDefault();
    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(mockNavigateToEditorLocation).not.toHaveBeenCalled();
    expect(useIDEStore.getState().navigationHistory).toEqual([
      { fileId: '/definition-source.ts', line: 3, column: 2 },
    ]);
    expect(useIDEStore.getState().navigationForward).toEqual([]);
  });
});

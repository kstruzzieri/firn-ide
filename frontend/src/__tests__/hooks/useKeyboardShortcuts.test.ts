import { renderHook, act } from '@testing-library/react';
import { getPlatform } from '../../utils/platform';
import { useIDEStore } from '../../stores/ideStore';
import { useSearchStore } from '../../stores/searchStore';

// Mock Wails bindings
const mockOpenFolderDialog = jest.fn();
const mockNavigateToEditorLocation = jest.fn();
const mockStartProfile = jest.fn().mockResolvedValue(undefined);
const mockRestartProfile = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: (...args: unknown[]) => mockOpenFolderDialog(...args),
  ReadDirectory: jest.fn().mockResolvedValue([]),
  StartRunProfile: (...a: unknown[]) => mockStartProfile(...a),
  RestartRunProfile: (...a: unknown[]) => mockRestartProfile(...a),
  StopRunProfile: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockEventsOn = jest.fn<any, [string, () => void]>().mockReturnValue(jest.fn());
jest.mock('../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
  EventsOn: (event: string, callback: () => void) => mockEventsOn(event, callback),
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

function searchShortcutEvent(): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'f',
    ctrlKey: !isMac,
    metaKey: isMac,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
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
    expect(mockEventsOn).toHaveBeenCalledWith('navigate:back', expect.any(Function));
    expect(mockEventsOn).toHaveBeenCalledWith('navigate:forward', expect.any(Function));
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

  it('should navigate back via Wails native menu event', async () => {
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

    // Find the navigate:back callback that was registered with EventsOn
    const backCall = mockEventsOn.mock.calls.find((call) => call[0] === 'navigate:back');
    const backCallback = backCall?.[1] as (() => void) | undefined;
    expect(backCallback).toBeDefined();

    await act(async () => {
      backCallback!();
    });

    expect(mockNavigateToEditorLocation).toHaveBeenCalledWith('/definition-source.ts', 3, 2);
  });

  describe('search shortcut', () => {
    beforeEach(() => {
      useSearchStore.setState({
        query: '',
        options: { regex: false, caseSensitive: false, wholeWord: false },
        uiState: { kind: 'no-workspace' },
        expandedFiles: new Set<string>(),
        activeRequestId: null,
        focusInputRevision: 0,
      });
    });

    it('switches the sidebar to search and bumps focusInputRevision', async () => {
      useIDEStore.setState({
        activeSidebarView: 'explorer',
        isLeftPanelCollapsed: false,
      });
      renderHook(() => useKeyboardShortcuts());

      const event = searchShortcutEvent();
      await act(async () => {
        window.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(useIDEStore.getState().activeSidebarView).toBe('search');
      expect(useSearchStore.getState().focusInputRevision).toBe(1);
    });

    it('expands the left panel if it was collapsed', async () => {
      useIDEStore.setState({
        activeSidebarView: 'search',
        isLeftPanelCollapsed: true,
      });
      renderHook(() => useKeyboardShortcuts());

      await act(async () => {
        window.dispatchEvent(searchShortcutEvent());
      });

      expect(useIDEStore.getState().isLeftPanelCollapsed).toBe(false);
    });

    it('leaves the left panel expanded if already open', async () => {
      useIDEStore.setState({
        activeSidebarView: 'search',
        isLeftPanelCollapsed: false,
      });
      renderHook(() => useKeyboardShortcuts());

      await act(async () => {
        window.dispatchEvent(searchShortcutEvent());
      });

      expect(useIDEStore.getState().isLeftPanelCollapsed).toBe(false);
      expect(useSearchStore.getState().focusInputRevision).toBe(1);
    });

    it('does not trigger on plain "f" or modifier+F without Shift', async () => {
      renderHook(() => useKeyboardShortcuts());

      await act(async () => {
        window.dispatchEvent(modifierKeyEvent('f'));
      });
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'f', shiftKey: true, bubbles: true })
        );
      });

      expect(useSearchStore.getState().focusInputRevision).toBe(0);
    });
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

function runShortcutEvent(): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'r',
    ctrlKey: !isMac,
    metaKey: isMac,
    bubbles: true,
    cancelable: true,
  });
}

describe('Cmd/Ctrl+R run target', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useIDEStore.setState({
      runProfiles: [{ id: 'p1', name: 'dev', type: 'single', source: 'user', workspaceId: 'ws1' }],
      runProfileState: {},
      runOutputs: {},
      hiddenProfileIds: [],
      stoppingProfileIds: [],
      restartingProfileIds: [],
      activeWorkspaceId: 'ws1',
      selectedProfileId: 'p1',
    });
  });

  test('starts the target when idle and prevents default (no page reload)', () => {
    renderHook(() => useKeyboardShortcuts());
    const ev = runShortcutEvent();
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(mockStartProfile).toHaveBeenCalledWith('p1');
    expect(ev.defaultPrevented).toBe(true);
  });

  test('restarts the target when running', () => {
    useIDEStore.setState({ runOutputs: { p1: { state: 'running' } } as never });
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      window.dispatchEvent(runShortcutEvent());
    });
    expect(mockRestartProfile).toHaveBeenCalledWith('p1');
  });

  test('no-op while stopping', () => {
    useIDEStore.setState({ stoppingProfileIds: ['p1'] });
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      window.dispatchEvent(runShortcutEvent());
    });
    expect(mockStartProfile).not.toHaveBeenCalled();
    expect(mockRestartProfile).not.toHaveBeenCalled();
  });
});

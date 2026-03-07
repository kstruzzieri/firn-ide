import { renderHook, act } from '@testing-library/react';

// Mock Wails bindings
const mockOpenFolderDialog = jest.fn();
jest.mock('../../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: (...args: unknown[]) => mockOpenFolderDialog(...args),
  ReadDirectory: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useKeyboardShortcuts', () => {
  it('should open folder dialog on Ctrl+O', async () => {
    // jsdom reports as non-Mac, so Ctrl is the modifier
    mockOpenFolderDialog.mockResolvedValue('');

    renderHook(() => useKeyboardShortcuts());

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'o',
          ctrlKey: true,
          bubbles: true,
        })
      );
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
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'o',
          ctrlKey: true,
          bubbles: true,
        })
      );
    });

    expect(mockOpenFolderDialog).not.toHaveBeenCalled();
  });
});

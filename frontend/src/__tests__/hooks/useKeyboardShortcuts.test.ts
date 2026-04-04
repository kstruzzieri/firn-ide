import { renderHook, act } from '@testing-library/react';
import { getPlatform } from '../../utils/platform';

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

const isMac = getPlatform() === 'mac';

function modifierKeyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: !isMac,
    metaKey: isMac,
    bubbles: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
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
});

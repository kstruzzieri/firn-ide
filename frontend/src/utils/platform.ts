/**
 * Platform detection utilities for cross-platform keyboard shortcuts
 * and UI adaptations.
 */

export type Platform = 'mac' | 'windows' | 'linux';

/**
 * Detects the current operating system platform.
 */
export function getPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes('mac')) {
    return 'mac';
  }
  if (userAgent.includes('win')) {
    return 'windows';
  }
  return 'linux';
}

/**
 * Returns true if the current platform is macOS.
 */
export function isMac(): boolean {
  return getPlatform() === 'mac';
}

/**
 * Formats a keyboard shortcut for the current platform.
 * Uses ⌘ for Mac, Ctrl for Windows/Linux.
 *
 * @param shortcut - Shortcut in Mac format (e.g., "⌘K", "⌘⇧F")
 * @returns Platform-appropriate shortcut string
 */
export function formatShortcut(shortcut: string): string {
  if (isMac()) {
    return shortcut;
  }

  // Convert Mac symbols to Windows/Linux equivalents
  return shortcut
    .replace(/⌘/g, 'Ctrl+')
    .replace(/⇧/g, 'Shift+')
    .replace(/⌥/g, 'Alt+')
    .replace(/\+$/g, ''); // Remove trailing +
}

/**
 * Returns the modifier key name for the current platform.
 */
export function getModifierKey(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

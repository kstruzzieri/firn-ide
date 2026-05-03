/**
 * Shared URI conversion helpers for LSP diagnostics and navigation.
 *
 * Provides bidirectional conversion between local file paths and file:// URIs,
 * matching the backend's normalization conventions.
 */

import { getPlatform } from './platform';

const isWindows = getPlatform() === 'windows';

function normalizeWindowsDrivePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return /^\/[A-Za-z]:\//.test(normalized) ? normalized.slice(1) : normalized;
}

function encodeFileURIPath(path: string): string {
  return path
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
}

/**
 * Normalizes a file URI to a canonical form for use as a map key.
 * Strips localhost authority and lowercases the scheme.
 * Returns the input unchanged for non-file or unparseable URIs.
 */
export function canonicalizeFileURI(uri: string): string {
  if (!/^file:/i.test(uri)) return uri;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:') return uri;
    const path = fileURIToPath(uri);
    return path ? filePathToURI(path) : uri;
  } catch {
    return uri;
  }
}

/**
 * Converts a local file path to a file:// URI.
 * Mirrors the backend's Windows drive-letter normalization.
 */
export function filePathToURI(path: string): string {
  let normalized = normalizeWindowsDrivePath(path);

  // Mirror the backend's Windows URI normalization: lowercase drive letter
  // and add the extra leading slash required by file:///c:/...
  if (/^[A-Za-z]:\//.test(normalized)) {
    normalized = `/${normalized[0].toLowerCase()}${normalized.slice(1)}`;
  }

  return `file://${encodeFileURIPath(normalized)}`;
}

/**
 * Converts a file:// URI back to a local file path.
 * Returns null for non-file URIs.
 */
export function fileURIToPath(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'file:') {
    return null;
  }

  // file://localhost/... is a valid local-file URI form produced by some tools.
  if (parsed.host && parsed.host !== 'localhost') {
    return null;
  }

  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    // Malformed percent-encoding (e.g. file:///tmp/%) — treat as unusable.
    return null;
  }

  // On Windows, strip the leading slash from drive-letter paths (/c:/... -> c:/...).
  // On macOS/Linux, /c:/... is a valid absolute POSIX path and must be preserved.
  if (isWindows && /^\/[A-Za-z]:\//.test(path)) {
    path = path.slice(1);
  }

  return toNativeLocalPath(path);
}

/**
 * Normalizes a local path for cross-platform equality checks.
 * Drive-letter paths (Windows-origin) are fully lowercased since NTFS is
 * case-insensitive. Backslashes are always converted to forward slashes.
 * Non-drive paths on macOS/Linux are left case-sensitive.
 */
export function normalizePathForComparison(path: string): string {
  if (!path) return path;

  const normalized = normalizeWindowsDrivePath(path);
  // Drive-letter paths are always Windows-origin and should be compared
  // case-insensitively regardless of the host platform.
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.toLowerCase();
  }

  return normalized;
}

/** Returns true when two local paths refer to the same file path string-wise. */
export function pathsReferToSameFile(a: string, b: string): boolean {
  return normalizePathForComparison(a) === normalizePathForComparison(b);
}

/**
 * Converts a local path into the platform-native form Firn stores in editor tabs.
 * On Windows, drive paths are normalized to `C:\...`; on other platforms, paths
 * are returned unchanged to avoid misinterpreting POSIX paths.
 */
export function toNativeLocalPath(path: string): string {
  if (!path) return path;

  // Only apply Windows drive-letter normalization on Windows.
  // On macOS/Linux a path like "c:/foo" is a valid POSIX relative path
  // and should not be rewritten to "C:\foo".
  if (isWindows) {
    const normalized = normalizeWindowsDrivePath(path);
    if (/^[A-Za-z]:\//.test(normalized)) {
      return `${normalized[0].toUpperCase()}${normalized.slice(1).replace(/\//g, '\\')}`;
    }
  }

  return path;
}

/** Returns the last path segment for either Unix or Windows paths. */
export function getFileNameFromPath(path: string): string {
  const localPath = toNativeLocalPath(path);
  const lastSeparator = Math.max(localPath.lastIndexOf('/'), localPath.lastIndexOf('\\'));
  return lastSeparator >= 0 ? localPath.slice(lastSeparator + 1) : localPath;
}

/** Returns the directory portion of a local path, or an empty string. */
export function getDirectoryPath(path: string): string {
  const localPath = toNativeLocalPath(path);
  const lastSeparator = Math.max(localPath.lastIndexOf('/'), localPath.lastIndexOf('\\'));
  return lastSeparator >= 0 ? localPath.slice(0, lastSeparator) : '';
}

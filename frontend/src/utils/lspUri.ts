/**
 * Shared URI conversion helpers for LSP diagnostics and navigation.
 *
 * Provides bidirectional conversion between local file paths and file:// URIs,
 * matching the backend's normalization conventions.
 */

function normalizeWindowsDrivePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return /^\/[A-Za-z]:\//.test(normalized) ? normalized.slice(1) : normalized;
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

  const uri = new URL('file://');
  uri.pathname = normalized;
  return uri.toString();
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

  if (parsed.host) {
    return null;
  }

  const path = decodeURIComponent(parsed.pathname);
  return toNativeLocalPath(path);
}

/**
 * Normalizes a local path for cross-platform equality checks.
 * Windows drive letters are compared case-insensitively and slash direction is ignored.
 */
export function normalizePathForComparison(path: string): string {
  if (!path) return path;

  const normalized = normalizeWindowsDrivePath(path);
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `${normalized[0].toLowerCase()}${normalized.slice(1)}`;
  }

  return normalized;
}

/** Returns true when two local paths refer to the same file path string-wise. */
export function pathsReferToSameFile(a: string, b: string): boolean {
  return normalizePathForComparison(a) === normalizePathForComparison(b);
}

/**
 * Converts a local path into the platform-native form Firn stores in editor tabs.
 * Windows drive paths are normalized to `C:\...`; Unix paths are returned unchanged.
 */
export function toNativeLocalPath(path: string): string {
  if (!path) return path;

  const normalized = normalizeWindowsDrivePath(path);
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `${normalized[0].toUpperCase()}${normalized.slice(1).replace(/\//g, '\\')}`;
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

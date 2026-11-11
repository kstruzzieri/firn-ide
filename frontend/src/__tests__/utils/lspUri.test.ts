// These tests assert macOS/Linux path rules (#510): pin a POSIX host, except
// where a test loads its own copy of the module as a Windows host.
let mockPlatform = 'linux';
jest.mock('../../utils/platform', () => ({
  ...jest.requireActual('../../utils/platform'),
  getPlatform: () => mockPlatform,
}));

import {
  canonicalizeFileURI,
  filePathToURI,
  fileURIToPath,
  normalizePathForComparison,
  pathsReferToSameFile,
  getFileNameFromPath,
} from '../../utils/lspUri';

describe('filePathToURI', () => {
  it('converts a Unix path to a file URI', () => {
    expect(filePathToURI('/home/user/project/test.ts')).toBe('file:///home/user/project/test.ts');
  });

  it('converts a Windows path with lowercase drive letter normalization', () => {
    const uri = filePathToURI('C:\\Users\\dev\\project\\test.ts');
    expect(uri).toBe('file:///c:/Users/dev/project/test.ts');
  });

  // Matches the backend's FileToURI: filepath.ToSlash keeps a POSIX backslash
  // and url.PathEscape encodes it, so `a\b` is never sent as the folder `a/b`.
  it('keeps a POSIX backslash in its segment, encoded (#510)', () => {
    expect(filePathToURI('/repo/a\\b/x.ts')).toBe('file:///repo/a%5Cb/x.ts');
    expect(canonicalizeFileURI('file:///repo/a%5Cb/x.ts')).toBe('file:///repo/a%5Cb/x.ts');
  });

  it('handles paths with spaces', () => {
    const uri = filePathToURI('/home/user/my project/test.ts');
    expect(uri).toContain('my%20project');
  });

  it('encodes special characters and Unicode path segments', () => {
    expect(filePathToURI('/tmp/Firn #1/100%/café.ts')).toBe(
      'file:///tmp/Firn%20%231/100%25/caf%C3%A9.ts'
    );
  });

  it('matches backend PathEscape encoding for reconnect-sensitive path characters', () => {
    expect(filePathToURI('/tmp/a&b+c=d$e@f:main.ts')).toBe('file:///tmp/a&b+c=d$e@f:main.ts');
  });
});

describe('fileURIToPath', () => {
  it('converts a file URI to a Unix path', () => {
    expect(fileURIToPath('file:///home/user/project/test.ts')).toBe('/home/user/project/test.ts');
  });

  it('converts a Windows drive-letter URI to a local path', () => {
    const result = fileURIToPath('file:///c:/Users/dev/test.ts');
    expect(result).not.toBeNull();
    // On Windows: leading slash stripped and normalized to C:\Users\dev\test.ts
    // On macOS/Linux: /c:/Users/dev/test.ts preserved as a valid absolute path
    expect(result).toMatch(/^[/]?[cC]:[/\\]Users/);
  });

  it('decodes percent-encoded characters', () => {
    expect(fileURIToPath('file:///home/user/my%20project/test.ts')).toBe(
      '/home/user/my project/test.ts'
    );
  });

  it('decodes encoded special characters and Unicode path segments', () => {
    expect(fileURIToPath('file:///tmp/Firn%20%231/100%25/caf%C3%A9.ts')).toBe(
      '/tmp/Firn #1/100%/café.ts'
    );
  });

  it('returns null for non-file URIs', () => {
    expect(fileURIToPath('https://example.com')).toBeNull();
  });

  it('accepts file://localhost/ as a local URI', () => {
    expect(fileURIToPath('file://localhost/home/user/test.ts')).toBe('/home/user/test.ts');
  });

  it('returns null for file URIs with a remote host authority', () => {
    expect(fileURIToPath('file://remote-host/share/file.ts')).toBeNull();
  });

  it('returns null for invalid URIs', () => {
    expect(fileURIToPath('not a uri')).toBeNull();
  });

  it('returns null for malformed percent-encoding', () => {
    expect(fileURIToPath('file:///tmp/%')).toBeNull();
  });
});

describe('canonicalizeFileURI', () => {
  it('normalizes localhost authority and encoded characters to the editor URI key', () => {
    expect(canonicalizeFileURI('file://localhost/tmp/Firn%20%231/100%25/caf%C3%A9.ts')).toBe(
      filePathToURI('/tmp/Firn #1/100%/café.ts')
    );
  });

  it('normalizes Windows drive-letter case to match editor URI keys', () => {
    expect(canonicalizeFileURI('file:///C:/Users/dev/My%20Project/main.ts')).toBe(
      filePathToURI('C:\\Users\\dev\\My Project\\main.ts')
    );
  });

  it('normalizes uppercase file URI schemes', () => {
    expect(canonicalizeFileURI('FILE:///tmp/Firn%20%231.ts')).toBe(
      filePathToURI('/tmp/Firn #1.ts')
    );
  });
});

describe('path helpers', () => {
  it('matches equivalent Windows paths regardless of slash style', () => {
    expect(pathsReferToSameFile('C:\\Users\\dev\\test.ts', 'c:/Users/dev/test.ts')).toBe(true);
  });

  it('matches diagnostics URI paths against editor paths for Windows drive case differences', () => {
    const diagnosticPath = fileURIToPath(canonicalizeFileURI('file:///C:/Users/dev/test.ts'));
    expect(diagnosticPath).not.toBeNull();
    expect(pathsReferToSameFile(diagnosticPath!, 'c:/Users/dev/test.ts')).toBe(true);
  });

  it('keeps a POSIX backslash as a name character, not a separator (#510)', () => {
    expect(pathsReferToSameFile('/repo/a/b/x.ts', '/repo/a\\b/x.ts')).toBe(false);
    expect(pathsReferToSameFile('/repo/a\\b/x.ts', '/repo/a\\b/x.ts')).toBe(true);
    expect(normalizePathForComparison('/repo/a\\b/x.ts')).toBe('/repo/a\\b/x.ts');
  });

  it('still folds separators on Windows UNC paths', () => {
    expect(pathsReferToSameFile('\\\\server\\share\\x.ts', '//server/share/x.ts')).toBe(true);
  });

  // A Windows host reads a backslash as a separator in every path, drive or not.
  it('still folds separators in a relative path on a Windows host', () => {
    mockPlatform = 'windows';
    try {
      jest.isolateModules(() => {
        const windows = require('../../utils/lspUri') as typeof import('../../utils/lspUri');
        expect(windows.pathsReferToSameFile('a\\b\\x.ts', 'a/b/x.ts')).toBe(true);
      });
    } finally {
      mockPlatform = 'linux';
    }
  });

  it('extracts the basename from Windows paths', () => {
    expect(getFileNameFromPath('C:\\Users\\dev\\test.ts')).toBe('test.ts');
  });
});

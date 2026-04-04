import {
  filePathToURI,
  fileURIToPath,
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

  it('handles paths with spaces', () => {
    const uri = filePathToURI('/home/user/my project/test.ts');
    expect(uri).toContain('my%20project');
  });
});

describe('fileURIToPath', () => {
  it('converts a file URI to a Unix path', () => {
    expect(fileURIToPath('file:///home/user/project/test.ts')).toBe('/home/user/project/test.ts');
  });

  it('strips leading slash from Windows drive-letter URIs', () => {
    const result = fileURIToPath('file:///c:/Users/dev/test.ts');
    // The leading /c: slash is always stripped.
    // On Windows toNativeLocalPath further normalizes to C:\...; on other
    // platforms the forward-slash form is returned as-is.
    expect(result).not.toBeNull();
    expect(result!.startsWith('/')).toBe(false);
    expect(result).toMatch(/^[cC]:[/\\]Users/);
  });

  it('decodes percent-encoded characters', () => {
    expect(fileURIToPath('file:///home/user/my%20project/test.ts')).toBe(
      '/home/user/my project/test.ts'
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

describe('path helpers', () => {
  it('matches equivalent Windows paths regardless of slash style', () => {
    expect(pathsReferToSameFile('C:\\Users\\dev\\test.ts', 'c:/Users/dev/test.ts')).toBe(true);
  });

  it('extracts the basename from Windows paths', () => {
    expect(getFileNameFromPath('C:\\Users\\dev\\test.ts')).toBe('test.ts');
  });
});

# Issue #8: File System - Read File Contents

## Issue Summary

Implement Go backend function to read file contents with encoding detection.

## Acceptance Criteria

- [ ] `ReadFile(path string)` returns file content as string
- [ ] Detects and handles UTF-8, UTF-16, Latin-1 encodings
- [ ] Returns file metadata (encoding, line endings, size)
- [ ] Handles binary file detection
- [ ] Unit tests for various file types

## Test Strategy

The file reader is tested using:
1. **Mock filesystem** - Uses the `FileSystem` interface for testability
2. **Encoding detection tests** - Verify correct detection of UTF-8, UTF-16, Latin-1
3. **Line ending detection** - Verify LF, CRLF, CR detection
4. **Binary detection tests** - Verify binary files are identified
5. **Error handling tests** - Verify graceful handling of edge cases

## Test Cases

| Test | Rationale |
|------|-----------|
| `TestReadFile_UTF8` | Proves UTF-8 files are read correctly |
| `TestReadFile_UTF8WithBOM` | Proves UTF-8 BOM is detected and handled |
| `TestReadFile_UTF16LE` | Proves UTF-16 LE files are detected and decoded |
| `TestReadFile_UTF16BE` | Proves UTF-16 BE files are detected and decoded |
| `TestReadFile_Latin1` | Proves Latin-1/ISO-8859-1 files are handled |
| `TestReadFile_LineEndingsLF` | Proves Unix line endings detected |
| `TestReadFile_LineEndingsCRLF` | Proves Windows line endings detected |
| `TestReadFile_LineEndingsCR` | Proves old Mac line endings detected |
| `TestReadFile_BinaryDetection` | Proves binary files are identified |
| `TestReadFile_ReturnsMetadata` | Proves encoding, line endings, size returned |
| `TestReadFile_InvalidPath` | Proves error returned for missing files |
| `TestReadFile_EmptyFile` | Proves empty files handled correctly |

## TDD: Before (Failing Tests)

```
=== RUN   TestReadFileWithMetadata_UTF8
--- FAIL: TestReadFileWithMetadata_UTF8 (0.00s)
panic: runtime error: invalid memory address or nil pointer dereference
    filereader_test.go:22: ReadFileWithMetadata returns nil (not implemented)
=== RUN   TestReadFileWithMetadata_UTF8WithBOM
--- FAIL: TestReadFileWithMetadata_UTF8WithBOM (0.00s)
=== RUN   TestReadFileWithMetadata_UTF16LE
--- FAIL: TestReadFileWithMetadata_UTF16LE (0.00s)
=== RUN   TestReadFileWithMetadata_UTF16BE
--- FAIL: TestReadFileWithMetadata_UTF16BE (0.00s)
=== RUN   TestReadFileWithMetadata_Latin1
--- FAIL: TestReadFileWithMetadata_Latin1 (0.00s)
... (13 tests fail)
FAIL
exit status 1
FAIL    arc/internal/filesystem    0.009s
```

## Implementation Notes

### Data Structures

```go
// FileContent represents the result of reading a file.
type FileContent struct {
    Content     string     `json:"content"`
    Encoding    string     `json:"encoding"`    // "utf-8", "utf-16le", "utf-16be", "latin-1"
    LineEndings string     `json:"lineEndings"` // "lf", "crlf", "cr", "mixed"
    Size        int64      `json:"size"`
    IsBinary    bool       `json:"isBinary"`
}
```

### Encoding Detection Strategy

1. Check for BOM (Byte Order Mark):
   - `EF BB BF` = UTF-8 with BOM
   - `FF FE` = UTF-16 LE
   - `FE FF` = UTF-16 BE
2. If no BOM, scan for null bytes (binary indicator)
3. If no nulls, assume UTF-8 (most common)
4. Validate UTF-8, fallback to Latin-1 if invalid

### Binary Detection

A file is considered binary if it contains null bytes (0x00) in the first 8KB.

## TDD: After (Passing Tests)

```
=== RUN   TestReadFileWithMetadata_UTF8
--- PASS: TestReadFileWithMetadata_UTF8 (0.00s)
=== RUN   TestReadFileWithMetadata_UTF8WithBOM
--- PASS: TestReadFileWithMetadata_UTF8WithBOM (0.00s)
=== RUN   TestReadFileWithMetadata_UTF16LE
--- PASS: TestReadFileWithMetadata_UTF16LE (0.00s)
=== RUN   TestReadFileWithMetadata_UTF16BE
--- PASS: TestReadFileWithMetadata_UTF16BE (0.00s)
=== RUN   TestReadFileWithMetadata_Latin1
--- PASS: TestReadFileWithMetadata_Latin1 (0.00s)
=== RUN   TestReadFileWithMetadata_LineEndingsLF
--- PASS: TestReadFileWithMetadata_LineEndingsLF (0.00s)
=== RUN   TestReadFileWithMetadata_LineEndingsCRLF
--- PASS: TestReadFileWithMetadata_LineEndingsCRLF (0.00s)
=== RUN   TestReadFileWithMetadata_LineEndingsCR
--- PASS: TestReadFileWithMetadata_LineEndingsCR (0.00s)
=== RUN   TestReadFileWithMetadata_LineEndingsMixed
--- PASS: TestReadFileWithMetadata_LineEndingsMixed (0.00s)
=== RUN   TestReadFileWithMetadata_BinaryDetection
--- PASS: TestReadFileWithMetadata_BinaryDetection (0.00s)
=== RUN   TestReadFileWithMetadata_ReturnsSize
--- PASS: TestReadFileWithMetadata_ReturnsSize (0.00s)
=== RUN   TestReadFileWithMetadata_InvalidPath
--- PASS: TestReadFileWithMetadata_InvalidPath (0.00s)
=== RUN   TestReadFileWithMetadata_EmptyFile
--- PASS: TestReadFileWithMetadata_EmptyFile (0.00s)
PASS
ok      arc/internal/filesystem    0.011s
```

## Verification

All acceptance criteria met:
- [x] `ReadFile(path string)` returns file content as string
- [x] Detects and handles UTF-8, UTF-16, Latin-1 encodings
- [x] Returns file metadata (encoding, line endings, size)
- [x] Handles binary file detection
- [x] Unit tests for various file types

## Related

- PR: TBD
- Depends on: #7 (ReadDirectory), #41 (package structure)
- Blocks: #12 (Editor - Open Files from Explorer)

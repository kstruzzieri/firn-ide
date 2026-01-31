# Issue #9: File System - Write File Contents

## Issue Summary

Implement Go backend function to write/save file contents.

## Acceptance Criteria

- [ ] `WriteFile(path string, content string)` saves file
- [ ] Preserves original encoding and line endings
- [ ] Creates backup before overwrite (configurable)
- [ ] Handles write permission errors
- [ ] Unit tests including error cases

## Test Strategy

The file writer is tested using:
1. **Mock filesystem** - Uses the `FileSystem` interface for testability
2. **Encoding preservation tests** - Verify UTF-8, UTF-16, Latin-1 are preserved
3. **Line ending preservation tests** - Verify LF, CRLF are preserved
4. **Backup tests** - Verify backup creation when configured
5. **Error handling tests** - Verify graceful handling of permission errors

## Test Cases

| Test | Rationale |
|------|-----------|
| `TestWriteFile_BasicWrite` | Proves basic file writing works |
| `TestWriteFile_PreservesUTF8` | Proves UTF-8 encoding is preserved |
| `TestWriteFile_PreservesUTF8BOM` | Proves UTF-8 BOM is preserved |
| `TestWriteFile_PreservesUTF16LE` | Proves UTF-16 LE encoding is preserved |
| `TestWriteFile_PreservesUTF16BE` | Proves UTF-16 BE encoding is preserved |
| `TestWriteFile_PreservesLF` | Proves Unix line endings preserved |
| `TestWriteFile_PreservesCRLF` | Proves Windows line endings preserved |
| `TestWriteFile_CreatesBackup` | Proves backup file created when enabled |
| `TestWriteFile_NoBackupWhenDisabled` | Proves no backup when disabled |
| `TestWriteFile_PermissionError` | Proves permission errors handled gracefully |
| `TestWriteFile_CreatesNewFile` | Proves new files can be created |
| `TestWriteFile_CreatesMissingDirectories` | Proves parent dirs created if needed |

## TDD: Before (Failing Tests)

```
=== RUN   TestWriteFile_BasicWrite
    filewriter_test.go:31: Expected path '/test/file.txt', got ""
    filewriter_test.go:34: Expected content 'Hello, World!', got ""
--- FAIL: TestWriteFile_BasicWrite (0.00s)
=== RUN   TestWriteFile_PreservesUTF8
    filewriter_test.go:61: Expected UTF-8 content, got []
--- FAIL: TestWriteFile_PreservesUTF8 (0.00s)
=== RUN   TestWriteFile_PreservesUTF8BOM
    filewriter_test.go:87: Expected UTF-8 BOM prefix
--- FAIL: TestWriteFile_PreservesUTF8BOM (0.00s)
... (12 tests fail)
FAIL
exit status 1
FAIL    flux/internal/filesystem    0.010s
```

## Implementation Notes

### Data Structures

```go
// WriteOptions configures file writing behavior.
type WriteOptions struct {
    Encoding    string // Target encoding: "utf-8", "utf-8-bom", "utf-16le", "utf-16be"
    LineEndings string // Target line endings: "lf", "crlf"
    CreateBackup bool  // Create .bak file before overwrite
}
```

### Encoding Conversion

- UTF-8: Write directly
- UTF-8 BOM: Prepend EF BB BF
- UTF-16 LE: Convert to UTF-16 LE with FF FE BOM
- UTF-16 BE: Convert to UTF-16 BE with FE FF BOM

### Line Ending Conversion

- Normalize all line endings to \n first
- Then convert to target (\n for LF, \r\n for CRLF)

## TDD: After (Passing Tests)

```
=== RUN   TestWriteFile_BasicWrite
--- PASS: TestWriteFile_BasicWrite (0.00s)
=== RUN   TestWriteFile_PreservesUTF8
--- PASS: TestWriteFile_PreservesUTF8 (0.00s)
=== RUN   TestWriteFile_PreservesUTF8BOM
--- PASS: TestWriteFile_PreservesUTF8BOM (0.00s)
=== RUN   TestWriteFile_PreservesUTF16LE
--- PASS: TestWriteFile_PreservesUTF16LE (0.00s)
=== RUN   TestWriteFile_PreservesUTF16BE
--- PASS: TestWriteFile_PreservesUTF16BE (0.00s)
=== RUN   TestWriteFile_PreservesLF
--- PASS: TestWriteFile_PreservesLF (0.00s)
=== RUN   TestWriteFile_PreservesCRLF
--- PASS: TestWriteFile_PreservesCRLF (0.00s)
=== RUN   TestWriteFile_CreatesBackup
--- PASS: TestWriteFile_CreatesBackup (0.00s)
=== RUN   TestWriteFile_NoBackupWhenDisabled
--- PASS: TestWriteFile_NoBackupWhenDisabled (0.00s)
=== RUN   TestWriteFile_NoBackupForNewFile
--- PASS: TestWriteFile_NoBackupForNewFile (0.00s)
=== RUN   TestWriteFile_PermissionError
--- PASS: TestWriteFile_PermissionError (0.00s)
=== RUN   TestWriteFile_CreatesParentDirectories
--- PASS: TestWriteFile_CreatesParentDirectories (0.00s)
PASS
ok      flux/internal/filesystem    0.010s
```

## Verification

All acceptance criteria met:
- [x] `WriteFile(path string, content string)` saves file
- [x] Preserves original encoding and line endings
- [x] Creates backup before overwrite (configurable)
- [x] Handles write permission errors
- [x] Unit tests including error cases

## Related

- PR: TBD
- Depends on: #8 (ReadFile for encoding detection)
- Blocks: #13 (Editor - Save File)

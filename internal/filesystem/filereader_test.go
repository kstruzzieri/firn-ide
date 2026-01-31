package filesystem

import (
	"errors"
	"testing"
)

func TestReadFileWithMetadata_UTF8(t *testing.T) {
	content := []byte("Hello, World!\nThis is UTF-8 text.")
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.Content != string(content) {
		t.Errorf("Expected content %q, got %q", string(content), result.Content)
	}
	if result.Encoding != "utf-8" {
		t.Errorf("Expected encoding 'utf-8', got %q", result.Encoding)
	}
}

func TestReadFileWithMetadata_UTF8WithBOM(t *testing.T) {
	// UTF-8 BOM: EF BB BF
	content := []byte{0xEF, 0xBB, 0xBF, 'H', 'e', 'l', 'l', 'o'}
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	// BOM should be stripped from content
	if result.Content != "Hello" {
		t.Errorf("Expected content 'Hello' (BOM stripped), got %q", result.Content)
	}
	if result.Encoding != "utf-8-bom" {
		t.Errorf("Expected encoding 'utf-8-bom', got %q", result.Encoding)
	}
}

func TestReadFileWithMetadata_UTF16LE(t *testing.T) {
	// UTF-16 LE BOM: FF FE, followed by "Hi" in UTF-16 LE
	content := []byte{0xFF, 0xFE, 'H', 0x00, 'i', 0x00}
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.Content != "Hi" {
		t.Errorf("Expected content 'Hi', got %q", result.Content)
	}
	if result.Encoding != "utf-16le" {
		t.Errorf("Expected encoding 'utf-16le', got %q", result.Encoding)
	}
}

func TestReadFileWithMetadata_UTF16BE(t *testing.T) {
	// UTF-16 BE BOM: FE FF, followed by "Hi" in UTF-16 BE
	content := []byte{0xFE, 0xFF, 0x00, 'H', 0x00, 'i'}
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.Content != "Hi" {
		t.Errorf("Expected content 'Hi', got %q", result.Content)
	}
	if result.Encoding != "utf-16be" {
		t.Errorf("Expected encoding 'utf-16be', got %q", result.Encoding)
	}
}

func TestReadFileWithMetadata_Latin1(t *testing.T) {
	// Latin-1 text with character 0xE9 (é) which is invalid UTF-8 sequence on its own
	content := []byte{'c', 'a', 'f', 0xE9} // "café" in Latin-1
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.Encoding != "latin-1" {
		t.Errorf("Expected encoding 'latin-1', got %q", result.Encoding)
	}
	// Latin-1 0xE9 should be converted to UTF-8 é (0xC3 0xA9)
	if result.Content != "café" {
		t.Errorf("Expected content 'café', got %q", result.Content)
	}
}

func TestReadFileWithMetadata_LineEndingsLF(t *testing.T) {
	content := []byte("line1\nline2\nline3")
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.LineEndings != "lf" {
		t.Errorf("Expected line endings 'lf', got %q", result.LineEndings)
	}
}

func TestReadFileWithMetadata_LineEndingsCRLF(t *testing.T) {
	content := []byte("line1\r\nline2\r\nline3")
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.LineEndings != "crlf" {
		t.Errorf("Expected line endings 'crlf', got %q", result.LineEndings)
	}
}

func TestReadFileWithMetadata_LineEndingsCR(t *testing.T) {
	content := []byte("line1\rline2\rline3")
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.LineEndings != "cr" {
		t.Errorf("Expected line endings 'cr', got %q", result.LineEndings)
	}
}

func TestReadFileWithMetadata_LineEndingsMixed(t *testing.T) {
	content := []byte("line1\nline2\r\nline3\rline4")
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.LineEndings != "mixed" {
		t.Errorf("Expected line endings 'mixed', got %q", result.LineEndings)
	}
}

func TestReadFileWithMetadata_BinaryDetection(t *testing.T) {
	// Binary file with null bytes
	content := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00}
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/image.png")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if !result.IsBinary {
		t.Error("Expected IsBinary to be true for file with null bytes")
	}
}

func TestReadFileWithMetadata_ReturnsSize(t *testing.T) {
	content := []byte("Hello, World!")
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return content, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/file.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.Size != int64(len(content)) {
		t.Errorf("Expected size %d, got %d", len(content), result.Size)
	}
}

func TestReadFileWithMetadata_InvalidPath(t *testing.T) {
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return nil, errors.New("no such file or directory")
		},
	}

	reader := NewFileReader(mockFS)
	_, err := reader.ReadFileWithMetadata("/nonexistent/file.txt")

	if err == nil {
		t.Error("Expected error for invalid path")
	}
}

func TestReadFileWithMetadata_EmptyFile(t *testing.T) {
	mockFS := &Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			return []byte{}, nil
		},
	}

	reader := NewFileReader(mockFS)
	result, err := reader.ReadFileWithMetadata("/test/empty.txt")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.Content != "" {
		t.Errorf("Expected empty content, got %q", result.Content)
	}
	if result.Size != 0 {
		t.Errorf("Expected size 0, got %d", result.Size)
	}
	if result.IsBinary {
		t.Error("Expected IsBinary to be false for empty file")
	}
}

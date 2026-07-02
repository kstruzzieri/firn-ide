package filesystem

import (
	"io/fs"
	"path/filepath"
	"strings"
	"unicode/utf16"
)

// WriteOptions configures file writing behavior.
type WriteOptions struct {
	Encoding     string // Target encoding: "utf-8", "utf-8-bom", "utf-16le", "utf-16be"
	LineEndings  string // Target line endings: "lf", "crlf"
	CreateBackup bool   // Create .bak file before overwrite
	CreateDirs   bool   // Create parent directories if they don't exist
}

// FileWriter provides file writing functionality with encoding support.
type FileWriter struct {
	fs FileSystem
}

// NewFileWriter creates a new FileWriter with the given filesystem.
func NewFileWriter(fs FileSystem) *FileWriter {
	return &FileWriter{fs: fs}
}

// WriteFileWithOptions writes content to a file with the specified options.
// If options is nil, defaults to UTF-8 encoding with original line endings preserved.
func (w *FileWriter) WriteFileWithOptions(path string, content string, opts *WriteOptions) error {
	// Default options
	if opts == nil {
		opts = &WriteOptions{
			Encoding: "utf-8",
		}
	}

	// Create parent directories if requested
	if opts.CreateDirs {
		dir := filepath.Dir(path)
		if err := w.fs.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}

	// Check if file exists for backup
	fileExists := false
	if _, err := w.fs.Stat(path); err == nil {
		fileExists = true
	}

	// Create backup if requested and file exists
	if opts.CreateBackup && fileExists {
		originalContent, err := w.fs.ReadFile(path)
		if err == nil {
			backupPath := path + ".bak"
			if err := w.fs.WriteFile(backupPath, originalContent, 0644); err != nil {
				return err
			}
		}
	}

	// Convert line endings if specified
	processedContent := content
	if opts.LineEndings != "" {
		processedContent = w.convertLineEndings(content, opts.LineEndings)
	}

	// Encode content
	data := w.encodeContent(processedContent, opts.Encoding)

	// Write file
	return w.fs.WriteFile(path, data, 0644)
}

// convertLineEndings normalizes and converts line endings.
func (w *FileWriter) convertLineEndings(content string, target string) string {
	// First normalize all line endings to LF
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")

	// Then convert to target
	switch target {
	case "crlf":
		return strings.ReplaceAll(normalized, "\n", "\r\n")
	case "lf":
		return normalized
	default:
		return content
	}
}

// encodeContent encodes the string content to bytes with the specified encoding.
func (w *FileWriter) encodeContent(content string, encoding string) []byte {
	switch encoding {
	case "utf-8-bom":
		// UTF-8 with BOM
		bom := []byte{0xEF, 0xBB, 0xBF}
		return append(bom, []byte(content)...)

	case "utf-16le":
		return w.encodeUTF16LE(content)

	case "utf-16be":
		return w.encodeUTF16BE(content)

	case "utf-8", "":
		fallthrough
	default:
		return []byte(content)
	}
}

// encodeUTF16LE encodes a string to UTF-16 Little Endian with BOM.
func (w *FileWriter) encodeUTF16LE(content string) []byte {
	runes := []rune(content)
	u16s := utf16.Encode(runes)

	// BOM + content
	result := make([]byte, 2+len(u16s)*2)
	result[0] = 0xFF // LE BOM
	result[1] = 0xFE

	for i, u := range u16s {
		result[2+i*2] = byte(u)
		result[2+i*2+1] = byte(u >> 8)
	}

	return result
}

// encodeUTF16BE encodes a string to UTF-16 Big Endian with BOM.
func (w *FileWriter) encodeUTF16BE(content string) []byte {
	runes := []rune(content)
	u16s := utf16.Encode(runes)

	// BOM + content
	result := make([]byte, 2+len(u16s)*2)
	result[0] = 0xFE // BE BOM
	result[1] = 0xFF

	for i, u := range u16s {
		result[2+i*2] = byte(u >> 8)
		result[2+i*2+1] = byte(u)
	}

	return result
}

// DefaultFileMode is the default permission mode for new files.
const DefaultFileMode fs.FileMode = 0644
